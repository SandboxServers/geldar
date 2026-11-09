import { describe, expect, it } from 'vitest';
import { FakeEmbedder } from '../fakes/memory.fakes.ts';
import type { MemoryRow } from '../ports/index.ts';
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
    expect(rows.every((r) => r.sourceThought === 'th_1')).toBe(true);
    const loaded = await store.loadDeterministic(LIFE, 0);
    expect(loaded.relationships).toMatchObject([{ otherId: 'Pike', trust: 70, lastSeenDay: 3 }]);
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
    const { relationships } = await store.loadDeterministic(LIFE, 0);
    expect(relationships.map((r) => [r.otherId, r.trust])).toEqual([
      ['Hi', 100],
      ['Lo', 0],
    ]);
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
    expect(rows.length).toBe(before + 5);
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

  it('does not set the sleep day when writing fails', async () => {
    const { store } = await world([]);
    store.writeMemories = async () => {
      throw new Error('disk');
    };
    await expect(applyReflection({ store, embedder }, reflection(), context())).rejects.toThrow(
      'disk',
    );
    expect((await store.loadDeterministic(LIFE, 0)).agent.lastSleepDay).toBeNull();
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
