import { isLive, type SessionRow, type SessionStore, slideExpiry } from '../src/session-store.ts';

/** An in-memory session table that outlives the Account using it, like the database does. */
export class FakeSessionStore implements SessionStore {
  /** Every row, keyed by the hex of its session hash. */
  readonly rows = new Map<string, SessionRow>();
  /** When set, every call throws, as a database outage would. */
  fail = false;

  size(): number {
    return this.rows.size;
  }

  private check(): void {
    if (this.fail) throw new Error('database unavailable');
  }

  async create(row: SessionRow): Promise<void> {
    this.check();
    this.rows.set(row.sessionHash.toString('hex'), row);
  }

  async touch(hash: Buffer, nowMs: number): Promise<SessionRow | null> {
    this.check();
    const key = hash.toString('hex');
    const row = this.rows.get(key);
    if (!row || !isLive(row.expiresMs, nowMs)) return null;
    const slid = { ...row, lastSeenMs: nowMs, expiresMs: slideExpiry(row.signedInMs, nowMs) };
    this.rows.set(key, slid);
    return slid;
  }

  async delete(hash: Buffer): Promise<void> {
    this.check();
    this.rows.delete(hash.toString('hex'));
  }

  async sweep(nowMs: number): Promise<void> {
    this.check();
    for (const [key, row] of this.rows) if (!isLive(row.expiresMs, nowMs)) this.rows.delete(key);
  }
}
