import { describe, expect, it } from 'vitest';
import { validateSnapshot } from '../src/index.ts';

/** A minimal valid snapshot; the agents list is the part each test changes. */
const base = {
  snapshot_id: 'sn_01HZX3V9Q4M2K8R7T6Y5W4E3D2',
  agent_id: 'ag_kestrel_01',
  shard: 'baseline',
  world_time: { day: 14, time_of_day: 'dusk', ticks: 12400, weather: 'clear' },
  self: {
    position: { x: 120, y: 64, z: -45, biome: 'plains' },
    health: 14,
    hunger: 9,
    armor: 2,
    held_item: null,
    inventory: [],
    effects: [],
    budget_remaining_thoughts: 61,
    days_since_sleep: 1,
  },
  surroundings: { blocks_summary: '', notable_blocks: [], entities: [], agents: [] },
  heard: [],
  events_since_last_thought: [],
  revision: 0,
};

const PIKE = { name: 'Pike', distance: 6, held_item: 'iron_sword', health_estimate: 'unknown' };

/** A snapshot whose one agent is `agent`. */
function withAgent(agent: Record<string, unknown>): Record<string, unknown> {
  return {
    ...structuredClone(base),
    surroundings: { blocks_summary: '', notable_blocks: [], entities: [], agents: [agent] },
  };
}

describe('snapshot surroundings.agents[].pos', () => {
  it('accepts an agent with pos, and an agent without it', () => {
    expect(validateSnapshot(withAgent({ ...PIKE, pos: { x: 120, y: 64, z: -39 } })).ok).toBe(true);
    expect(validateSnapshot(withAgent(PIKE)).ok).toBe(true);
  });

  it('accepts negative x, y and z', () => {
    expect(validateSnapshot(withAgent({ ...PIKE, pos: { x: -4, y: -60, z: -5 } })).ok).toBe(true);
  });

  it('rejects a pos with a non-integer axis', () => {
    expect(validateSnapshot(withAgent({ ...PIKE, pos: { x: 1.5, y: 64, z: 0 } })).ok).toBe(false);
    expect(validateSnapshot(withAgent({ ...PIKE, pos: { x: 1, y: 64.25, z: 0 } })).ok).toBe(false);
  });

  it('rejects a pos with a missing axis', () => {
    expect(validateSnapshot(withAgent({ ...PIKE, pos: { x: 1, y: 64 } })).ok).toBe(false);
    expect(validateSnapshot(withAgent({ ...PIKE, pos: { x: 1, z: 0 } })).ok).toBe(false);
  });

  it('rejects a pos with an extra key, so no id can ride along in it', () => {
    const pos = { x: 1, y: 64, z: 0, life: 'ag_pike_01' };
    expect(validateSnapshot(withAgent({ ...PIKE, pos })).ok).toBe(false);
  });

  it('rejects a life key on the agent entry', () => {
    expect(validateSnapshot(withAgent({ ...PIKE, life: 'ag_pike_01' })).ok).toBe(false);
  });
});
