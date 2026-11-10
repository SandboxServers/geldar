import { timingSafeEqual } from 'node:crypto';
import type { PresenceRecord, SovereignCallPayload } from '@geldar/contract';
import type { SimEvent } from '@geldar/mcp-mock';
import type {
  BudgetLedger,
  CallRecorder,
  JournalEntry,
  JournalStore,
  KeepAlive,
  PlayerDirectory,
  PlayerEventLog,
  PlayerRecord,
  PresenceStore,
  RateDecision,
  RateLimiter,
  ResolvedToken,
  TokenStore,
} from '../ports.ts';

/** A token the fake store knows: its hash, its player and when it stops working. */
export interface FakeToken {
  tokenId: string;
  tokenHash: Uint8Array;
  player: PlayerRecord;
  expiresAtMs: number;
  revoked: boolean;
}

/** In-memory `TokenStore`: tokens are added by the test and revoked with `revoke`. */
export class FakeTokenStore implements TokenStore {
  readonly touched: { tokenId: string; nowMs: number }[] = [];
  private readonly tokens = new Map<string, FakeToken>();
  private readonly listeners = new Set<(r: { tokenId: string; playerId: string }) => void>();

  /** Adds a token; a later add with the same id replaces it. */
  add(token: FakeToken): void {
    this.tokens.set(token.tokenId, token);
  }

  /** Revokes a token and tells every listener, as the Postgres NOTIFY would. */
  revoke(tokenId: string): void {
    const token = this.tokens.get(tokenId);
    if (token === undefined) throw new Error(`no fake token ${tokenId}`);
    token.revoked = true;
    for (const listener of this.listeners) listener({ tokenId, playerId: token.player.playerId });
  }

  async resolve(tokenHash: Uint8Array, nowMs: number): Promise<ResolvedToken | null> {
    for (const token of this.tokens.values()) {
      if (!digestEqual(token.tokenHash, tokenHash)) continue;
      const active =
        !token.revoked && nowMs < token.expiresAtMs && token.player.status === 'active';
      return active ? { tokenId: token.tokenId, player: token.player } : null;
    }
    return null;
  }

  async touch(tokenId: string, nowMs: number): Promise<void> {
    this.touched.push({ tokenId, nowMs });
  }

  /** No cache here, so a token that resolves now counts as a cached hit. */
  isCachedHit(tokenHash: Uint8Array, nowMs: number): boolean {
    for (const token of this.tokens.values()) {
      if (!digestEqual(token.tokenHash, tokenHash)) continue;
      return !token.revoked && nowMs < token.expiresAtMs && token.player.status === 'active';
    }
    return false;
  }

  onRevoke(listener: (r: { tokenId: string; playerId: string }) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

/** In-memory `PlayerDirectory`. */
export class FakePlayerDirectory implements PlayerDirectory {
  private readonly players = new Map<string, PlayerRecord>();

  /** Adds or replaces a player. */
  add(player: PlayerRecord): void {
    this.players.set(player.playerId, player);
  }

  async find(playerId: string): Promise<PlayerRecord | null> {
    return this.players.get(playerId) ?? null;
  }
}

/**
 * In-memory `BudgetLedger`: credits accrue at `perHour` up to `cap`. A life first seen starts at
 * the cap. Reserve and refund follow the port's rules; the balance never goes negative.
 */
export class FakeBudgetLedger implements BudgetLedger {
  private readonly held = new Map<string, { credits: number; atMs: number }>();

  private readonly perHour: number;
  private readonly cap: number;

  constructor(perHour: number, cap: number) {
    this.perHour = perHour;
    this.cap = cap;
  }

  /** Sets a life's balance at a time, for a test to start from. */
  seed(lifeId: string, credits: number, atMs: number): void {
    this.held.set(lifeId, { credits, atMs });
  }

  async balance(lifeId: string, nowMs: number): Promise<number> {
    return this.accrue(lifeId, nowMs).credits;
  }

  async reserve(
    lifeId: string,
    credits: number,
    nowMs: number,
  ): Promise<{ ok: boolean; remaining: number }> {
    const state = this.accrue(lifeId, nowMs);
    if (state.credits < credits) return { ok: false, remaining: state.credits };
    state.credits -= credits;
    return { ok: true, remaining: state.credits };
  }

  async refund(lifeId: string, credits: number): Promise<number> {
    const state = this.held.get(lifeId) ?? { credits: 0, atMs: 0 };
    state.credits = Math.min(this.cap, state.credits + credits);
    this.held.set(lifeId, state);
    return state.credits;
  }

  private accrue(lifeId: string, nowMs: number): { credits: number; atMs: number } {
    const state = this.held.get(lifeId) ?? { credits: this.cap, atMs: nowMs };
    const gained = Math.floor(((nowMs - state.atMs) * this.perHour) / 3_600_000);
    if (gained > 0) {
      state.credits = Math.min(this.cap, state.credits + gained);
      state.atMs = nowMs;
    }
    this.held.set(lifeId, state);
    return state;
  }
}

/**
 * In-memory `PlayerEventLog` with a ring of `ringSize` events per life. Events pushed out of the
 * ring count as dropped for a cursor older than them.
 */
export class FakePlayerEventLog implements PlayerEventLog {
  private readonly rings = new Map<string, SimEvent[]>();
  private readonly evicted = new Map<string, number[]>();

  private readonly ringSize: number;

  constructor(ringSize = 1000) {
    this.ringSize = ringSize;
  }

  async append(lifeId: string, event: SimEvent): Promise<void> {
    const ring = this.rings.get(lifeId) ?? [];
    if (ring.some((held) => held.seq === event.seq)) return;
    ring.push(event);
    this.rings.set(lifeId, ring);
    while (ring.length > this.ringSize) {
      const gone = ring.shift();
      if (gone !== undefined)
        this.evicted.set(lifeId, [...(this.evicted.get(lifeId) ?? []), gone.seq]);
    }
  }

  async since(lifeId: string, cursor: number): Promise<{ events: SimEvent[]; dropped: number }> {
    const events = (this.rings.get(lifeId) ?? []).filter((e) => e.seq > cursor);
    const dropped = (this.evicted.get(lifeId) ?? []).filter((seq) => seq > cursor).length;
    return { events, dropped };
  }

  head(lifeId: string): number {
    return (this.rings.get(lifeId) ?? []).reduce((max, e) => Math.max(max, e.seq), 0);
  }
}

/** In-memory `PresenceStore`: `wantBody` writes an awake record that wants the Body up. */
export class FakePresenceStore implements PresenceStore {
  readonly records = new Map<string, PresenceRecord>();
  /** How many times each life was touched, for assertions. */
  readonly touches = new Map<string, number>();

  async touch(lifeId: string): Promise<void> {
    this.touches.set(lifeId, (this.touches.get(lifeId) ?? 0) + 1);
  }

  async read(lifeId: string): Promise<PresenceRecord | null> {
    return this.records.get(lifeId) ?? null;
  }

  async wantBody(lifeId: string, nowMs: number): Promise<void> {
    this.records.set(lifeId, {
      life_id: lifeId,
      state: 'awake',
      desired_body: 'up',
      at: new Date(nowMs).toISOString(),
    });
  }
}

/** A `CallRecorder` that keeps every payload, for assertions. */
export class RecordingCallRecorder implements CallRecorder {
  readonly calls: SovereignCallPayload[] = [];

  async record(call: SovereignCallPayload): Promise<void> {
    this.calls.push(call);
  }
}

/** In-memory `JournalStore`; `recent` returns the newest lines, oldest first. */
export class FakeJournalStore implements JournalStore {
  private readonly lines = new Map<string, JournalEntry[]>();

  async append(lifeId: string, text: string, atMs: number): Promise<void> {
    this.lines.set(lifeId, [...(this.lines.get(lifeId) ?? []), { at: atMs, text }]);
  }

  async recent(lifeId: string, limit: number): Promise<JournalEntry[]> {
    return (this.lines.get(lifeId) ?? []).slice(-limit);
  }
}

/**
 * A `RateLimiter` that answers from a script: `script` is consumed one decision per call, and
 * once it runs out every call is allowed.
 */
export class ScriptedRateLimiter implements RateLimiter {
  readonly taken: { bucket: string; nowMs: number }[] = [];

  private readonly script: RateDecision[];

  constructor(script: RateDecision[] = []) {
    this.script = script;
  }

  take(bucket: string, nowMs: number): RateDecision {
    this.taken.push({ bucket, nowMs });
    return this.script.shift() ?? { allowed: true, retryAfterMs: 0 };
  }
}

/** A `KeepAlive` that never ticks by itself: a test calls `fire` to tick every open timer. */
export class FakeKeepAlive implements KeepAlive {
  private readonly timers = new Set<() => void>();

  start(_intervalMs: number, tick: () => void): () => void {
    this.timers.add(tick);
    return () => this.timers.delete(tick);
  }

  /** Ticks every timer that is running once. */
  fire(): void {
    for (const tick of [...this.timers]) tick();
  }

  /** How many timers are running. */
  get running(): number {
    return this.timers.size;
  }
}

/** Compares two digests in constant time; unequal lengths never match. */
function digestEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
