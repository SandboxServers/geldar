import type { PlanMessage, Snapshot } from '@geldar/contract';
import { describe, expect, it } from 'vitest';
import { newId } from '../ids.ts';
import {
  type AgentRow,
  BodyLinkError,
  type MindEvent,
  ModelError,
  type ModelJob,
  type NewMemory,
} from '../ports/index.ts';
import { FakeBodyLink, FakeEventPublisher, FakeEventSource } from './body.fakes.ts';
import { FakeEmbedder, FakeMemoryStore } from './memory.fakes.ts';
import { FakeModelClient } from './model.fakes.ts';
import { FakeOutputValidator, FakePromptLibrary } from './prompts.fakes.ts';

const JOB: ModelJob = {
  model: 'qwen3:32b',
  messages: [{ role: 'user', content: 'hi' }],
  maxTokens: 10,
  temperature: 0.7,
  deadline: new Date(Date.now() + 1000),
  stablePrefixChars: 0,
};
const LIFE = 'ag_adam_01';

const AGENT: AgentRow = {
  agentId: LIFE,
  name: 'Adam',
  lifeSeq: 1,
  gameAccount: LIFE,
  shard: 'phase0',
  mode: 'headless',
  declaredModel: null,
  modelConfig: 'qwen3:32b@q4_k_m',
  tier: 'strong',
  personalitySeed: null,
  bornAt: null,
  bornDay: 0,
  budgetRemaining: null,
  budgetDaily: null,
  lastSleepDay: null,
};

function memory(text: string, kind: NewMemory['kind'], dueTick: number | null = null): NewMemory {
  return {
    kind,
    provenance: 'observation',
    subject: null,
    text,
    createdDay: 1,
    sourceThought: null,
    sourceAgent: null,
    dueTick,
  };
}

describe('FakeModelClient', () => {
  it('returns its steps in order and records the jobs', async () => {
    const model = new FakeModelClient(['one', { text: 'two', thinkerId: 't', latencyMs: 9 }]);
    const signal = new AbortController().signal;
    expect((await model.complete(JOB, signal)).text).toBe('one');
    expect(await model.complete(JOB, signal)).toEqual({
      text: 'two',
      thinkerId: 't',
      latencyMs: 9,
    });
    expect(model.jobs).toHaveLength(2);
  });

  it('rejects with a scripted error, a cancelled signal and an empty script', async () => {
    const model = new FakeModelClient([new ModelError('timeout', 'slow')]);
    const signal = new AbortController().signal;
    await expect(model.complete(JOB, signal)).rejects.toMatchObject({ code: 'timeout' });
    await expect(model.complete(JOB, signal)).rejects.toMatchObject({ code: 'internal' });
    const aborted = AbortSignal.abort();
    await expect(model.complete(JOB, aborted)).rejects.toMatchObject({ code: 'cancelled' });
  });
});

describe('FakeBodyLink and FakeEventSource', () => {
  const snapshot = { snapshot_id: `sn_${'0'.repeat(26)}` } as Snapshot;

  it('returns the scripted snapshot and ack and records the calls', async () => {
    const link = new FakeBodyLink((reason) => ({ ...snapshot, snapshot_id: reason }) as Snapshot);
    expect((await link.requestSnapshot('wake')).snapshot_id).toBe('wake');
    const plan = { thought_id: newId('th') } as PlanMessage;
    expect(await link.submitPlan(plan)).toEqual({
      thought_id: plan.thought_id,
      accepted: true,
      rejection: null,
    });
    expect(link.snapshotRequests).toEqual(['wake']);
    expect(link.plans).toEqual([plan]);
    link.failWith = new BodyLinkError('timeout', 'no reply');
    await expect(link.requestSnapshot('x')).rejects.toMatchObject({ code: 'timeout' });
  });

  it('delivers events to the life it is subscribed to until unsubscribed', () => {
    const source = new FakeEventSource();
    const seen: string[] = [];
    const stop = source.subscribe(LIFE, (e) => seen.push(e.eventId));
    const event = (lifeId: string, eventId: string): MindEvent =>
      ({ type: 'speech', eventId, lifeId, tick: 1, day: 0, at: 'x', payload: {} }) as MindEvent;
    source.emit(event(LIFE, 'a'));
    source.emit(event('ag_other_01', 'b'));
    stop();
    source.emit(event(LIFE, 'c'));
    expect(seen).toEqual(['a']);
    expect(source.subscriberCount(LIFE)).toBe(0);
  });

  it('keeps what the publisher is given', async () => {
    const publisher = new FakeEventPublisher();
    await publisher.publish({ type: 'thought' } as never);
    expect(publisher.published).toHaveLength(1);
  });
});

describe('FakeEmbedder', () => {
  it('gives 768 unit numbers, the same for the same input and different for another', async () => {
    const embedder = new FakeEmbedder();
    const [a, b] = await embedder.embed(['wood', 'stone'], 'document');
    const [again] = await embedder.embed(['wood'], 'document');
    const [asQuery] = await embedder.embed(['wood'], 'query');
    expect(a).toHaveLength(768);
    expect(a).toEqual(again);
    expect(a).not.toEqual(b);
    expect(a).not.toEqual(asQuery);
    expect(Math.hypot(...(a ?? []))).toBeCloseTo(1, 6);
  });
});

describe('FakeMemoryStore', () => {
  it('stores memories and finds the nearest by life and kind', async () => {
    const store = new FakeMemoryStore();
    const embedder = new FakeEmbedder();
    await store.ensureAgent(AGENT);
    const texts = ['found iron', 'met Eve', 'iron is scarce'];
    const vectors = await embedder.embed(texts, 'document');
    const ids = await store.writeMemories(
      LIFE,
      [
        memory(texts[0] ?? '', 'episodic'),
        memory(texts[1] ?? '', 'episodic'),
        memory(texts[2] ?? '', 'semantic'),
      ],
      vectors,
    );
    expect(ids).toEqual([1, 2, 3]);
    const [query] = await embedder.embed(['met Eve'], 'document');
    const found = await store.searchEpisodic(LIFE, query ?? [], 1);
    expect(found.map((m) => m.text)).toEqual(['met Eve']);
    expect(await store.searchSemantic('ag_other_01', query ?? [], 5)).toEqual([]);
  });

  it('refuses mismatched or short embeddings', async () => {
    const store = new FakeMemoryStore();
    await expect(store.writeMemories(LIFE, [memory('a', 'episodic')], [])).rejects.toThrow(
      'embeddings',
    );
    await expect(store.writeMemories(LIFE, [memory('a', 'episodic')], [[1, 2]])).rejects.toThrow(
      '768',
    );
  });

  it('loads goals, relationships, beliefs and due commitments, and deactivates beliefs', async () => {
    const store = new FakeMemoryStore();
    const [v] = await new FakeEmbedder().embed(['x'], 'document');
    await store.ensureAgent(AGENT);
    await store.writeMemories(
      LIFE,
      [memory('wood is near', 'semantic'), memory('meet Eve at dusk', 'episodic', 500)],
      [v ?? [], v ?? []],
    );
    await store.replaceGoals(LIFE, [{ goal: 'build a house', why: 'shelter' }]);
    await store.upsertRelationships(LIFE, [{ name: 'Eve', impression: 'kind', trust: 70 }], 2);
    await store.setLastSleepDay(LIFE, 2);
    const loaded = await store.loadDeterministic(LIFE, 400);
    expect(loaded.goals).toEqual([
      { agentId: LIFE, rank: 0, goal: 'build a house', why: 'shelter' },
    ]);
    expect(loaded.relationships[0]).toMatchObject({ otherId: 'Eve', trust: 70, lastSeenDay: 2 });
    expect(loaded.beliefs.map((m) => m.text)).toEqual(['wood is near']);
    expect(loaded.dueCommitments).toEqual([]);
    expect((await store.loadDeterministic(LIFE, 500)).dueCommitments).toHaveLength(1);
    expect(loaded.agent.lastSleepDay).toBe(2);
    expect(await store.deactivateBeliefs(LIFE, ['wood is near'])).toBe(1);
    expect((await store.loadDeterministic(LIFE, 0)).beliefs).toEqual([]);
  });

  it('journals thoughts by tick and keeps suppressed wakes', async () => {
    const store = new FakeMemoryStore();
    const row = (tick: number) =>
      ({
        thoughtId: newId('th'),
        lifeId: LIFE,
        worldDay: 0,
        worldTick: tick,
        wakeReason: 'idle',
        parsed: null,
      }) as never;
    await store.recordThought(row(30));
    await store.recordThought(row(10));
    await store.recordThought(row(20));
    expect((await store.journalSince(LIFE, 15)).map((e) => e.worldTick)).toEqual([20, 30]);
    await store.recordSuppressed({
      lifeId: LIFE,
      at: 'x',
      eventTypes: ['speech'],
      reason: 'digested',
      intentId: null,
    });
    expect(store.suppressed).toHaveLength(1);
  });
});

describe('FakePromptLibrary and FakeOutputValidator', () => {
  it('renders a fixed shape and records the call', () => {
    const library = new FakePromptLibrary();
    const render = library.render('thought', {
      agent: { name: 'Adam', lifeId: LIFE, personalitySeed: 's' },
    } as never);
    expect(render.messages[0]?.role).toBe('system');
    expect(render.stablePrefixChars).toBeGreaterThan(0);
    expect(library.renders).toHaveLength(1);
  });

  it('accepts a valid thought and rejects bad output with a code', () => {
    const validator = new FakeOutputValidator();
    const ok = validator.parseThought(JSON.stringify({ reasoning: 'thinking', say: 'hello' }));
    expect(ok.ok).toBe(true);
    expect(validator.parseThought('').ok).toBe(false);
    const notJson = validator.parseThought('nope');
    expect(notJson.ok ? [] : notJson.errors.map((e) => e.code)).toEqual(['not_json']);
    const bad = validator.parseReflection('{}', { degraded: false });
    expect(bad.ok).toBe(false);
    expect(bad.ok ? [] : bad.errors.map((e) => e.code)).toContain('schema');
    expect(
      validator.correctiveMessage([{ code: 'schema', path: '/x', detail: 'd' }]).content,
    ).toContain('schema at /x');
  });
});
