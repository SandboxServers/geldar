import { createRequire } from 'node:module';
import { validateSnapshot } from '@geldar/contract';
import type { Bot } from 'mineflayer';
import { describe, expect, it } from 'vitest';
import { buildSnapshot, type SnapshotOptions } from './snapshot.ts';

const require = createRequire(import.meta.url);
/** The 26.1 effect registry from minecraft-data, the same table the live bot's registry comes from. */
const REGISTRY_EFFECTS = (
  require('minecraft-data')('26.1') as { effects: Record<string, { name: string }> }
).effects;

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

  it('switches time of day exactly at each window edge', () => {
    const named = (timeOfDay: number) =>
      buildSnapshot(fakeBot({ time: { age: 1000, timeOfDay } }), opts).world_time.time_of_day;
    expect(named(11999)).toBe('day');
    expect(named(12000)).toBe('dusk');
    expect(named(13799)).toBe('dusk');
    expect(named(13800)).toBe('night');
    expect(named(22299)).toBe('night');
    expect(named(22300)).toBe('dawn');
    expect(named(23999)).toBe('dawn');
    expect(named(0)).toBe('day');
  });

  it('names the weather, with thunder over rain over clear', () => {
    const weather = (over: Record<string, unknown>) =>
      buildSnapshot(fakeBot(over), opts).world_time.weather;
    expect(weather({})).toBe('clear');
    expect(weather({ isRaining: true })).toBe('rain');
    expect(weather({ isRaining: true, thunderState: 1 })).toBe('thunder');
    expect(weather({ isRaining: false, thunderState: 1 })).toBe('thunder');
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
      registry: { effects: REGISTRY_EFFECTS },
    });
    const snap = buildSnapshot(bot, { ...opts, budgetRemainingThoughts: 7 });
    expect(snap.self.inventory).toEqual([{ item: 'cobblestone', count: 10 }]);
    expect(snap.self.held_item).toBe('stone_pickaxe');
    expect(snap.self.effects).toEqual(['slowness']);
    expect(snap.self.budget_remaining_thoughts).toBe(7);
  });

  it('names active effects from the real 26.1 registry in snake_case', () => {
    // minecraft-data 3.117.0 names effects in CamelCase; the contract wants snake_case.
    const active = [0, 3, 10, 21].map((id) => [id, { id, amplifier: 0, duration: 100 }]);
    const bot = fakeBot({
      entity: { position: { x: 0, y: 64, z: 0 }, effects: Object.fromEntries(active) },
      registry: { effects: REGISTRY_EFFECTS },
    });
    const snap = buildSnapshot(bot, opts);
    expect(snap.self.effects).toEqual(['speed', 'mining_fatigue', 'resistance', 'absorption']);
    expect(validateSnapshot(snap).ok).toBe(true);
  });

  it('builds a contract-valid snapshot with every 26.1 effect active', () => {
    const all = Object.keys(REGISTRY_EFFECTS).map((id) => [
      Number(id),
      { id: Number(id), amplifier: 0, duration: 100 },
    ]);
    const bot = fakeBot({
      entity: { position: { x: 0, y: 64, z: 0 }, effects: Object.fromEntries(all) },
      registry: { effects: REGISTRY_EFFECTS },
    });
    const snap = buildSnapshot(bot, opts);
    expect(snap.self.effects).toHaveLength(Object.keys(REGISTRY_EFFECTS).length);
    expect(snap.self.effects).toContain('dolphins_grace');
  });

  it('drops effect ids the registry does not know and names that still fail the contract', () => {
    const bot = fakeBot({
      entity: {
        position: { x: 0, y: 64, z: 0 },
        effects: {
          0: { id: 0, amplifier: 0, duration: 100 },
          999: { id: 999, amplifier: 0, duration: 100 },
          1: { id: 1, amplifier: 0, duration: 100 },
        },
      },
      registry: { effects: { 0: { name: 'Speed' }, 1: { name: 'Odd Name' } } },
    });
    expect(buildSnapshot(bot, opts).self.effects).toEqual(['speed']);
  });

  it('caps health at the contract maximum of 20 (Health Boost can lift it above)', () => {
    expect(buildSnapshot(fakeBot({ health: 25 }), opts).self.health).toBe(20);
    expect(buildSnapshot(fakeBot({ health: 13.5 }), opts).self.health).toBe(13.5);
  });

  it('throws when the contract rejects the result (revision below 0)', () => {
    expect(() => buildSnapshot(fakeBot(), { ...opts, revision: -1 })).toThrow(
      /snapshot rejected by the contract/,
    );
  });

  it('reports enclosed from the solid cells around the feet cell (10, 64, -4)', () => {
    // The feet cell's six neighbours and the cell above the head, as the Body's enclosure needs.
    const pocket: [number, number, number][] = [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 0, 1],
      [0, 0, -1],
      [1, 1, 0],
      [-1, 1, 0],
      [0, 1, 1],
      [0, 1, -1],
      [0, 2, 0],
      [0, -1, 0],
    ];
    const sealed = fakeBot({
      blockAt: (at: { x: number; y: number; z: number }) => ({
        boundingBox: pocket.some(
          ([dx, dy, dz]) => at.x === 10 + dx && at.y === 64 + dy && at.z === -4 + dz,
        )
          ? 'block'
          : 'empty',
      }),
    });
    expect(buildSnapshot(sealed, opts).surroundings.enclosed).toBe(true);
    expect(
      buildSnapshot(fakeBot({ blockAt: () => ({ boundingBox: 'empty' }) }), opts).surroundings
        .enclosed,
    ).toBe(false);
  });
});
