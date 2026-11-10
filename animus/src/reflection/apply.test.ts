import { describe, expect, it } from 'vitest';
import { FakeEmbedder } from '../fakes/memory.fakes.ts';
import type { Embedder, MemoryRow } from '../ports/index.ts';
import { type ApplyContext, applyReflection, guardProvenance } from './apply.ts';
import { LIFE, reflection, world } from './reflection.fixtures.ts';

function context(over: Partial<ApplyContext> = {}): ApplyContext {
  return {
    lifeId: LIFE,
    day: 3,
    thoughtId: 'th_1',
    degraded: false,
    digest: { ownObservations: [], heard: [] },
    beliefs: [],
    commitments: [],
    ...over,
  };
}

/** Every memory row the fake store holds, active or not (the fake keeps them private). */
function allRows(store: object): MemoryRow[] {
  return (store as { memories: { row: MemoryRow }[] }).memories.map((m) => m.row);
}

const embedder = new FakeEmbedder();

describe('applyReflection', () => {
  it('writes memories, beliefs, summary, relationships and goals, and sets the sleep day', async () => {
    const { store } = await world([]);
    const result = await applyReflection({ store, embedder }, reflection(), context());
    expect(result).toMatchObject({ memoriesWritten: 5, relationshipsUpdated: 1, goalsSet: 1 });
    const rows = allRows(store);
    expect(rows.filter((r) => r.kind === 'episodic' && r.subject === null)).toHaveLength(3);
    const summary = rows.find((r) => r.subject === 'day_summary:3');
    expect(summary).toMatchObject({ kind: 'episodic', text: 'A quiet day.', createdDay: 3 });
    expect(rows.find((r) => r.text === 'The cave holds iron')).toMatchObject({ kind: 'semantic' });
    // A relationship memory has no thought: the store's upsert does not receive one.
    const fromThought = rows.filter((r) => !r.subject?.startsWith('relationship:'));
    expect(fromThought.every((r) => r.sourceThought === 'th_1')).toBe(true);
    const loaded = await store.loadDeterministic(LIFE, 0);
    // Pike has no agent row, so the update is a memory (decision 40), not a relationship row.
    expect(loaded.relationships).toEqual([]);
    expect(rows.find((r) => r.subject === 'relationship:Pike')).toMatchObject({
      kind: 'semantic',
      text: 'Pike: generous (trust 70)',
    });
    expect(loaded.goals).toMatchObject([{ rank: 0, goal: 'mine iron' }]);
    expect(loaded.agent.lastSleepDay).toBe(3);
  });

  it('clamps trust to 0 to 100', async () => {
    const { store } = await world([]);
    const updates = [
      { name: 'Hi', impression: 'x', trust: 140 },
      { name: 'Lo', impression: 'x', trust: -5 },
    ];
    await applyReflection(
      { store, embedder },
      reflection({ relationship_updates: updates as never }),
      context(),
    );
    const texts = allRows(store)
      .filter((r) => r.subject?.startsWith('relationship:'))
      .map((r) => r.text);
    expect(texts).toEqual(['Hi: x (trust 100)', 'Lo: x (trust 0)']);
  });

  it('retires beliefs by active = false and never deletes a row', async () => {
    const { store } = await world([]);
    await store.writeMemories(
      LIFE,
      [
        {
          kind: 'semantic',
          provenance: 'interpretation',
          subject: null,
          text: 'Pike is unreliable',
          createdDay: 1,
          sourceThought: null,
          sourceAgent: null,
          dueTick: null,
        },
      ],
      await embedder.embed(['x'], 'document'),
    );
    const before = allRows(store).length;
    const result = await applyReflection(
      { store, embedder },
      reflection({ beliefs_remove: ['Pike is unreliable'] }),
      context(),
    );
    expect(result.beliefsRemoved).toBe(1);
    const rows = allRows(store);
    // Five memories from the reflection, and the Pike relationship memory.
    expect(rows.length).toBe(before + 6);
    expect(rows.find((r) => r.text === 'Pike is unreliable')?.active).toBe(false);
    const loaded = await store.loadDeterministic(LIFE, 0);
    expect(loaded.beliefs.map((b) => b.text)).not.toContain('Pike is unreliable');
  });

  it('keeps a belief that is added and removed in the same reflection', async () => {
    const { store } = await world([]);
    await applyReflection(
      { store, embedder },
      reflection({ beliefs_remove: ['The cave holds iron'] }),
      context(),
    );
    const loaded = await store.loadDeterministic(LIFE, 0);
    expect(loaded.beliefs.map((b) => b.text)).toContain('The cave holds iron');
  });

  it('degraded: keeps at most 2 memories, applies nothing else, still sets the sleep day', async () => {
    const { store } = await world([]);
    const result = await applyReflection(
      { store, embedder },
      reflection(),
      context({ degraded: true }),
    );
    expect(result).toMatchObject({ memoriesWritten: 2, degraded: true, goalsSet: 0 });
    expect(allRows(store)).toHaveLength(2);
    const loaded = await store.loadDeterministic(LIFE, 0);
    expect(loaded.relationships).toEqual([]);
    expect(loaded.goals).toEqual([]);
    expect(loaded.agent.lastSleepDay).toBe(3);
  });

  it('writes nothing and does not set the sleep day when a step fails, then applies again', async () => {
    const { store } = await world([]);
    const realReplaceGoals = store.replaceGoals.bind(store);
    store.replaceGoals = async () => {
      throw new Error('disk');
    };
    await expect(applyReflection({ store, embedder }, reflection(), context())).rejects.toThrow(
      'disk',
    );
    expect(allRows(store)).toHaveLength(0);
    expect((await store.loadDeterministic(LIFE, 0)).agent.lastSleepDay).toBeNull();
    store.replaceGoals = realReplaceGoals;
    await applyReflection({ store, embedder }, reflection(), context());
    expect(allRows(store)).toHaveLength(6);
    expect((await store.loadDeterministic(LIFE, 0)).agent.lastSleepDay).toBe(3);
  });

  it('stores the memories without vectors when the embedder fails, logs once, and does not throw', async () => {
    const { store } = await world([]);
    const failing: Embedder = {
      dims: 768,
      embed: async () => {
        throw new Error('model down');
      },
    };
    const lines: string[] = [];
    const result = await applyReflection(
      { store, embedder: failing, log: (line) => lines.push(line) },
      reflection(),
      context(),
    );
    expect(result.memoriesWritten).toBe(5);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('embedding failed');
    expect(allRows(store)).toHaveLength(6);
    const [query] = await embedder.embed(['The cave holds iron'], 'query');
    expect(await store.searchSemantic(LIFE, query ?? [], 10)).toEqual([]);
  });

  it('keeps one active relationship memory per unknown name across applies', async () => {
    const { store } = await world([]);
    await applyReflection({ store, embedder }, reflection(), context());
    await applyReflection(
      { store, embedder },
      reflection({
        relationship_updates: [{ name: 'Pike', impression: 'wary', trust: 20 }] as never,
      }),
      context({ day: 4 }),
    );
    const active = allRows(store).filter((r) => r.subject === 'relationship:Pike' && r.active);
    expect(active.map((r) => r.text)).toEqual(['Pike: wary (trust 20)']);
  });

  it('resolves a commitment that the reflection removes', async () => {
    const { store } = await world([]);
    await store.writeMemories(
      LIFE,
      [
        {
          kind: 'semantic',
          provenance: 'commitment',
          subject: null,
          text: 'Meet Pike at the cave',
          createdDay: 1,
          sourceThought: null,
          sourceAgent: null,
          dueTick: null,
        },
      ],
      await embedder.embed(['x'], 'document'),
    );
    const before = await store.loadDeterministic(LIFE, 0);
    expect(before.dueCommitments.map((c) => c.text)).toContain('Meet Pike at the cave');
    await applyReflection(
      { store, embedder },
      reflection({ beliefs_remove: ['Meet Pike at the cave'] }),
      // Commitments are not beliefs (the store's beliefs exclude them), so only the commitments
      // list can resolve it.
      context({ beliefs: before.beliefs, commitments: before.dueCommitments }),
    );
    const after = await store.loadDeterministic(LIFE, 0);
    expect(after.dueCommitments.map((c) => c.text)).not.toContain('Meet Pike at the cave');
    const row = allRows(store).find((r) => r.text === 'Meet Pike at the cave');
    expect(row).toMatchObject({ active: false, resolved: true });
  });
});

describe('guardProvenance', () => {
  const heardOnly = { ownObservations: [], heard: ['Wren said Pike stole the bread'] };

  it('keeps a report a report when the digest has no matching own observation', () => {
    expect(
      guardProvenance('Pike stole the bread', 'observation', { digest: heardOnly, beliefs: [] }),
    ).toBe('report');
  });

  it('keeps an existing report belief a report', () => {
    const beliefs = [{ provenance: 'report', text: 'Pike stole the bread' }] as MemoryRow[];
    expect(
      guardProvenance('Pike stole the bread', 'observation', {
        digest: { ownObservations: [], heard: [] },
        beliefs,
      }),
    ).toBe('report');
  });

  it('allows the promotion when the digest holds a matching own observation', () => {
    const digest = { ...heardOnly, ownObservations: ['saw Pike stole the bread from the chest'] };
    expect(guardProvenance('Pike stole the bread', 'observation', { digest, beliefs: [] })).toBe(
      'observation',
    );
  });

  it('leaves every other kind alone', () => {
    expect(
      guardProvenance('Pike stole the bread', 'report', { digest: heardOnly, beliefs: [] }),
    ).toBe('report');
    expect(
      guardProvenance('Pike may be unreliable', 'interpretation', {
        digest: heardOnly,
        beliefs: [],
      }),
    ).toBe('interpretation');
  });

  it('stores a hearsay belief as a report when applied', async () => {
    const { store } = await world([]);
    await applyReflection(
      { store, embedder },
      reflection({
        beliefs_add: [{ belief: 'Pike stole the bread', kind: 'observation' }] as never,
        memories_to_keep: [],
      }),
      context({ digest: heardOnly }),
    );
    const row = allRows(store).find((r) => r.text === 'Pike stole the bread');
    expect(row).toMatchObject({ kind: 'semantic', provenance: 'report' });
  });
});
