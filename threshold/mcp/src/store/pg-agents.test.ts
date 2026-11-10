import { describe, expect, it } from 'vitest';
import { PgAgentStore } from './pg-agents.ts';
import { FakePool } from './pg-fakes.ts';

describe('PgAgentStore sleep marks', () => {
  it('reads the mark from mcp_sleep_marks with the real cursor, and born_day with no mark', async () => {
    const pool = new FakePool(() => ({
      rows: [{ born_day: 4, last_sleep_day: 9, sleep_cursor: '37' }],
    }));
    const store = new PgAgentStore(pool.asPool());
    expect(await store.read('ag_jason_01')).toEqual({ lastSleepDay: 9, cursor: 37 });
    expect(pool.sent[0]?.text).toContain('mcp_sleep_marks');
  });

  it('falls back to born_day and cursor 0 when there is no mark row yet', async () => {
    const pool = new FakePool(() => ({
      rows: [{ born_day: 4, last_sleep_day: null, sleep_cursor: null }],
    }));
    const store = new PgAgentStore(pool.asPool());
    expect(await store.read('ag_jason_01')).toEqual({ lastSleepDay: 4, cursor: 0 });
  });

  it('writes the mark as an upsert into mcp_sleep_marks, never an UPDATE of agents', async () => {
    const pool = new FakePool();
    const store = new PgAgentStore(pool.asPool());
    await store.write('ag_jason_01', { lastSleepDay: 9, cursor: 37 });
    expect(pool.sent[0]?.values).toEqual(['ag_jason_01', 9, 37]);
    expect(pool.sent[0]?.text).toContain('INSERT INTO mcp_sleep_marks');
    expect(pool.sent[0]?.text).toContain('ON CONFLICT (life_id) DO UPDATE');
    expect(pool.sent[0]?.text).not.toMatch(/UPDATE agents/);
  });
});
