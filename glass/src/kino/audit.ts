/**
 * The Kino pane audit (decision 0075, K06). One entry per pane action, shaped by lakitu-audit: the
 * SHA-256 of the login id, the agent, the pane, the mode and the time, and never a token or a name.
 * The relay awaits `record` before it opens or retargets a pane, so a failed write closes the pane
 * instead of leaving it open unaudited (fail closed).
 */
import { createHash, randomBytes } from 'node:crypto';
import type { SqlClient } from '../query.ts';

export const AUDIT_RETENTION_DAYS = 90;

export type AuditEvent = 'pane_opened' | 'pane_targeted' | 'pane_mode_changed' | 'pane_closed';

export interface AuditEntry {
  event: AuditEvent;
  login_hash: string;
  agent_id: string;
  pane_id: string;
  mode: 'follow' | 'orbit' | 'free';
  at: string;
  stopped_at?: string;
}

export interface AuditStore {
  insert(entry: AuditEntry): Promise<void>;
  /** Deletes rows with `at` before the cutoff (ISO UTC). Returns the count. */
  purgeBefore(cutoffIso: string): Promise<number>;
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** `pn_` plus 26 Crockford base32 characters (a 48-bit time and 80 random bits, as a ULID). */
export function newPaneId(now: number = Date.now()): string {
  let t = now;
  let time = '';
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD[t % 32] + time;
    t = Math.floor(t / 32);
  }
  let rand = '';
  for (const b of randomBytes(16)) rand += CROCKFORD[b % 32];
  return `pn_${time}${rand.slice(0, 16)}`;
}

/** The identity hash is already 64 hex characters; an anonymous viewer is hashed from the session key. */
export function loginHash(identityHash: string | null, sessionKey: string): string {
  if (identityHash !== null && /^[0-9a-f]{64}$/.test(identityHash)) return identityHash;
  return createHash('sha256')
    .update(identityHash ?? sessionKey)
    .digest('hex');
}

/** What the relay uses: `record` rejects when the write fails. */
export interface PaneAudit {
  record(entry: AuditEntry): Promise<void>;
}

export class KinoAudit implements PaneAudit {
  private readonly store: AuditStore;
  private readonly onError: (err: unknown, entry: AuditEntry) => void;

  constructor(store: AuditStore, onError: (err: unknown, entry: AuditEntry) => void = () => {}) {
    this.store = store;
    this.onError = onError;
  }

  /** Writes the entry. A failure is reported through `onError` and rethrown. */
  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.store.insert(entry);
    } catch (err) {
      this.onError(err, entry);
      throw err;
    }
  }

  /** Drops rows older than the retention. A row exactly `days` old stays. */
  async purge(now: Date = new Date(), days: number = AUDIT_RETENTION_DAYS): Promise<number> {
    const cutoff = new Date(now.getTime() - days * 86_400_000);
    return this.store.purgeBefore(cutoff.toISOString());
  }
}

/** The Postgres store behind `geldar_glass`: INSERT on kino_audit and EXECUTE on kino_audit_purge only. */
export function sqlAuditStore(db: SqlClient): AuditStore {
  return {
    async insert(e) {
      await db.query(
        `INSERT INTO kino_audit (event, login_hash, agent_id, pane_id, mode, at, stopped_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [e.event, e.login_hash, e.agent_id, e.pane_id, e.mode, e.at, e.stopped_at ?? null],
      );
    },
    async purgeBefore(cutoffIso) {
      const r = await db.query(`SELECT kino_audit_purge($1) AS n`, [cutoffIso]);
      return Number(r.rows[0]?.n ?? 0);
    },
  };
}
