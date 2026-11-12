import type { Snapshot } from '@geldar/contract';
import type { ThoughtPromptVars } from '../ports/index.ts';

/** A valid snapshot for tests; `over` replaces top-level fields. */
export function sampleSnapshot(over: Partial<Snapshot> = {}): Snapshot {
  return {
    snapshot_id: 'sn_01ARZ3NDEKTSV4RRFFQ69G5FAV',
    agent_id: 'ag_adam_03',
    shard: 'phase0',
    revision: 7,
    body_generation: 1,
    world_time: { day: 3, time_of_day: 'dusk', ticks: 75000, weather: 'clear' },
    self: {
      position: { x: 10, y: 64, z: -20, biome: 'plains' },
      health: 17.5,
      hunger: 15,
      armor: 0,
      held_item: 'oak_log',
      inventory: [
        { item: 'stick', count: 4 },
        { item: 'oak_log', count: 3 },
      ],
      effects: [],
      budget_remaining_thoughts: 90,
      days_since_sleep: 1,
      unlocked_recipes: ['oak_planks', 'stick', 'crafting_table'],
    },
    surroundings: {
      blocks_summary: 'grass and oak trees',
      notable_blocks: [{ type: 'oak_sign', x: 12, y: 64, z: -18, text: 'Welcome' }],
      entities: [{ type: 'cow', distance: 8.2, direction: 'north', x: 0, y: 64, z: -8 }],
      agents: [{ name: 'Eve', distance: 5, held_item: null, health_estimate: 'healthy' }],
    },
    heard: [{ from: 'Eve', text: 'Hello there', age_seconds: 4 }],
    events_since_last_thought: [{ type: 'wake' }, { type: 'speech' }, { type: 'speech' }],
    current_plan: null,
    stuck: null,
    ...over,
  };
}

/** Thought variables around `snapshot`, with empty memory. */
export function sampleThoughtVars(snapshot: Snapshot = sampleSnapshot()): ThoughtPromptVars {
  return {
    agent: {
      name: 'Adam',
      lifeId: 'ag_adam_03',
      personalitySeed: 'curious, careful, slow to trust',
    },
    snapshot,
    wake: { reason: 'idle', events: [], digest: [], priority: 0 },
    goals: [],
    relationships: [],
    beliefs: [],
    dueCommitments: [],
    episodic: [],
    recentThoughts: [],
  };
}
