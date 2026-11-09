/**
 * Integration test against a live Postgres with pgvector and `sql/0001_init.sql` applied.
 * Skipped unless GELDAR_IT=1. It uses the loopback Postgres of the config; the Ollama round trip
 * also needs GELDAR_OLLAMA=1.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadAnimusConfig } from '../config.ts';
import { FakeEmbedder } from '../fakes/memory.fakes.ts';
import type { AgentRow } from '../ports/index.ts';
import { OllamaEmbedder } from './embedder-ollama.ts';
import { PgJournal } from './journal.ts';
import { openPool, PgMemoryStore } from './pg-store.ts';

const run = process.env.GELDAR_IT === '1';
const suffix = Date.now().toString(36).slice(-6);
const LIFE = `ag_it${suffix}_01`;
const OTHER = `ag_ot${suffix}_01`;

const agent = (agentId: string, name: string): AgentRow => ({
  agentId,
  name,
  lifeSeq: 1,
  gameAccount: `${name}_${suffix}`,
  shard: 'phase0',
  mode: 'headless',
  declaredModel: null,
  modelConfig: 'it@test@t0@ollama',
  tier: 'local',
  personalitySeed: 'seed',
  bornAt: null,
  bornDay: 1,
  budgetRemaining: null,
  budgetDaily: null,
  lastSleepDay: null,
});

describe.skipIf(!run)('memory over live Postgres', () => {
  let pool: Awaited<ReturnType<typeof openPool>>;
  let store: PgMemoryStore;
  const embedder = new FakeEmbedder();

  beforeAll(async () => {
    const config = await loadAnimusConfig({ allowPlaceholders: true });
    pool = await openPool(config);
    store = new PgMemoryStore(pool, { embedder });
    await store.ensureAgent(agent(LIFE, `it${suffix}`));
    await store.ensureAgent(agent(OTHER, `ot${suffix}`));
  });

  afterAll(async () => {
    // Test rows are scoped to this run's ids; remove them so the volume stays clean.
    await pool.query('DELETE FROM suppressed_wakeups WHERE life_id = $1', [LIFE]);
    await pool.query('DELETE FROM thoughts WHERE life_id = $1', [LIFE]);
    await pool.query('DELETE FROM goals WHERE agent_id = $1', [LIFE]);
    await pool.query('DELETE FROM relationships WHERE agent_id = $1', [LIFE]);
    await pool.query('DELETE FROM memories WHERE agent_id = $1', [LIFE]);
    await pool.query('DELETE FROM agents WHERE agent_id = ANY($1)', [[LIFE, OTHER]]);
    await pool.end();
  });

  it('round-trips memories, commitments, goals, relationships and the HNSW search', async () => {
    const texts = ['saw a wolf', 'found iron', 'met Mara'];
    const vectors = await embedder.embed(texts, 'document');
    const base = {
      provenance: 'observation',
      subject: null,
      sourceThought: null,
      sourceAgent: null,
      dueTick: null,
      createdDay: 1,
    } as const;
    await store.writeMemories(
      LIFE,
      texts.map((text) => ({ ...base, kind: 'episodic', text })),
      vectors,
    );
    const [due] = await store.writeMemories(
      LIFE,
      [
        {
          ...base,
          kind: 'episodic',
          provenance: 'commitment',
          text: 'meet at sunset',
          dueTick: 100,
        },
      ],
      await embedder.embed(['meet at sunset'], 'document'),
    );
    await store.replaceGoals(LIFE, [
      { goal: 'build', why: 'shelter' },
      { goal: 'eat', why: 'hunger' },
    ]);
    await store.upsertRelationships(
      LIFE,
      [
        { name: `ot${suffix}`, impression: 'friendly', trust: 80 },
        { name: 'someone unknown', impression: 'odd', trust: 40 },
      ],
      2,
    );

    const loaded = await store.loadDeterministic(LIFE, 200);
    expect(loaded.goals.map((g) => g.goal)).toEqual(['build', 'eat']);
    expect(loaded.dueCommitments.map((m) => m.memoryId)).toEqual([due]);
    expect(loaded.relationships.map((r) => r.otherId)).toEqual([OTHER]);
    expect(loaded.beliefs.map((b) => b.subject)).toEqual(['relationship:someone unknown']);

    const [query] = await embedder.embed(['found iron'], 'document');
    const nearest = await store.searchEpisodic(LIFE, query ?? [], 1);
    expect(nearest[0]?.text).toBe('found iron');

    expect(await store.deactivateBeliefs(LIFE, ['someone unknown: odd (trust 40)'])).toBe(1);
    await new PgJournal(pool).recordSuppressed({
      lifeId: LIFE,
      at: new Date().toISOString(),
      eventTypes: ['chat'],
      reason: 'rate_limited' as never,
      intentId: null,
    });
  });

  it.skipIf(process.env.GELDAR_OLLAMA !== '1')(
    'backfills a NULL embedding through Ollama',
    async () => {
      const config = await loadAnimusConfig({ allowPlaceholders: true });
      const real = new OllamaEmbedder({
        baseUrl: config.ollamaUrl,
        model: config.embedding.model,
        onCpu: config.embedding.onCpu,
      });
      const s = new PgMemoryStore(pool, { embedder: real });
      await s.writeMemoriesPartial(
        LIFE,
        [
          {
            kind: 'episodic',
            provenance: 'observation',
            subject: null,
            text: 'unembedded',
            createdDay: 1,
            sourceThought: null,
            sourceAgent: null,
            dueTick: null,
          },
        ],
        [null],
      );
      expect(await s.backfillEmbeddings(50)).toBeGreaterThanOrEqual(1);
    },
  );
});
