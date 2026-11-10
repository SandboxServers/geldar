import { describe, expect, it } from 'vitest';
import { findStale } from '../scripts/generator.ts';
import { validateSnapshot } from '../src/index.ts';

/** The Appendix A example, with revision 0 and IDs that are valid ULIDs. */
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
    blocks_summary:
      'grass plains; oak forest 20 blocks north; your bed 8 blocks east; a chest 3 blocks east; water 15 blocks south',
    notable_blocks: [
      { type: 'chest', x: 123, y: 64, z: -45 },
      {
        type: 'oak_sign',
        x: 118,
        y: 65,
        z: -40,
        text: "KESTREL'S FIELD - DO NOT TAKE",
      },
    ],
    entities: [{ type: 'zombie', distance: 22, direction: 'north' }],
    agents: [{ name: 'Pike', distance: 6, held_item: 'iron_sword', health_estimate: 'healthy' }],
  },
  heard: [{ from: 'Pike', text: "Kestrel, do you have bread? I'll give iron.", age_seconds: 4 }],
  events_since_last_thought: [
    { type: 'action_complete', action: 'mine', result: 'collected 7 oak_log' },
    { type: 'agent_approached', name: 'Pike' },
  ],
  current_plan: { goal: 'stock food for winter', action: 'mine oak_log', status: 'complete' },
  stuck: null,
  revision: 0,
};

/** A deep copy of the example that a test can break in one place. */
function mutable(): Record<string, unknown> {
  return structuredClone(example) as unknown as Record<string, unknown>;
}

describe('validateSnapshot', () => {
  it('accepts the Appendix A example', () => {
    const result = validateSnapshot(example);
    expect(result.ok).toBe(true);
  });

  it('accepts standing_on and block_above_feet, air included, and leaves them optional', () => {
    const value = mutable();
    const surroundings = value.surroundings as Record<string, unknown>;
    surroundings.standing_on = 'oak_leaves';
    surroundings.block_above_feet = 'air';
    expect(validateSnapshot(value).ok).toBe(true);
    delete surroundings.standing_on;
    delete surroundings.block_above_feet;
    expect(validateSnapshot(value).ok).toBe(true);
  });

  it('rejects a footing name that is not a block name', () => {
    const value = mutable();
    (value.surroundings as Record<string, unknown>).standing_on = 'Oak Leaves';
    const result = validateSnapshot(value);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((error) => error.includes('/surroundings/standing_on'))).toBe(true);
  });

  it('rejects health above 20 and names the path', () => {
    const value = mutable();
    (value.self as Record<string, unknown>).health = 21;
    const result = validateSnapshot(value);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((error) => error.includes('/self/health'))).toBe(true);
  });

  it('rejects a non-LifeId agent_id and names the path', () => {
    const value = mutable();
    value.agent_id = 'kestrel';
    const result = validateSnapshot(value);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((error) => error.includes('/agent_id'))).toBe(true);
  });

  it('rejects a missing agent_id and names the property', () => {
    const value = mutable();
    delete value.agent_id;
    const result = validateSnapshot(value);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((error) => error.includes('agent_id'))).toBe(true);
  });

  it('rejects a missing revision and names it', () => {
    const value = mutable();
    delete value.revision;
    const result = validateSnapshot(value);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((error) => error.includes("'revision'"))).toBe(true);
  });

  it('rejects an unknown top-level property and names it', () => {
    const value = mutable();
    value.foo = 'bar';
    const result = validateSnapshot(value);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((error) => error.includes('foo'))).toBe(true);
  });

  it('names a short unknown property even though the Ajv message omits it', () => {
    const value = mutable();
    value.a = 1;
    const result = validateSnapshot(value);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((error) => error.includes("'a'"))).toBe(true);
  });
});

describe('generated contract', () => {
  it('matches the schemas (run `./geldar.ps1 pnpm --filter @geldar/contract generate`)', async () => {
    expect(await findStale()).toEqual([]);
  });
});
