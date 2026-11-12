import { describe, expect, it } from 'vitest';
import { PgDeathStore } from './pg-deaths.ts';
import { FakePool } from './pg-fakes.ts';

describe('PgDeathStore', () => {
  it('reads a life with no death row as zero deaths and no last death day', async () => {
    const pool = new FakePool(() => ({ rows: [] }));
    const store = new PgDeathStore(pool.asPool());
    expect(await store.read('ag_jason_01')).toEqual({ deaths: 0, lastDeathDay: null });
    expect(pool.sent[0]?.text).toContain('mcp_life_deaths');
  });

  it('reads the count and the last death day from mcp_life_deaths', async () => {
    const pool = new FakePool(() => ({ rows: [{ death_count: 2, last_death_day: 7 }] }));
    const store = new PgDeathStore(pool.asPool());
    expect(await store.read('ag_jason_01')).toEqual({ deaths: 2, lastDeathDay: 7 });
  });

  it('records a death in one statement keyed by the event id, so a repeat counts nothing', async () => {
    const pool = new FakePool();
    const store = new PgDeathStore(pool.asPool());
    await store.recordDeath('ag_jason_01', 'ev_01', 7);
    expect(pool.sent).toHaveLength(1);
    expect(pool.sent[0]?.values).toEqual(['ev_01', 'ag_jason_01', 7]);
    expect(pool.sent[0]?.text).toContain('INSERT INTO mcp_death_events');
    expect(pool.sent[0]?.text).toContain('ON CONFLICT (event_id) DO NOTHING');
    expect(pool.sent[0]?.text).toContain('death_count = mcp_life_deaths.death_count + 1');
    expect(pool.sent[0]?.text).not.toMatch(/UPDATE agents/);
  });
});
