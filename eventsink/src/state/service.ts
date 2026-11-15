// The proficiency state service (AN-11a, decision 0280): answers a Body's ProficiencyRequest on
// `geldar.<shard>.state.<life_id>.proficiency` (core NATS request/reply) from the agents and proficiency
// tables (sql/0050). The life id in the subject is the only authority. The request body is size-checked
// and otherwise ignored, so a payload that names another life changes nothing.
// Not wired: eventsink/src/main.ts does not start this service. AN-12 owns that wiring.

import { type ProficiencyState, validateProficiencyState } from '@geldar/contract';
import { DEFAULT_THRESHOLDS, type Domain, levelForXp } from '@geldar/psyche';
import type { NatsConnection } from '@nats-io/transport-node';

export interface StateStore {
  read(lifeId: string): Promise<ProficiencyState | null>;
} // null: no agents row

// The same patterns as the contract's subject helpers (contract/src/subjects.ts). The helpers are not
// exported from the contract index, so the strings are copied here; service.test.ts checks them against
// the contract's own helpers, which throw on the same refusals.
const SHARD = /^[a-z][a-z0-9-]{1,31}$/;
const LIFE_ID = /^ag_[a-z][a-z0-9]{0,15}_[0-9]{2,}$/;

const DOMAINS: readonly Domain[] = [
  'combat',
  'farming',
  'mining',
  'building',
  'crafting',
  'exploring',
  'social',
];

const MAX_BODY_BYTES = 256;
// The limiter remembers at most this many lives. Past it, the life answered longest ago is forgotten.
const LIMITER_CAP = 4096;
// Every sink on a shard joins this queue group, so one request is answered by one of them.
const QUEUE_GROUP = 'state-service';
const DEFAULT_READ_TIMEOUT_MS = 2000;
const DEFAULT_RETRY_BASE_MS = 1000;
const RETRY_CAP_MS = 30_000;

/** Per-life minimum interval between answered requests. A request inside it gets `{"error":"rate"}`. */
export class Limiter {
  // Insertion order is the order in which each life was last admitted, so the first key is the oldest.
  readonly #last = new Map<string, number>();
  readonly #minMs: number;
  readonly #cap: number;

  constructor(minMs: number, cap = LIMITER_CAP) {
    this.#minMs = minMs;
    this.#cap = cap;
  }

  get size(): number {
    return this.#last.size;
  }

  allow(lifeId: string, now: number): boolean {
    const prev = this.#last.get(lifeId);
    if (prev !== undefined) {
      if (now - prev < this.#minMs) return false;
    } else if (this.#last.size >= this.#cap) {
      const oldest = this.#last.keys().next().value;
      if (oldest !== undefined) this.#last.delete(oldest);
    }
    this.#last.delete(lifeId);
    this.#last.set(lifeId, now);
    return true;
  }
}

/** A stored row or reply the service will not send. The message is the constant log line. */
class Refusal extends Error {}

/** The life id of `geldar.<shard>.state.<life>.proficiency`, or undefined for any other subject. */
function lifeOf(subject: string, shard: string): string | undefined {
  const tokens = subject.split('.');
  if (tokens.length !== 5) return undefined;
  if (tokens[0] !== 'geldar' || tokens[1] !== shard) return undefined;
  if (tokens[2] !== 'state' || tokens[4] !== 'proficiency') return undefined;
  const life = tokens[3];
  return life !== undefined && LIFE_ID.test(life) ? life : undefined;
}

/** The store read, bounded: a read that has not settled by `ms` fails, so one query cannot stall the loop. */
async function readWithin(
  store: StateStore,
  lifeId: string,
  ms: number,
): Promise<ProficiencyState | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('read timed out')), ms);
  });
  try {
    return await Promise.race([store.read(lifeId), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The reply for one life: the stored levels checked against the thresholds, `version` as the sum of
 * the XP (the store's own version is ignored). The reply carries no sheet: the adopted sheet is
 * operator-readable only (geldar-93). Throws a Refusal when the store answers for another life, a level
 * does not match its XP, or the reply fails the contract. Any other throw is a failed read.
 */
async function replyFor(
  store: StateStore,
  lifeId: string,
  thresholds: readonly [number, number, number],
  readMs: number,
): Promise<ProficiencyState | { error: 'unknown_life' }> {
  const stored = await readWithin(store, lifeId, readMs);
  if (stored === null) return { error: 'unknown_life' };
  if (stored.life_id !== lifeId) throw new Refusal('state life mismatch');
  const levels = {} as ProficiencyState['levels'];
  let version = 0;
  for (const d of DOMAINS) {
    const row = stored.levels?.[d];
    if (!row || !Number.isSafeInteger(row.xp) || row.xp < 0) throw new Refusal('state row invalid');
    if (levelForXp(row.xp, thresholds) !== row.level) throw new Refusal('state level mismatch');
    levels[d] = { level: row.level, xp: row.xp };
    version += row.xp;
  }
  const state: ProficiencyState = { life_id: lifeId, version, levels };
  const checked = validateProficiencyState(state);
  if (!checked.ok) throw new Refusal('state reply invalid');
  return checked.value;
}

export function serveProficiencyState(o: {
  nc: NatsConnection;
  store: StateStore;
  shard: string;
  log: (l: string) => void;
  minIntervalMs?: number /* default 1000 per life */;
  thresholds?: readonly [number, number, number] /* default psyche's DEFAULT_THRESHOLDS */;
  readTimeoutMs?: number /* default 2000: a read not settled by then is answered unavailable */;
  retryBaseMs?: number /* default 1000: the wait after a failed subscription, doubled per failure */;
}): { stop(): Promise<void> } {
  if (!SHARD.test(o.shard)) throw new RangeError(`invalid shard name: ${o.shard}`);
  const thresholds = o.thresholds ?? DEFAULT_THRESHOLDS;
  levelForXp(0, thresholds); // throws on a bad threshold list: a configuration error, seen at startup
  const readMs = o.readTimeoutMs ?? DEFAULT_READ_TIMEOUT_MS;
  if (!Number.isFinite(readMs) || readMs <= 0)
    throw new RangeError(`invalid read timeout: ${readMs}`);
  const retryBaseMs = o.retryBaseMs ?? DEFAULT_RETRY_BASE_MS;
  const subject = `geldar.${o.shard}.state.*.proficiency`;
  const limiter = new Limiter(o.minIntervalMs ?? 1000);
  const encoder = new TextEncoder();
  let stopped = false;
  let current: ReturnType<NatsConnection['subscribe']> | undefined;
  let cancelPause: (() => void) | undefined;

  // Log lines are constants: never a sheet value, a level, an XP or an error message from the store.
  const say = (line: string): void => {
    try {
      o.log(line);
    } catch {
      // logging is best effort
    }
  };

  const answer = async (
    subject: string,
    size: number,
    respond: (data?: Uint8Array) => boolean,
  ): Promise<void> => {
    if (stopped) return;
    if (size > MAX_BODY_BYTES) {
      say('state request refused: body too large');
      return;
    }
    const lifeId = lifeOf(subject, o.shard);
    if (lifeId === undefined) return; // not a proficiency request for a valid life: no reply
    if (!limiter.allow(lifeId, performance.now())) {
      respond(encoder.encode(JSON.stringify({ error: 'rate' })));
      return;
    }
    let body: unknown;
    try {
      body = await replyFor(o.store, lifeId, thresholds, readMs);
    } catch (err) {
      say(err instanceof Refusal ? err.message : 'state read failed');
      body = { error: 'unavailable' };
    }
    if (stopped) return;
    respond(encoder.encode(JSON.stringify(body)));
  };

  // Waits `ms` unless stop() cancels the wait first.
  const pause = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      const finish = (): void => {
        clearTimeout(timer);
        cancelPause = undefined;
        resolve();
      };
      const timer = setTimeout(finish, ms);
      cancelPause = finish;
    });

  // One request at a time: the loop bounds the work the store does for this service. A subscription the
  // server refuses, or one that ends while the service runs, is logged and resubscribed with a capped
  // backoff. Nothing here may reject: the loop is never left unhandled.
  const loop = (async () => {
    let failures = 0;
    while (!stopped) {
      let delivered = false;
      try {
        const sub = o.nc.subscribe(subject, { queue: QUEUE_GROUP });
        current = sub;
        for await (const msg of sub) {
          delivered = true;
          try {
            await answer(msg.subject, msg.data.byteLength, (data) => msg.respond(data));
          } catch {
            say('state request failed');
          }
        }
        if (!stopped) say('state subscription ended');
      } catch {
        if (!stopped) say('state subscription failed');
      }
      current = undefined;
      if (stopped) break;
      failures = delivered ? 1 : failures + 1;
      await pause(Math.min(RETRY_CAP_MS, retryBaseMs * 2 ** (failures - 1)));
    }
    say('state service stopped');
  })();

  return {
    async stop(): Promise<void> {
      stopped = true;
      try {
        current?.unsubscribe();
      } catch {
        // best effort: the loop ends once `stopped` is set
      }
      cancelPause?.();
      await loop;
    },
  };
}
