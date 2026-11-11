import type { Pool } from 'pg';
import { JOURNAL_KEEP, type JournalEntry, type JournalStore } from '../ports.ts';

/** The most characters one journal line holds (the migration's CHECK on `mcp_journal.text`). */
export const JOURNAL_LINE_MAX = 4_000;

/** An append only inserts: mcp_journal refuses DELETE and UPDATE (sql/0007). */
const APPEND_SQL = 'INSERT INTO mcp_journal (life_id, at, text) VALUES ($1, $2, $3)';
const RECENT_SQL = 'SELECT at, text FROM mcp_journal WHERE life_id = $1 ORDER BY id DESC LIMIT $2';

interface JournalRow {
  at: Date;
  text: string;
}

/** The journal mirror in `mcp_journal`: one row per line a player wrote (spec 5.15.6). */
export class PgJournalStore implements JournalStore {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async append(lifeId: string, text: string, atMs: number): Promise<void> {
    // Postgres cannot store a NUL byte in text: drop it rather than fail the append.
    const clean = text.split('\u0000').join('');
    // Code points, as Postgres counts characters, so an emoji is one character here too.
    if ([...clean].length > JOURNAL_LINE_MAX) {
      throw new RangeError(`a journal line holds at most ${JOURNAL_LINE_MAX} characters`);
    }
    await this.pool.query(APPEND_SQL, [lifeId, new Date(atMs), clean]);
  }

  async recent(lifeId: string, limit: number): Promise<JournalEntry[]> {
    if (!Number.isSafeInteger(limit) || limit < 1) {
      throw new RangeError('limit must be a positive integer');
    }
    // The window: a read never returns more than the newest JOURNAL_KEEP lines of a life.
    const window = Math.min(limit, JOURNAL_KEEP);
    const { rows } = await this.pool.query<JournalRow>(RECENT_SQL, [lifeId, window]);
    return rows.reverse().map((row) => ({ at: row.at.getTime(), text: row.text }));
  }
}
