import { validateSnapshot } from '@geldar/contract';
import type { Bot } from 'mineflayer';
import { describe, expect, it } from 'vitest';
import { buildSnapshot, type SnapshotOptions } from './snapshot.ts';

/** A bot stand-in with only the fields the snapshot builder reads. */
function fakeBot(over: Record<string, unknown> = {}): Bot {
  const bot = {
    time: { age: 1000, timeOfDay: 100 },
    thunderState: 0,
    isRaining: false,
    health: 20,
    food: 18,
    heldItem: null,
    inventory: { items: () => [] },
    entity: { position: { x: 10.7, y: 64, z: -3.2 }, effects: {} },
    registry: { effects: {} },
    blockAt: () => null,
    ...over,
  };
  return bot as unknown as Bot;
}

const opts: SnapshotOptions = { lifeId: 'ag_kestrel_01', shard: 'phase0', revision: 3 };

describe('buildSnapshot', () => {
  it('produces a snapshot the contract accepts', () => {
    const snap = buildSnapshot(fakeBot(), opts);
    expect(validateSnapshot(snap).ok).toBe(true);
    expect(snap.snapshot_id).toMatch(/^sn_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(snap.agent_id).toBe('ag_kestrel_01');
    expect(snap.revision).toBe(3);
    expect(snap.self.position).toEqual({ x: 10, y: 64, z: -4 });
  });

  it('maps the time of day to dusk, night, dawn and day', () => {
    const named = (timeOfDay: number) =>
      buildSnapshot(fakeBot({ time: { age: 1000, timeOfDay } }), opts).world_time.time_of_day;
    expect(named(13000)).toBe('dusk');
    expect(named(14000)).toBe('night');
    expect(named(23000)).toBe('dawn');
    expect(named(100)).toBe('day');
  });

  it('takes ticks from the world age and the day from age / 24000', () => {
    const snap = buildSnapshot(fakeBot({ time: { age: 50_000, timeOfDay: 2000 } }), opts);
    expect(snap.world_time).toMatchObject({ ticks: 50_000, day: 2 });
  });

  it('reports the biome only when the block at the feet has one', () => {
    const withBiome = fakeBot({ blockAt: () => ({ biome: { name: 'plains' } }) });
    expect(buildSnapshot(withBiome, opts).self.position).toEqual({
      x: 10,
      y: 64,
      z: -4,
      biome: 'plains',
    });
    expect(buildSnapshot(fakeBot(), opts).self.position).not.toHaveProperty('biome');
    const namespaced = fakeBot({ blockAt: () => ({ biome: { name: 'minecraft:dark_forest' } }) });
    expect(buildSnapshot(namespaced, opts).self.position.biome).toBe('dark_forest');
  });

  it('omits a biome name the contract pattern rejects (26.1 reports an empty name)', () => {
    // Live on 26.1 the block biome came back as { name: '', id: 9 }; the snapshot must still pass.
    for (const name of ['', 'Plains', '9', 'minecraft:']) {
      const bot = fakeBot({ blockAt: () => ({ biome: { name } }) });
      const snap = buildSnapshot(bot, opts);
      expect(snap.self.position).not.toHaveProperty('biome');
      expect(validateSnapshot(snap).ok).toBe(true);
    }
  });

  it('lists inventory stacks, the held item and effect names', () => {
    const bot = fakeBot({
      heldItem: { name: 'stone_pickaxe' },
      inventory: { items: () => [{ name: 'cobblestone', count: 10 }] },
      entity: {
        position: { x: 0, y: 64, z: 0 },
        effects: { 1: { id: 1, amplifier: 0, duration: 100 } },
      },
      registry: { effects: { 1: { name: 'speed' } } },
    });
    const snap = buildSnapshot(bot, { ...opts, budgetRemainingThoughts: 7 });
    expect(snap.self.inventory).toEqual([{ item: 'cobblestone', count: 10 }]);
    expect(snap.self.held_item).toBe('stone_pickaxe');
    expect(snap.self.effects).toEqual(['speed']);
    expect(snap.self.budget_remaining_thoughts).toBe(7);
  });

  it('throws when the contract rejects the result (health above 20)', () => {
    expect(() => buildSnapshot(fakeBot({ health: 25 }), opts)).toThrow(
      /snapshot rejected by the contract/,
    );
  });
});
