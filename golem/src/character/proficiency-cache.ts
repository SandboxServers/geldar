// The Body's proficiency cache (AN-11b; decisions 0280, 0186 D-CS-04 and D-CS-07).
// Until a valid reply arrives it serves zeros, records degraded and retries.
// Only a valid reply changes what the cache holds (levels, xp, version). The reply carries no sheet (AN-11c): the
// adopted sheet is operator-readable only. A reply is adopted when its version is at least the cached one, so a reply
// that repeats the cached version still fills the other domains, and an older reply is ignored (a reconnect cannot
// undo a newer level).
// A level push is an untrusted hint. 0280 records that the body role can publish on the level subject until the ACL
// follow-up lands, so a push never changes the cache by itself. A valid push that is newer than the cache starts one
// confirming request; repeated pushes while it is in flight start nothing more.
import { validateProficiencyLevelPayload, validateProficiencyState } from '@geldar/contract';
import { DEFAULT_THRESHOLDS, type Domain, type Level, levelForXp } from '@geldar/psyche';

export interface StateTransport {
  request(subject: string, body: string, timeoutMs: number): Promise<string>; // rejects on timeout or no responders
  subscribe(subject: string, onMessage: (body: string) => void): () => void; // returns unsubscribe
}

type DomainLevel = { level: Level; xp: number };
type Levels = Record<Domain, DomainLevel>;
interface ParsedState {
  version: number;
  levels: Levels;
}

const DOMAINS: readonly Domain[] = [
  'combat',
  'farming',
  'mining',
  'building',
  'crafting',
  'exploring',
  'social',
];

// The same patterns as the contract's subject helpers (`SHARD` and `LIFE_ID` in contract/src/subjects.ts). The
// helpers are not exported from the contract index yet, so the patterns are copied; the drift test in
// proficiency-cache.test.ts pins the strings and the refusals against the contract. Export them, then import them.
const SHARD_TOKEN = /^[a-z][a-z0-9-]{1,31}$/;
const LIFE_TOKEN = /^ag_[a-z][a-z0-9]{0,15}_[0-9]{2,}$/;

// geldar.<shard>.state.<life>.<leaf> (decision 0280). Refuses a shard or life id the contract would refuse.
function stateSubject(shard: string, lifeId: string, leaf: 'proficiency' | 'level'): string {
  if (!SHARD_TOKEN.test(shard) || !LIFE_TOKEN.test(lifeId)) {
    throw new RangeError('shard or life id is not a valid subject token');
  }
  return `geldar.${shard}.state.${lifeId}.${leaf}`;
}

// A version or xp the cache can hold: a non-negative integer that survives arithmetic exactly.
function isCount(n: unknown): n is number {
  return typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
}

function zeroLevels(): Levels {
  const out = {} as Levels;
  for (const d of DOMAINS) out[d] = { level: 0, xp: 0 };
  return out;
}

function parseJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

export class ProficiencyCache {
  readonly #transport: StateTransport;
  readonly #lifeId: string;
  readonly #thresholds: readonly [number, number, number];
  readonly #timeoutMs: number;
  readonly #attempts: number;
  readonly #retryMs: number;
  readonly #log: (l: string) => void;
  readonly #requestSubject: string;
  readonly #pushSubject: string;
  #levels: Levels = zeroLevels();
  #version = 0;
  #adopted = false;
  #degraded = true;
  #loggedDegraded = false;
  #loggedInvalidReply = false;
  #confirmInFlight = false;
  #stopped = false;
  #unsubscribe: (() => void) | undefined;
  #timer: ReturnType<typeof setTimeout> | undefined;

  constructor(o: {
    transport: StateTransport;
    shard: string;
    lifeId: string;
    thresholds?: readonly [number, number, number];
    timeoutMs?: number /* 2000 */;
    attempts?: number /* 3 */;
    retryMs?: number /* 15000 */;
    log: (l: string) => void;
  }) {
    this.#thresholds = o.thresholds ?? DEFAULT_THRESHOLDS;
    levelForXp(0, this.#thresholds); // throws on a bad threshold list: a configuration error, seen at construction
    this.#transport = o.transport;
    this.#lifeId = o.lifeId;
    this.#timeoutMs = o.timeoutMs ?? 2000;
    this.#attempts = o.attempts ?? 3;
    this.#retryMs = o.retryMs ?? 15000;
    this.#log = o.log;
    this.#requestSubject = stateSubject(o.shard, o.lifeId, 'proficiency');
    this.#pushSubject = stateSubject(o.shard, o.lifeId, 'level');
  }

  // Subscribe to the push first, then request, so a level change during start is not lost. A second call does not
  // subscribe again. Never throws, and a throwing log cannot make it reject.
  async start(): Promise<void> {
    if (this.#stopped) return;
    if (this.#unsubscribe === undefined) {
      try {
        this.#unsubscribe = this.#transport.subscribe(this.#pushSubject, (body) =>
          this.#onPush(body),
        );
      } catch {
        this.#say('proficiency push subscription failed; relying on requests');
      }
    }
    await this.#runCycle();
  }

  // Always answers from memory. Zero until a fresh state has been adopted.
  level(domain: Domain): Level {
    return this.#levels[domain]?.level ?? 0;
  }

  get version(): number {
    return this.#version;
  }

  get degraded(): boolean {
    return this.#degraded;
  }

  // Used on reconnect. Keeps what was adopted before if the request fails.
  async refresh(): Promise<void> {
    if (this.#stopped) return;
    await this.#runCycle();
  }

  stop(): void {
    this.#stopped = true;
    this.#clearTimer();
    const off = this.#unsubscribe;
    this.#unsubscribe = undefined;
    off?.();
  }

  // One cycle is `attempts` requests. A cycle that fails leaves the cache degraded and schedules one retry.
  async #runCycle(): Promise<void> {
    this.#clearTimer();
    for (let i = 0; i < this.#attempts && !this.#stopped; i++) {
      if (await this.#requestOnce()) return;
    }
    if (this.#stopped) return;
    this.#markDegraded();
    this.#scheduleRetry();
  }

  // True when a valid reply arrived, whether or not its version was new enough to adopt.
  async #requestOnce(): Promise<boolean> {
    let reply: string;
    try {
      reply = await this.#transport.request(
        this.#requestSubject,
        JSON.stringify({ life_id: this.#lifeId }),
        this.#timeoutMs,
      );
    } catch {
      return false;
    }
    if (this.#stopped) return false;
    const state = this.#parseState(reply);
    if (!state) {
      if (!this.#loggedInvalidReply) {
        this.#loggedInvalidReply = true;
        this.#say('invalid proficiency reply ignored');
      }
      return false;
    }
    this.#adoptReply(state);
    this.#degraded = false;
    this.#loggedDegraded = false;
    this.#loggedInvalidReply = false;
    return true;
  }

  // A push is advisory: it is validated, and a newer one asks for a reply. It never changes a level or the version.
  #onPush(body: string): void {
    if (this.#stopped) return;
    const result = validateProficiencyLevelPayload(parseJson(body));
    const push = result.ok ? result.value : undefined;
    if (
      !push ||
      push.life_id !== this.#lifeId ||
      !isCount(push.version) ||
      !isCount(push.xp) ||
      levelForXp(push.xp, this.#thresholds) !== push.level
    ) {
      this.#say('invalid proficiency push ignored');
      return;
    }
    if (this.#adopted && push.version <= this.#version) return;
    this.#confirm();
  }

  // One confirming request at a time. The flag is set before the request, so a push emitted synchronously by the
  // transport cannot start a second one.
  #confirm(): void {
    if (this.#confirmInFlight) return;
    this.#confirmInFlight = true;
    void this.#requestOnce()
      .catch(() => false)
      .finally(() => {
        this.#confirmInFlight = false;
      });
  }

  // Adopts a reply whose version is at least the cached one. The first adoption always wins, so a cold start at
  // version 0 fills the cache.
  #adoptReply(state: ParsedState): void {
    if (this.#adopted && state.version < this.#version) return;
    this.#adopted = true;
    this.#version = state.version;
    this.#levels = state.levels;
  }

  #parseState(body: string): ParsedState | null {
    const result = validateProficiencyState(parseJson(body));
    if (!result.ok) return null;
    const value = result.value;
    if (value.life_id !== this.#lifeId || !isCount(value.version)) return null;
    const levels = zeroLevels();
    for (const d of DOMAINS) {
      const { level, xp } = value.levels[d];
      if (!isCount(xp) || levelForXp(xp, this.#thresholds) !== level) return null;
      levels[d] = { level: level as Level, xp };
    }
    return { version: value.version, levels };
  }

  // The log is the Body's; a log that throws must not stop the cache, so every line goes through here.
  #say(line: string): void {
    try {
      this.#log(line);
    } catch {
      // ignored: logging is best effort
    }
  }

  #markDegraded(): void {
    this.#degraded = true;
    if (this.#loggedDegraded) return;
    this.#loggedDegraded = true;
    this.#say(
      'proficiency state unavailable; serving the last adopted state (zero before any) and retrying',
    );
  }

  #scheduleRetry(): void {
    if (this.#stopped || this.#timer !== undefined) return;
    const timer = setTimeout(() => {
      this.#timer = undefined;
      void this.#runCycle().catch(() => undefined);
    }, this.#retryMs);
    // A missed stop() must not hold the process open: the retry is only useful while the host runs.
    timer.unref();
    this.#timer = timer;
  }

  #clearTimer(): void {
    if (this.#timer === undefined) return;
    clearTimeout(this.#timer);
    this.#timer = undefined;
  }
}
