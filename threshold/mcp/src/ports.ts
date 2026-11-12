import type {
  BookReply,
  PlanAck,
  PlanMessage,
  PresenceRecord,
  Snapshot,
  SovereignCallPayload,
} from '@geldar/contract';
import type { SimEvent } from '@geldar/mcp-mock';

export type { Clock } from '@geldar/mcp-mock';

/** A sovereign player as the MCP reads it: the `mcp_players` row joined to its owner. */
export interface PlayerRecord {
  /** The launcher player id from the URL path, such as ag-jason-01. */
  playerId: string;
  /** The game account and registry key, such as ag_jason_01. */
  lifeId: string;
  ownerId: string;
  /** The in-universe display name, such as Jason. */
  displayName: string;
  harness: string;
  status: 'active' | 'paused' | 'retired';
}

/** The token a presented Bearer resolved to, and the player it belongs to. */
export interface ResolvedToken {
  tokenId: string;
  player: PlayerRecord;
}

/**
 * The closed list of reasons a 401 or 403 may carry in its log line. A reason never reaches the
 * response, which is identical for every reason; a token, a digest or any part of them never does.
 */
export const REFUSAL_REASONS = [
  'no_header',
  'malformed_scheme',
  'token_shape',
  'unknown_token',
  'token_revoked',
  'token_expired',
  'player_not_active',
  'harness_disabled',
  'owner_retired',
  'owner_over_cap',
  'wrong_player',
  'address_blocked',
  'internal',
] as const;

export type RefusalReason = (typeof REFUSAL_REASONS)[number];

/** The reasons a token store can explain for a digest it did not resolve. */
export type MissReason = Exclude<
  RefusalReason,
  'no_header' | 'malformed_scheme' | 'token_shape' | 'wrong_player' | 'address_blocked'
>;

/** Hashed per-player Bearer tokens (spec 5.15.3; the hash is HMAC with the pepper). */
export interface TokenStore {
  /**
   * The token whose hash matches, when it is active: not expired, not revoked, its player
   * active and its harness enabled. Null for anything else.
   */
  resolve(tokenHash: Uint8Array, nowMs: number): Promise<ResolvedToken | null>;
  /** Records a use of the token. A store may skip the write so it happens at most once a minute. */
  touch(tokenId: string, nowMs: number): Promise<void>;
  /**
   * Says whether the hash is already a cached hit, without a query. Optional: a store without a
   * cache answers false. The front door skips the failed-auth check for a cached hit.
   */
  isCachedHit?(tokenHash: Uint8Array, nowMs: number): boolean;
  /** Calls the listener for every token revoked from now on. Returns the unsubscribe function. */
  onRevoke(listener: (revoked: { tokenId: string; playerId: string }) => void): () => void;
  /**
   * Why `resolve` returned null for this digest, for the log only. Optional: a store without it
   * is logged as `unknown_token`. Called only after a null, so a successful lookup never pays for it.
   */
  explainMiss?(tokenHash: Uint8Array, nowMs: number): Promise<MissReason>;
}

/** Looks up sovereign players by their launcher id. */
export interface PlayerDirectory {
  /** The player with this id, or null. */
  find(playerId: string): Promise<PlayerRecord | null>;
}

/** Credits per life: accrued in real time, reserved before each dispatch, refunded on refusal. */
export interface BudgetLedger {
  /** The credits the life holds at nowMs, after accrual. */
  balance(lifeId: string, nowMs: number): Promise<number>;
  /** Takes the credits when the life can pay; `ok` is false and nothing is taken otherwise. */
  reserve(
    lifeId: string,
    credits: number,
    nowMs: number,
  ): Promise<{ ok: boolean; remaining: number }>;
  /** Gives credits back. Returns the new balance. */
  refund(lifeId: string, credits: number): Promise<number>;
}

/**
 * The Body channel: each request goes to one life's Body over NATS. Every method rejects with
 * `BodyUnavailable` when the Body does not answer in time.
 */
export interface BodyGateway {
  /** The Body's current snapshot. */
  snapshot(lifeId: string): Promise<Snapshot>;
  /** Hands a plan to the Body; the Body's acknowledgement comes back. */
  submitPlan(lifeId: string, plan: PlanMessage): Promise<PlanAck>;
  /** The carried written book, or `no_book`. */
  book(lifeId: string): Promise<BookReply>;
}

/** The error a `BodyGateway` rejects with when its Body does not answer. */
export class BodyUnavailable extends Error {
  override name = 'BodyUnavailable';
}

/** The per-life event log that `wait` reads (spec 5.15.3: the cursor is the stream sequence). */
export interface PlayerEventLog {
  /** Appends one event for a life. A sequence already held is ignored. */
  append(lifeId: string, event: SimEvent): Promise<void>;
  /** The events after the cursor, in order, and how many were lost before the ring's start. */
  since(lifeId: string, cursor: number): Promise<{ events: SimEvent[]; dropped: number }>;
  /** The newest sequence the life holds, 0 when none. A `say` takes its start cursor here. */
  head(lifeId: string): number;
}

/** Presence records in the `geldar-presence` bucket: one per life. */
export interface PresenceStore {
  /** The record for a life, or null when none is written yet. */
  read(lifeId: string): Promise<PresenceRecord | null>;
  /** Asks for the life's Body to be up; the supervisor acts on it. */
  wantBody(lifeId: string, nowMs: number): Promise<void>;
  /** Marks the life as watched now: an open `wait` calls it when it opens, on each poll and when it closes. */
  touch(lifeId: string): Promise<void>;
}

/** One life's sleep mark: the day of the last sleep and the event cursor it read up to. */
export interface SleepMark {
  /** The world day of the last sleep; the birth day before the first. */
  lastSleepDay: number;
  /** The stream sequence the last sleep digested up to; 0 before the first. */
  cursor: number;
}

/** The sleep marks of each life (Postgres in the real server). */
export interface SleepMarks {
  /** The life's mark; a life with no sleep yet reads its birth day and cursor 0. */
  read(lifeId: string): Promise<SleepMark>;
  write(lifeId: string, mark: SleepMark): Promise<void>;
}

/** One life's deaths: how many it has had (0 before the first) and the world day of the last. */
export interface DeathMark {
  deaths: number;
  /** The world day of the last death; null while the life has had none. */
  lastDeathDay: number | null;
}

/** The death count of each life (Postgres in the real server, migration 0023). */
export interface DeathMarks {
  /** The life's mark; a life with no death reads 0 deaths. */
  read(lifeId: string): Promise<DeathMark>;
  /**
   * Counts one death event. A repeated `eventId` (a redelivery or a retry) counts nothing, so the
   * count rises once per death event whatever the number of deliveries.
   */
  recordDeath(lifeId: string, eventId: string, day: number): Promise<void>;
}

/** The per-life facts of the `self` resource, from the `agents` row of the life. */
export interface AgentProfile {
  personality_seed: string;
  born_day: number;
}

/** The agent profile of each life. */
export interface AgentProfiles {
  profile(lifeId: string): Promise<AgentProfile>;
}

/** Writes one `sovereign_call` event per tool call. Holds no world text beyond the payload's limits. */
export interface CallRecorder {
  record(call: SovereignCallPayload): Promise<void>;
}

/** One journal line a player wrote, with the time it was written. */
export interface JournalEntry {
  at: number;
  text: string;
}

/**
 * The newest lines of a life that a read returns. mcp_journal is append-only (sql/0007), so no
 * line is deleted: the window bounds what a read shows. The fake store applies the same window.
 */
export const JOURNAL_KEEP = 1_000;

/** The journal mirror in Postgres, capped per life at 4000 characters a line. */
export interface JournalStore {
  /** Appends a line for a life. */
  append(lifeId: string, text: string, atMs: number): Promise<void>;
  /** The newest `limit` lines, oldest first. */
  recent(lifeId: string, limit: number): Promise<JournalEntry[]>;
}

/** The answer of a rate limiter for one bucket. */
export interface RateDecision {
  allowed: boolean;
  /** Milliseconds until the bucket has a token again; 0 when allowed. */
  retryAfterMs: number;
  /** Whole tokens left in the bucket after this decision, when the limiter reports them. */
  remaining?: number;
}

/** Token buckets by key: a player's calls, an owner's calls, a failed-auth address. */
export interface RateLimiter {
  /** Takes one token from the bucket when there is one. */
  take(bucket: string, nowMs: number): RateDecision;
  /** Says whether the bucket has a token, without taking one. The failed-auth pre-check depends on it. */
  peek(bucket: string, nowMs: number): RateDecision;
}

/** Periodic ticks for an open `wait`, so its stream never idles past a proxy. */
export interface KeepAlive {
  /** Calls tick every intervalMs until the returned function stops the timer. */
  start(intervalMs: number, tick: () => void): () => void;
}
