import { describe, expect, it } from 'vitest';
import { validateSnapshot } from '../src/index.ts';

/** The Appendix A example, as in snapshot.test.ts: the perception fields are added per test. */
const example = {
  snapshot_id: 'sn_01HZX3V9Q4M2K8R7T6Y5W4E3D2',
  agent_id: 'ag_kestrel_01',
  shard: 'baseline',
  world_time: { day: 14, time_of_day: 'dusk', ticks: 12400, weather: 'clear' },
  self: {
    position: { x: 120, y: 64, z: -45, biome: 'plains' },
    health: 14,
    hunger: 9,
    armor: 2,
    held_item: 'stone_pickaxe',
    inventory: [
      { item: 'wheat', count: 12 },
      { item: 'oak_log', count: 7 },
      { item: 'written_book', count: 1, book_id: 'bk_3a' },
    ],
    effects: [],
    budget_remaining_thoughts: 61,
    days_since_sleep: 1,
  },
  surroundings: {
    blocks_summary: 'grass plains; oak forest 20 blocks north',
    notable_blocks: [{ type: 'chest', x: 123, y: 64, z: -45 }],
    entities: [{ type: 'zombie', distance: 22, direction: 'north', x: 0, y: 64, z: -22 }],
    agents: [{ name: 'Pike', distance: 6, held_item: 'iron_sword', health_estimate: 'healthy' }],
  },
  heard: [],
  events_since_last_thought: [],
  current_plan: { goal: 'stock food for winter', action: 'mine oak_log', status: 'complete' },
  stuck: null,
  revision: 0,
};

type Json = Record<string, unknown>;

/** A deep copy of the example that a test can change in one place. */
function mutable(): Json {
  return structuredClone(example) as unknown as Json;
}

/** The first nearby agent of a mutable example. */
function firstAgent(value: Json): Json {
  return ((value.surroundings as Json).agents as Json[])[0] as Json;
}

/** The first inventory stack of a mutable example. */
function firstStack(value: Json): Json {
  return ((value.self as Json).inventory as Json[])[0] as Json;
}

describe('nearby agents: vertical and in_reach', () => {
  it('accepts each vertical value and both in_reach values', () => {
    for (const vertical of ['above', 'level', 'below']) {
      for (const in_reach of [true, false]) {
        const value = mutable();
        Object.assign(firstAgent(value), { vertical, in_reach });
        expect(validateSnapshot(value).ok).toBe(true);
      }
    }
  });

  it('leaves both fields optional: an agent without them still validates', () => {
    expect(validateSnapshot(mutable()).ok).toBe(true);
  });

  it('rejects a vertical value outside the enum and names the path', () => {
    const value = mutable();
    firstAgent(value).vertical = 'side';
    const result = validateSnapshot(value);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((error) => error.includes('/surroundings/agents/0/vertical'))).toBe(
      true,
    );
  });

  it('rejects a non-boolean in_reach and names the path', () => {
    const value = mutable();
    firstAgent(value).in_reach = 'yes';
    const result = validateSnapshot(value);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((error) => error.includes('/surroundings/agents/0/in_reach'))).toBe(
      true,
    );
  });

  it('rejects an extra key on a nearby agent', () => {
    const value = mutable();
    firstAgent(value).height_blocks = 2;
    expect(validateSnapshot(value).ok).toBe(false);
  });
});

describe('inventory items: edible', () => {
  it('accepts edible true and false on a stack', () => {
    for (const edible of [true, false]) {
      const value = mutable();
      Object.assign(firstStack(value), { edible });
      expect(validateSnapshot(value).ok).toBe(true);
    }
  });

  it('leaves edible optional: a stack without it still validates', () => {
    expect(validateSnapshot(mutable()).ok).toBe(true);
  });

  it('rejects a non-boolean edible and names the path', () => {
    const value = mutable();
    firstStack(value).edible = 1;
    const result = validateSnapshot(value);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((error) => error.includes('/self/inventory/0/edible'))).toBe(true);
  });

  it('rejects an extra key on a stack', () => {
    const value = mutable();
    firstStack(value).nutrition = 4;
    expect(validateSnapshot(value).ok).toBe(false);
  });
});
