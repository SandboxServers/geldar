// The Body's proficiency cache (AN-11b; decisions 0280, 0186 D-CS-04 and D-CS-07).
// Until a fresh state arrives it serves zeros, records degraded and retries. A version never goes down: a reply or
// push whose version is not above the cached one is ignored, so a reconnect cannot undo a newer level.
// A level push is not authority on its own: 0280 records that the body role can publish on the level subject until
// the ACL follow-up lands. The push goes through the same version and validation rules as a reply.
// CharacterSheet and Score are psyche's types; the reply's sheet is converted at the boundary by normalizeSheet.
import { createHash } from 'node:crypto';
import { validateProficiencyLevelPayload, validateProficiencyState } from '@geldar/contract';
import {
  type CharacterSheet,
  canonicalSheetJson,
  DEFAULT_THRESHOLDS,
  type Domain,
  type Level,
  levelForXp,
  normalizeSheet,
} from '@geldar/psyche';

export interface StateTransport {
  request(subject: string, body: string, timeoutMs: number): Promise<string>; // rejects on timeout or no responders
  subscribe(subject: string, onMessage: (body: string) => void): () => void; // returns unsubscribe
}

type DomainLevel = { level: Level; xp: number };
type Levels = Record<Domain, DomainLevel>;
type BaselineSheet = { sheet: CharacterSheet; hash: string };
interface ParsedState {
  version: number;
  levels: Levels;
  sheet: BaselineSheet | null;
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

function zeroLevels(): Levels {
  const out = {} as Levels;
  for (const d of DOMAINS) out[d] = { level: 0, xp: 0 };
  return out;
}

// geldar.<shard>.state.<life>.<leaf> (decision 0280). The contract's subject helpers are not re-exported from its
// index, so the two strings are built here with the same refusal: a token holds no dot and no wildcard.
function stateSubject(shard: string, lifeId: string, leaf: 'proficiency' | 'level'): string {
  const token = /^[A-Za-z0-9_-]+$/;
  if (!token.test(shard) || !token.test(lifeId)) {
    throw new RangeError('shard and life id must be single subject tokens');
  }
  return `geldar.${shard}.state.${lifeId}.${leaf}`;
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
  #sheet: BaselineSheet | null = null;
  #degraded = true;
  #loggedDegraded = false;
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

  // Subscribe to the push first, then request, so a level change during start is not lost. Never throws.
  async start(): Promise<void> {
    if (this.#stopped) return;
    try {
      this.#unsubscribe = this.#transport.subscribe(this.#pushSubject, (body) =>
        this.#onPush(body),
      );
    } catch {
      this.#log('proficiency push subscription failed; relying on requests');
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

  get baseline(): { sheet: CharacterSheet; hash: string } | null {
    return this.#sheet;
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
      this.#log('invalid proficiency reply ignored');
      return false;
    }
    this.#accept(state.version, () => {
      this.#levels = state.levels;
      if (state.sheet) this.#sheet = state.sheet;
    });
    this.#degraded = false;
    this.#loggedDegraded = false;
    return true;
  }

  #onPush(body: string): void {
    if (this.#stopped) return;
    const result = validateProficiencyLevelPayload(parseJson(body));
    const push = result.ok ? result.value : undefined;
    if (
      !push ||
      push.life_id !== this.#lifeId ||
      levelForXp(push.xp, this.#thresholds) !== push.level
    ) {
      this.#log('invalid proficiency push ignored');
      return;
    }
    const domain = push.domain as Domain;
    this.#accept(push.version, () => {
      this.#levels[domain] = { level: push.level as Level, xp: push.xp };
    });
  }

  // Adopts a message only when its version is above the cached one. The first adoption always wins, so a
  // cold start at version 0 is not mistaken for an equal version.
  #accept(version: number, apply: () => void): boolean {
    if (this.#adopted && version <= this.#version) return false;
    apply();
    this.#adopted = true;
    this.#version = version;
    return true;
  }

  #parseState(body: string): ParsedState | null {
    const result = validateProficiencyState(parseJson(body));
    if (!result.ok) return null;
    const value = result.value;
    if (value.life_id !== this.#lifeId) return null;
    const levels = zeroLevels();
    for (const d of DOMAINS) {
      const { level, xp } = value.levels[d];
      if (levelForXp(xp, this.#thresholds) !== level) return null;
      levels[d] = { level: level as Level, xp };
    }
    let sheet: BaselineSheet | null = null;
    if (value.sheet !== undefined) {
      const normalized = normalizeSheet(value.sheet);
      if (!normalized.ok) return null;
      const hash =
        value.sheet_hash ??
        createHash('sha256').update(canonicalSheetJson(normalized.sheet)).digest('hex');
      sheet = { sheet: normalized.sheet, hash };
    }
    return { version: value.version, levels, sheet };
  }

  #markDegraded(): void {
    this.#degraded = true;
    if (this.#loggedDegraded) return;
    this.#loggedDegraded = true;
    this.#log(
      'proficiency state unavailable; serving the last adopted state (zero before any) and retrying',
    );
  }

  #scheduleRetry(): void {
    if (this.#stopped || this.#timer !== undefined) return;
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      void this.#runCycle();
    }, this.#retryMs);
  }

  #clearTimer(): void {
    if (this.#timer === undefined) return;
    clearTimeout(this.#timer);
    this.#timer = undefined;
  }
}
