import type { Thought } from '@geldar/contract';
import { describe, expect, it } from 'vitest';
import { FakeMemoryStore } from '../fakes/memory.fakes.ts';
import type { AgentRow, ThoughtRow } from '../ports/index.ts';
import { PgJournal } from './journal.ts';
import type { SqlClient } from './pg-store.ts';

/** A connection that records each statement and answers with `rowCount` changed rows and `rows`. */
function recordingClient(rowCount: number, rows: Record<string, unknown>[] = []) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const client: SqlClient = {
    query: async (sql, params = []) => {
      calls.push({ sql, params });
      return { rows, rowCount };
    },
  };
  return { client, calls };
}

/** The fields the fake's journal reads; the rest of a `ThoughtRow` does not matter here. */
function thought(
  lifeId: string,
  thoughtId: string,
  wakeReason: string,
  worldTick: number,
  worldDay = 1,
  parsed: ThoughtRow['parsed'] = null,
): ThoughtRow {
  return { thoughtId, lifeId, wakeReason, worldTick, worldDay, parsed } as ThoughtRow;
}

/** A life row that differs from the others only in its last sleep day. */
function lifeAsleepOn(agentId: string, lastSleepDay: number | null): AgentRow {
  return {
    agentId,
    name: agentId,
    lifeSeq: 1,
    gameAccount: agentId,
    shard: 'shard',
    mode: null,
    declaredModel: null,
    modelConfig: 'model',
    tier: 'fast',
    personalitySeed: null,
    bornAt: null,
    bornDay: 0,
    budgetRemaining: null,
    budgetDaily: null,
    lastSleepDay,
  };
}

describe('PgJournal.linkIntent', () => {
  it('sets thought_id on an intent row of this life that has none or already has this one', async () => {
    const { client, calls } = recordingClient(1);
    const linked = await new PgJournal(client).linkIntent('l', 'in_1', 'th_1');

    expect(linked).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.sql).toContain('thought_id IS NULL OR thought_id = $1');
    expect(calls[0]?.sql).toContain('AND life_id = $3');
    expect(calls[0]?.params).toEqual(['th_1', 'in_1', 'l']);
  });

  it('reports false when no row changed (no intent row yet, or linked to another thought)', async () => {
    const { client } = recordingClient(0);
    await expect(new PgJournal(client).linkIntent('l', 'in_1', 'th_1')).resolves.toBe(false);
  });
});

describe('PgJournal.recordThought replays', () => {
  it('on a thought id collision does nothing, so the first row stays (thoughts is append-only)', async () => {
    const { client, calls } = recordingClient(0);
    await new PgJournal(client).recordThought(thought('l', 'th_1', 'idle', 5));

    const sql = calls[0]?.sql ?? '';
    // A replay of the same thought id is a no-op: the conflict clause names no SET list, so no
    // UPDATE runs (sql/0007 refuses one) and the first row keeps its values.
    expect(sql).toMatch(/ON CONFLICT \(thought_id\) DO NOTHING\s*$/);
    expect(sql).not.toContain('DO UPDATE');
    expect(sql).not.toContain('EXCLUDED');
  });
});

describe('PgJournal.lastReflectionTick', () => {
  it('reads the latest reflection tick of this life, zero when there is none', async () => {
    const { client, calls } = recordingClient(0, [{ tick: '500' }]);
    await expect(new PgJournal(client).lastReflectionTick('l')).resolves.toBe(500);
    expect(calls[0]?.sql).toContain("wake_reason = 'reflection'");
    expect(calls[0]?.sql).toContain('JOIN agents a ON a.agent_id = t.life_id');
    expect(calls[0]?.sql).toContain('t.parsed IS NOT NULL');
    expect(calls[0]?.sql).toContain('t.world_day <= a.last_sleep_day');
    expect(calls[0]?.params).toEqual(['l']);

    const none = recordingClient(0, [{ tick: '0' }]);
    await expect(new PgJournal(none.client).lastReflectionTick('l')).resolves.toBe(0);
  });
});

describe('the fake journal keeps the same life rules', () => {
  it('keeps the first life when another life reuses a thought id', async () => {
    const store = new FakeMemoryStore();
    await store.recordThought(thought('ag_adam_03', 'th_x', 'idle', 5));
    await store.recordThought(thought('ag_other_01', 'th_x', 'idle', 9));

    expect(store.thoughts).toHaveLength(1);
    expect(store.thoughts[0]).toMatchObject({ lifeId: 'ag_adam_03', worldTick: 5 });
  });

  it("does not link another life's intent row", async () => {
    const store = new FakeMemoryStore();
    store.addIntentRow('in_1', null, 'ag_other_01');

    await expect(store.linkIntent('ag_adam_03', 'in_1', 'th_1')).resolves.toBe(false);
    expect(store.intentThought('in_1')).toBeNull();
    await expect(store.linkIntent('ag_other_01', 'in_1', 'th_1')).resolves.toBe(true);
    expect(store.intentThought('in_1')).toBe('th_1');
  });

  it('answers the latest parsed reflection of its own life, no later than its last sleep day', async () => {
    const store = new FakeMemoryStore();
    await expect(store.lastReflectionTick('ag_adam_03')).resolves.toBe(0);
    await store.ensureAgent(lifeAsleepOn('ag_adam_03', 5));
    await store.recordThought(thought('ag_adam_03', 'th_a', 'reflection', 500, 5, {} as Thought));
    await store.recordThought(thought('ag_adam_03', 'th_failed', 'reflection', 700, 5, null));
    await store.recordThought(
      thought('ag_adam_03', 'th_late', 'reflection', 750, 6, {} as Thought),
    );
    await store.recordThought(thought('ag_adam_03', 'th_b', 'idle', 900, 5, {} as Thought));
    await store.recordThought(thought('ag_other_01', 'th_c', 'reflection', 800, 5, {} as Thought));
    await expect(store.lastReflectionTick('ag_adam_03')).resolves.toBe(500);
  });

  it('answers zero for a life that never slept', async () => {
    const store = new FakeMemoryStore();
    await store.ensureAgent(lifeAsleepOn('ag_adam_03', null));
    await store.recordThought(thought('ag_adam_03', 'th_a', 'reflection', 500, 1, {} as Thought));
    await expect(store.lastReflectionTick('ag_adam_03')).resolves.toBe(0);
  });
});
