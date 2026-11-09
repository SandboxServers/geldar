import { describe, expect, it } from 'vitest';
import { PgJournal } from './journal.ts';
import type { SqlClient } from './pg-store.ts';

/** A connection that records each statement and reports `rowCount` changed rows. */
function recordingClient(rowCount: number) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const client: SqlClient = {
    query: async (sql, params = []) => {
      calls.push({ sql, params });
      return { rows: [], rowCount };
    },
  };
  return { client, calls };
}

describe('PgJournal.linkIntent', () => {
  it('sets thought_id on an intent row that has none or already has this one', async () => {
    const { client, calls } = recordingClient(1);
    const linked = await new PgJournal(client).linkIntent('in_1', 'th_1');

    expect(linked).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.sql).toContain('thought_id IS NULL OR thought_id = $1');
    expect(calls[0]?.params).toEqual(['th_1', 'in_1']);
  });

  it('reports false when no row changed (no intent row yet, or linked to another thought)', async () => {
    const { client } = recordingClient(0);
    await expect(new PgJournal(client).linkIntent('in_1', 'th_1')).resolves.toBe(false);
  });
});
