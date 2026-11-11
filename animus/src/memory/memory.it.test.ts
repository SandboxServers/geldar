/**
 * Integration test against a live Postgres with pgvector and `sql/0001_init.sql` applied.
 * Skipped unless GELDAR_IT=1. It uses the loopback Postgres of the config; the Ollama round trip
 * also needs GELDAR_OLLAMA=1.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadAnimusConfig } from '../config.ts';
import { FakeEmbedder } from '../fakes/memory.fakes.ts';
import type { AgentRow } from '../ports/index.ts';
import { type ApplyContext, applyReflection } from '../reflection/apply.ts';
import { reflection } from '../reflection/reflection.fixtures.ts';
import { OllamaEmbedder } from './embedder-ollama.ts';
import { PgJournal } from './journal.ts';
import { openPool, PgMemoryStore } from './pg-store.ts';
import { assertConnectedToThrowaway } from './throwaway-db.ts';

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

/** The context an apply of a reflection on LIFE needs, with no digest observations. */
const applyContext = (over: Partial<ApplyContext> = {}): ApplyContext => ({
  lifeId: LIFE,
  day: 1,
  thoughtId: 'th_it',
  degraded: false,
  digest: { ownObservations: [], heard: [] },
  beliefs: [],
  commitments: [],
  ...over,
});

describe.skipIf(!run)('memory over live Postgres', () => {
  let pool: Awaited<ReturnType<typeof openPool>>;
  let store: PgMemoryStore;
  const embedder = new FakeEmbedder();

  beforeAll(async () => {
    const config = await loadAnimusConfig({ allowPlaceholders: true });
    pool = await openPool(config);
    await assertConnectedToThrowaway(pool);
    store = new PgMemoryStore(pool, { embedder });
    await store.ensureAgent(agent(LIFE, `it${suffix}`));
    await store.ensureAgent(agent(OTHER, `ot${suffix}`));
  });

  afterAll(async () => {
    // Test rows are scoped to this run's ids; remove them so the volume stays clean.
    // suppressed_wakeups and thoughts are append-only (sql/0007): a row delete is refused, so they
    // are truncated. TRUNCATE clears every life's rows, so the guard refuses a real database.
    // The pool closes in finally: a refused guard must not leave it open.
    try {
      await assertConnectedToThrowaway(pool);
      await pool.query('TRUNCATE suppressed_wakeups, thoughts');
      await pool.query('DELETE FROM goals WHERE agent_id = $1', [LIFE]);
      await pool.query('DELETE FROM relationships WHERE agent_id = $1', [LIFE]);
      await pool.query('DELETE FROM memories WHERE agent_id = $1', [LIFE]);
      await pool.query('DELETE FROM agents WHERE agent_id = ANY($1)', [[LIFE, OTHER]]);
    } finally {
      await pool?.end();
    }
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
    const goals = [
      { goal: 'build', why: 'shelter' },
      { goal: 'eat', why: 'hunger' },
    ];
    await applyReflection(
      { store, embedder },
      reflection({
        memories_to_keep: [],
        beliefs_add: [{ belief: 'meet at sunset', kind: 'commitment' }] as never,
        relationship_updates: [{ name: 'someone unknown', impression: 'odd', trust: 40 }],
        goals: goals as never,
      }),
      applyContext(),
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
    expect(loaded.dueCommitments.map((m) => m.text)).toEqual(['meet at sunset']);
    expect(loaded.relationships.map((r) => r.otherId)).toEqual([OTHER]);
    expect(loaded.beliefs.map((b) => b.subject)).toContain('relationship:someone unknown');

    const [query] = await embedder.embed(['found iron'], 'document');
    const nearest = await store.searchEpisodic(LIFE, query ?? [], 1);
    expect(nearest[0]?.text).toBe('found iron');

    const removed = await applyReflection(
      { store, embedder },
      reflection({
        memories_to_keep: [],
        beliefs_add: [],
        beliefs_remove: ['meet at sunset'],
        goals: goals as never,
      }),
      applyContext({ beliefs: loaded.beliefs }),
    );
    expect(removed.beliefsRemoved).toBe(1);
    expect((await store.loadDeterministic(LIFE, 200)).dueCommitments).toEqual([]);
    await new PgJournal(pool).recordSuppressed({
      lifeId: LIFE,
      at: new Date().toISOString(),
      eventTypes: ['chat'],
      reason: 'rate_limited' as never,
      intentId: null,
    });
  });

  it('setBornDay is write-once: a later call keeps the birth day already set', async () => {
    // LIFE was created with bornDay 1 in beforeAll; the COALESCE in setBornDay must keep it.
    await store.setBornDay(LIFE, 5);
    const { agent: loaded } = await store.loadDeterministic(LIFE, 0);
    expect(loaded.bornDay).toBe(1);
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
