import type { Bot } from 'mineflayer';
import { describe, expect, it, vi } from 'vitest';
import { composeProbes, type Probe } from './perception/compose-probes.ts';
import { buildSnapshot, type SnapshotOptions } from './snapshot.ts';

// The registry gains one injected probe; snapshot.ts must spread the registry, not a copy of it.
vi.mock('./perception/self/index.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./perception/self/index.ts')>();
  const injected: Probe<import('@geldar/contract').Snapshot['self']> = {
    file: 'injected',
    probe: () => ({ unlocked_recipes: ['injected'] }),
  };
  return {
    ...actual,
    selfProbes: (bot: Bot) => composeProbes([...actual.SELF_PROBES, injected], bot),
  };
});

const opts: SnapshotOptions = { lifeId: 'ag_kestrel_01', shard: 'phase0', revision: 3 };

const bot = {
  time: { age: 1000, timeOfDay: 100 },
  thunderState: 0,
  isRaining: false,
  health: 20,
  food: 18,
  heldItem: null,
  inventory: { items: () => [] },
  entity: { position: { x: 0, y: 64, z: 0 }, effects: {} },
  registry: { effects: {} },
  blockAt: () => null,
} as unknown as Bot;

describe('buildSnapshot with an injected self probe', () => {
  it('adds the injected probe field to self, and keeps the gear probe value', () => {
    const snap = buildSnapshot(bot, opts);
    expect(snap.self.unlocked_recipes).toEqual(['injected']);
    expect(snap.self.armor).toBe(0);
  });
});
