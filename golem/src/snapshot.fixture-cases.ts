import { createRequire } from 'node:module';
import type { Snapshot } from '@geldar/contract';
import type { Bot } from 'mineflayer';
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

const base: SnapshotOptions = { lifeId: 'ag_kestrel_01', shard: 'phase0', revision: 3 };

/**
 * The snapshots the perception refactor must keep byte-equal (PX-S1). The snapshot id is random,
 * so it is fixed to `sn_FIXTURE` before serializing. Captured from the code before the probe split.
 */
export function fixtureSnapshots(): Record<string, Snapshot> {
  const cases: Record<string, Snapshot> = {
    bare_bot: buildSnapshot(fakeBot(), base),
    time_weather_biome: buildSnapshot(
      fakeBot({
        time: { age: 50_000, timeOfDay: 13_000 },
        isRaining: true,
        thunderState: 1,
        blockAt: () => ({ biome: { name: 'minecraft:dark_forest' } }),
      }),
      base,
    ),
    held_inventory_effects: buildSnapshot(
      fakeBot({
        heldItem: { name: 'stone_pickaxe' },
        inventory: { items: () => [{ name: 'cobblestone', count: 10 }] },
        entity: {
          position: { x: 0, y: 64, z: 0 },
          effects: {
            0: { id: 0, amplifier: 0, duration: 100 },
            3: { id: 3, amplifier: 0, duration: 100 },
          },
        },
        registry: { effects: REGISTRY_EFFECTS },
      }),
      { ...base, budgetRemainingThoughts: 7, daysSinceSleep: 2 },
    ),
    every_optional_field: buildSnapshot(fakeBot({ health: 25, food: 4 }), {
      ...base,
      bodyGeneration: 4,
      unlockedRecipes: ['stone_pickaxe'],
      surroundings: {
        blocks_summary: 'stone x3',
        notable_blocks: [],
        entities: [],
        agents: [],
      },
      heard: [{ from: 'Kestrel', text: 'hello', age_seconds: 4 }],
      events: [],
      currentPlan: { goal: 'mine', action: 'dig', status: 'running' },
      stuck: { action: 'dig', repeat_count: 2 },
    }),
  };
  for (const snap of Object.values(cases)) snap.snapshot_id = 'sn_FIXTURE';
  return cases;
}
