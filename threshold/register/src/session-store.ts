import { createHash } from 'node:crypto';

/** The sliding window: a session lives 30 minutes past its last activity (C7-01). */
export const SESSION_IDLE_MS = 30 * 60 * 1000;
/** The hard cap: a session ends 12 hours after sign-in, however active it is. */
export const SESSION_CAP_MS = 12 * 60 * 60 * 1000;

export interface SessionRow {
  /** SHA-256 of the cookie's session id. The id itself is never stored. */
  readonly sessionHash: Buffer;
  readonly ownerId: string;
  /** Hex, as the identity store writes it. */
  readonly identityHash: string;
  readonly signedInMs: number;
  readonly lastSeenMs: number;
  readonly expiresMs: number;
}

/** The register's session port. The real one is PgStore; tests use an in-memory fake. */
export interface SessionStore {
  create(row: SessionRow): Promise<void>;
  /** Slides a live session to its new expiry and returns it; null when unknown or expired. Throws on a database error. */
  touch(sessionHash: Buffer, nowMs: number): Promise<SessionRow | null>;
  delete(sessionHash: Buffer): Promise<void>;
  /** Drops every session whose expiry has passed. */
  sweep(nowMs: number): Promise<void>;
}

export const sessionHash = (id: string): Buffer => createHash('sha256').update(id).digest();

/** The expiry after activity at nowMs: 30 minutes on, never past 12 hours from sign-in. */
export const slideExpiry = (signedInMs: number, nowMs: number): number =>
  Math.min(nowMs + SESSION_IDLE_MS, signedInMs + SESSION_CAP_MS);

/** A session is refused at its expiry instant; the last allowed instant is one millisecond before. */
export const isLive = (expiresMs: number, nowMs: number): boolean => nowMs < expiresMs;
