import { describe, expect, it } from 'vitest';
import { intentEvent } from './projection.fakes.ts';
import { pgProjectionStore, projectEvent, type Queryable } from './projection.ts';

/** A connection that records every statement; `rows` answers each read. */
function recordingDb(rows: Record<string, unknown>[] = []) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const db: Queryable = {
    query: async (sql, params = []) => {
      calls.push({ sql, params });
      return { rows };
    },
  };
  return { db, calls };
}

describe('pgProjectionStore: the thought link', () => {
  it('keeps a stored thought_id when the projection writes a null one', async () => {
    const { db, calls } = recordingDb();
    await projectEvent(intentEvent('accepted', 100), pgProjectionStore(db));

    const insert = calls.find((c) => c.sql.includes('INSERT INTO intents'));
    expect(insert).toBeDefined();
    // A null thought_id from the event must not overwrite the one Animus stored.
    expect(insert?.sql).toContain('thought_id = COALESCE(EXCLUDED.thought_id, intents.thought_id)');
    expect(insert?.sql).not.toMatch(/thought_id = EXCLUDED\.thought_id/);
    expect(insert?.params.at(-1)).toBeNull();
  });
});
