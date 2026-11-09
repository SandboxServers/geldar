import { describe, expect, it } from 'vitest';
import { FakeEmbedder, FakeMemoryStore } from '../fakes/memory.fakes.ts';
import type {
  AgentRow,
  Embedder,
  MemoryStore,
  NewMemory,
  RelationshipRow,
} from '../ports/index.ts';
import {
  isFatigued,
  MemoryRetriever,
  type RetrievalRequest,
  rankRelationships,
} from './retrieval.ts';

const LIFE = 'ag_kestrel_01';
const settings = { workingWindow: 20, episodicTopK: 8, fatigueDays: 3 };

const agent: AgentRow = {
  agentId: LIFE,
  name: 'Kestrel',
  lifeSeq: 1,
  gameAccount: 'kestrel_01',
  shard: 'phase0',
  mode: 'headless',
  declaredModel: null,
  modelConfig: 'm@q@s@ollama',
  tier: 'local',
  personalitySeed: 'seed',
  bornAt: null,
  bornDay: 0,
  budgetRemaining: null,
  budgetDaily: null,
  lastSleepDay: 0,
};

const memory = (over: Partial<NewMemory>): NewMemory => ({
  kind: 'episodic',
  provenance: 'observation',
  subject: null,
  text: 'text',
  createdDay: 1,
  sourceThought: null,
  sourceAgent: null,
  dueTick: null,
  ...over,
});

const request = (over: Partial<RetrievalRequest> = {}): RetrievalRequest => ({
  lifeId: LIFE,
  nowTick: 1000,
  nowDay: 1,
  visibleAgents: [],
  notableThings: [],
  query: 'what now',
  ...over,
});

class FailingEmbedder implements Embedder {
  readonly dims = 768;
  async embed(): Promise<number[][]> {
    throw new Error('ollama is down');
  }
}

async function setup(embedder: Embedder = new FakeEmbedder()) {
  const store = new FakeMemoryStore();
  await store.ensureAgent(agent);
  const failures: unknown[] = [];
  const retriever = new MemoryRetriever(store, store, embedder, settings, {
    onEmbedFailure: (e) => failures.push(e),
  });
  const fake = new FakeEmbedder();
  const write = async (memories: NewMemory[]) =>
    store.writeMemories(
      LIFE,
      memories,
      await fake.embed(
        memories.map((m) => m.text),
        'document',
      ),
    );
  return { store, retriever, failures, write };
}

describe('commitments', () => {
  it('are always loaded, even when nothing resembles the query', async () => {
    const { retriever, write } = await setup();
    await write([
      memory({ provenance: 'commitment', text: 'meet at sunset', dueTick: 900 }),
      memory({ provenance: 'commitment', text: 'earlier promise', dueTick: 500 }),
      memory({ provenance: 'commitment', text: 'not yet due', dueTick: 5000 }),
    ]);
    const got = await retriever.retrieve(request({ query: 'something unrelated' }));
    expect(got.commitments.map((c) => c.text)).toEqual(['earlier promise', 'meet at sunset']);
  });

  it('are not repeated among the episodic memories', async () => {
    const { retriever, write } = await setup();
    await write([
      memory({ provenance: 'commitment', text: 'meet at sunset', dueTick: 900 }),
      memory({ text: 'saw a wolf' }),
    ]);
    const got = await retriever.retrieve(request({ query: 'meet at sunset' }));
    expect(got.episodic.map((m) => m.text)).toEqual(['saw a wolf']);
  });
});

describe('relationships', () => {
  const rel = (otherId: string, trust: number, lastSeenDay: number | null): RelationshipRow => ({
    agentId: LIFE,
    otherId,
    impression: '',
    trust,
    lastSeenDay,
  });

  it('rank by trust magnitude, then recency', () => {
    const order = rankRelationships([
      rel('a', 50, 9),
      rel('b', 95, 1),
      rel('c', 10, 5),
      rel('d', 10, 7),
    ]);
    expect(order.map((r) => r.otherId)).toEqual(['b', 'd', 'c', 'a']);
  });

  it('keeps six in full and names the rest, for visible agents only', async () => {
    const { store, retriever } = await setup();
    const names = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    // Each name is a real agents row, so the store writes a relationships row.
    for (const [i, n] of names.entries()) {
      await store.ensureAgent({ ...agent, agentId: `ag_${n}_01`, name: n, gameAccount: `${n}_01` });
      await store.upsertRelationships(
        LIFE,
        [{ name: n, impression: n, trust: 50 + (i + 1) * 5 }],
        1,
      );
    }
    await store.ensureAgent({ ...agent, agentId: 'ag_z_01', name: 'z', gameAccount: 'z_01' });
    await store.upsertRelationships(LIFE, [{ name: 'z', impression: 'far away', trust: 100 }], 1);
    const got = await retriever.retrieve(request({ visibleAgents: names }));
    expect(got.relationships.map((r) => r.otherId)).toEqual(['h', 'g', 'f', 'e', 'd', 'c']);
    expect(got.relationshipsNamedOnly).toEqual(['b', 'a']);
  });
});

describe('beliefs', () => {
  it('load when the subject matches a visible agent or a notable thing', async () => {
    const { retriever, write } = await setup();
    await write([
      memory({ kind: 'semantic', subject: 'Mara', text: 'Mara trades fairly' }),
      memory({ kind: 'semantic', subject: 'relationship:Mara', text: 'Mara: kind' }),
      memory({ kind: 'semantic', subject: 'oak door', text: 'doors open' }),
      memory({ kind: 'semantic', subject: 'Other', text: 'unrelated' }),
    ]);
    const got = await retriever.retrieve(
      request({ visibleAgents: ['mara'], notableThings: ['oak door'] }),
    );
    expect(got.beliefs.map((b) => b.text).sort()).toEqual([
      'Mara trades fairly',
      'Mara: kind',
      'doors open',
    ]);
  });
});

describe('episodic memory', () => {
  it('is limited to episodic_top_k', async () => {
    const { retriever, write } = await setup();
    await write(Array.from({ length: 12 }, (_, i) => memory({ text: `event ${i}` })));
    expect((await retriever.retrieve(request())).episodic).toHaveLength(8);
  });
});

describe('the working window', () => {
  async function withThoughts(lastSleepDay: number) {
    const s = await setup();
    s.store.agents.set(LIFE, { ...agent, lastSleepDay });
    for (let i = 0; i < 30; i++) {
      await s.store.recordThought({
        thoughtId: `th_${i}`,
        lifeId: LIFE,
        worldTick: i,
        worldDay: 1,
        wakeReason: 'test',
      } as never);
    }
    return s;
  }

  it('holds the last 20 entries when rested', async () => {
    const { retriever } = await withThoughts(1);
    const got = await retriever.retrieve(request({ nowDay: 1 }));
    expect(got.fatigued).toBe(false);
    expect(got.workingWindow.map((e) => e.worldTick)).toEqual(
      Array.from({ length: 20 }, (_, i) => i + 10),
    );
  });

  it('holds the last 10 entries when fatigued', async () => {
    const { retriever } = await withThoughts(0);
    const got = await retriever.retrieve(request({ nowDay: 3 }));
    expect(got.fatigued).toBe(true);
    expect(got.workingWindow.map((e) => e.worldTick)).toEqual(
      Array.from({ length: 10 }, (_, i) => i + 20),
    );
  });

  it('counts days awake from the last sleep, or from birth', () => {
    expect(isFatigued({ ...agent, lastSleepDay: 2 }, 4, 3)).toBe(false);
    expect(isFatigued({ ...agent, lastSleepDay: 2 }, 5, 3)).toBe(true);
    expect(isFatigued({ ...agent, lastSleepDay: null, bornDay: 1 }, 4, 3)).toBe(true);
  });
});

describe('an embedder failure', () => {
  it('degrades retrieval to the deterministic part, logged and counted', async () => {
    const { retriever, write, failures } = await setup(new FailingEmbedder());
    await write([
      memory({ provenance: 'commitment', text: 'meet', dueTick: 10 }),
      memory({ text: 'e' }),
    ]);
    const got = await retriever.retrieve(request());
    expect(got.degraded).toBe(true);
    expect(got.episodic).toEqual([]);
    expect(got.commitments).toHaveLength(1);
    expect(retriever.degradedCount).toBe(1);
    expect(failures).toHaveLength(1);
  });

  it('stores a write with a NULL embedding instead of failing it', async () => {
    const { retriever, failures } = await setup(new FailingEmbedder());
    const written: (number[] | null)[][] = [];
    const store = {
      writeMemoriesPartial: async (_l: string, m: NewMemory[], e: (number[] | null)[]) => {
        written.push(e);
        return m.map((_, i) => i + 1);
      },
    } as unknown as MemoryStore;
    const ids = await retriever.remember(store, LIFE, [memory({}), memory({})]);
    expect(ids).toEqual([1, 2]);
    expect(written).toEqual([[null, null]]);
    expect(retriever.degradedCount).toBe(1);
    expect(failures).toHaveLength(1);
  });
});
