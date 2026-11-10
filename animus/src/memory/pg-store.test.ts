import { describe, expect, it } from 'vitest';
import { loadAnimusConfig } from '../config.ts';
import type { AgentRow, NewMemory, ThoughtRow } from '../ports/index.ts';
import { PgJournal } from './journal.ts';
import { PgMemoryStore, type PgPool, poolConfig, type SqlResult } from './pg-store.ts';

interface Call {
  sql: string;
  params: unknown[];
}

/** A pool that records every statement and answers from `answer`. */
function fakePool(answer: (sql: string, params: unknown[]) => Partial<SqlResult> = () => ({})) {
  const calls: Call[] = [];
  const query = async (sql: string, params: unknown[] = []): Promise<SqlResult> => {
    calls.push({ sql, params });
    const r = answer(sql, params);
    return { rows: r.rows ?? [], rowCount: r.rowCount ?? r.rows?.length ?? 0 };
  };
  const pool: PgPool = { query, connect: async () => ({ query, release: () => undefined }) };
  return { pool, calls };
}

const vec = (): number[] => new Array<number>(768).fill(0.25);
const memory: NewMemory = {
  kind: 'episodic',
  provenance: 'observation',
  subject: "x'); DROP TABLE memories;--",
  text: 'it happened',
  createdDay: 2,
  sourceThought: null,
  sourceAgent: null,
  dueTick: null,
};
const agent: AgentRow = {
  agentId: 'ag_kestrel_01',
  name: 'Kestrel',
  lifeSeq: 1,
  gameAccount: 'kestrel_01',
  shard: 'phase0',
  mode: null,
  declaredModel: null,
  modelConfig: 'tag@sha256:x@t0.7@ollama',
  tier: 'local',
  personalitySeed: 'seed',
  bornAt: null,
  bornDay: 1,
  budgetRemaining: null,
  budgetDaily: null,
  lastSleepDay: null,
};

describe('PgMemoryStore', () => {
  it('ensureAgent inserts a headless life and keeps an existing row', async () => {
    const { pool, calls } = fakePool();
    await new PgMemoryStore(pool).ensureAgent(agent);
    expect(calls[0]?.sql).toContain('ON CONFLICT DO NOTHING');
    expect(calls[0]?.params).toContain('headless');
    expect(calls[0]?.params).toContain('tag@sha256:x@t0.7@ollama');
  });

  it('writes the vector as a bound [..]::vector literal and never splices values', async () => {
    const { pool, calls } = fakePool(() => ({ rows: [{ memory_id: '7' }] }));
    const ids = await new PgMemoryStore(pool).writeMemories('ag_kestrel_01', [memory], [vec()]);
    expect(ids).toEqual([7]);
    const insert = calls.find((c) => c.sql.startsWith('INSERT INTO memories'));
    expect(insert?.sql).toContain('$6::vector');
    expect(insert?.sql).not.toContain('DROP TABLE');
    expect(insert?.params[5]).toBe(`[${vec().join(',')}]`);
    expect(calls.map((c) => c.sql)).toContain('BEGIN');
    expect(calls.map((c) => c.sql)).toContain('COMMIT');
  });

  it('writes nothing when the counts differ or a vector is short', async () => {
    const { pool, calls } = fakePool();
    const store = new PgMemoryStore(pool);
    await expect(store.writeMemories('l', [memory], [])).rejects.toThrow(/embeddings/);
    await expect(store.writeMemories('l', [memory], [[1, 2]])).rejects.toThrow(/768/);
    expect(calls).toEqual([]);
  });

  it('stores a NULL embedding when asked', async () => {
    const { pool, calls } = fakePool(() => ({ rows: [{ memory_id: 1 }] }));
    await new PgMemoryStore(pool).writeMemoriesPartial('l', [memory], [null]);
    expect(calls.find((c) => c.sql.startsWith('INSERT INTO memories'))?.params[5]).toBeNull();
  });

  it('rolls back a failed write', async () => {
    const { pool, calls } = fakePool((sql) => {
      if (sql.startsWith('INSERT')) throw new Error('boom');
      return {};
    });
    await expect(
      new PgMemoryStore(pool).writeMemoriesPartial('l', [memory], [null]),
    ).rejects.toThrow('boom');
    expect(calls.at(-1)?.sql).toBe('ROLLBACK');
  });

  it('removes a belief by deactivating it, never by deleting', async () => {
    const { pool, calls } = fakePool(() => ({ rowCount: 2 }));
    expect(await new PgMemoryStore(pool).deactivateBeliefs('l', ['a', 'b'])).toBe(2);
    expect(calls[0]?.sql).toContain('SET active = false');
    expect(calls.some((c) => /DELETE FROM memories/.test(c.sql))).toBe(false);
  });

  it('upserts a relationship when the name resolves to an agents row', async () => {
    const { pool, calls } = fakePool((sql) =>
      sql.startsWith('SELECT agent_id FROM agents') ? { rows: [{ agent_id: 'ag_mara_01' }] } : {},
    );
    await new PgMemoryStore(pool).upsertRelationships(
      'ag_kestrel_01',
      [{ name: 'Mara', impression: 'kind', trust: 70 }],
      3,
    );
    const upsert = calls.find((c) => c.sql.startsWith('INSERT INTO relationships'));
    expect(upsert?.params).toEqual(['ag_kestrel_01', 'ag_mara_01', 'kind', 70, 3]);
    expect(calls.some((c) => c.sql.startsWith('INSERT INTO memories'))).toBe(false);
  });

  it('keeps a relationship with an unknown name as a semantic memory', async () => {
    const { pool, calls } = fakePool((sql) =>
      sql.startsWith('INSERT INTO memories') ? { rows: [{ memory_id: 1 }] } : {},
    );
    await new PgMemoryStore(pool).upsertRelationships(
      'ag_kestrel_01',
      [{ name: 'Steve', impression: 'curious', trust: 60 }],
      3,
    );
    expect(calls.some((c) => c.sql.startsWith('INSERT INTO relationships'))).toBe(false);
    const insert = calls.find((c) => c.sql.startsWith('INSERT INTO memories'));
    expect(insert?.params.slice(1, 5)).toEqual([
      'semantic',
      'interpretation',
      'relationship:Steve',
      'Steve: curious (trust 60)',
    ]);
    expect(insert?.params[5]).toBeNull();
  });

  it('replaces goals in one transaction, rank 0 first', async () => {
    const { pool, calls } = fakePool();
    await new PgMemoryStore(pool).replaceGoals('l', [
      { goal: 'a', why: 'x' },
      { goal: 'b', why: 'y' },
    ]);
    expect(calls.map((c) => c.sql.split(' ')[0])).toEqual([
      'BEGIN',
      'DELETE',
      'INSERT',
      'INSERT',
      'COMMIT',
    ]);
    expect(calls[3]?.params).toEqual(['l', 1, 'b', 'y']);
  });

  it('searches by cosine distance over active, embedded rows of one life', async () => {
    const { pool, calls } = fakePool();
    await new PgMemoryStore(pool).searchEpisodic('l', vec(), 8);
    expect(calls[0]?.sql).toContain('embedding <=> $3::vector');
    expect(calls[0]?.sql).toContain('agent_id = $1');
    expect(calls[0]?.params[3]).toBe(8);
  });

  it('backfills the missing embeddings, oldest first', async () => {
    const { pool, calls } = fakePool((sql) =>
      sql.startsWith('SELECT memory_id') ? { rows: [{ memory_id: '4', text: 't' }] } : {},
    );
    const embedder = { dims: 768, embed: async () => [vec()] };
    expect(await new PgMemoryStore(pool, { embedder }).backfillEmbeddings(10)).toBe(1);
    expect(calls[1]?.sql).toContain('SET embedding = $2::vector');
    expect(calls[1]?.params[0]).toBe('4');
  });

  it('bounds the belief load to the configured limit, newest first', async () => {
    const { pool, calls } = fakePool((sql) =>
      sql.startsWith('SELECT * FROM agents') ? { rows: [{ agent_id: 'l', born_at: null }] } : {},
    );
    await new PgMemoryStore(pool, { maxBeliefs: 12 }).loadDeterministic('l', 5);
    const beliefs = calls.find((c) => c.sql.includes("kind = 'semantic'"));
    expect(beliefs?.sql).toContain('ORDER BY memory_id DESC LIMIT $2');
    expect(beliefs?.params).toEqual(['l', 12]);
  });
});

describe('PgJournal', () => {
  const thought = {
    thoughtId: 'th_1',
    lifeId: 'l',
    at: '2026-01-01T00:00:00.000Z',
    worldDay: 1,
    worldTick: 5,
    wakeReason: 'w',
    snapshot: null,
    modelInput: [{ role: 'user', content: 'hi' }],
    parsed: null,
    providerUsage: null,
  } as unknown as ThoughtRow;

  it('writes the whole thought row as parameters, JSON for the jsonb columns', async () => {
    const { pool, calls } = fakePool();
    await new PgJournal(pool).recordThought(thought);
    expect(calls[0]?.sql).toContain('ON CONFLICT (thought_id) DO UPDATE');
    expect(calls[0]?.params).toHaveLength(23);
    expect(calls[0]?.params[7]).toBe(JSON.stringify(thought.modelInput));
    expect(calls[0]?.params[6]).toBeNull();
  });

  it('writes a suppressed wake', async () => {
    const { pool, calls } = fakePool();
    await new PgJournal(pool).recordSuppressed({
      lifeId: 'l',
      at: '2026-01-01T00:00:00.000Z',
      eventTypes: ['chat', 'move'],
      reason: 'rate_limited' as never,
      intentId: null,
    });
    expect(calls[0]?.sql).toContain('suppressed_wakeups');
    expect(calls[0]?.params).toEqual([
      'l',
      '2026-01-01T00:00:00.000Z',
      ['chat', 'move'],
      'rate_limited',
      null,
    ]);
  });

  it('reads the journal since a tick', async () => {
    const { pool } = fakePool(() => ({
      rows: [{ thought_id: 'th_1', world_day: 1, world_tick: '5', wake_reason: 'w', parsed: null }],
    }));
    expect(await new PgJournal(pool).journalSince('l', 0)).toEqual([
      { thoughtId: 'th_1', worldDay: 1, worldTick: 5, wakeReason: 'w', parsed: null },
    ]);
  });
});

describe('the Postgres pool settings', () => {
  it('bounds every wait: connect, query and statement', async () => {
    const config = await loadAnimusConfig({ env: {}, allowPlaceholders: true });
    expect(poolConfig(config, 'pw')).toMatchObject({
      host: '127.0.0.1',
      port: 5432,
      password: 'pw',
      max: 4,
      connectionTimeoutMillis: 10_000,
      query_timeout: 30_000,
      statement_timeout: 30_000,
    });
  });
});
