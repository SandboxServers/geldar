import type { Snapshot } from '@geldar/contract';
import { makeId } from './ids.ts';

/** What the mock world knows when it builds a snapshot; the rest is fixed. */
export interface SnapshotParams {
  agentId: string;
  shard: string;
  revision: number;
  snapshotN: number;
  day: number;
  ticks: number;
  timeOfDay: 'dawn' | 'day' | 'dusk' | 'night';
  position: { x: number; y: number; z: number };
  health: number;
  food: number;
  inventory: { item: string; count: number }[];
  neighbours: { name: string; distance: number }[];
  plan?: { goal: string; action: string; status: string };
  /** Thoughts left today; defaults to 99. */
  budget?: number;
  /** Days since the last sleep; defaults to 0. */
  daysSinceSleep?: number;
}

/**
 * Builds a valid Snapshot. `heard` and `events_since_last_thought` are always empty and notable
 * blocks never carry text: what was heard or written goes in `untrusted_world_text`.
 */
export function buildSnapshot(p: SnapshotParams): Snapshot {
  const snapshot: Snapshot = {
    snapshot_id: makeId('sn', p.snapshotN),
    agent_id: p.agentId,
    shard: p.shard,
    revision: p.revision,
    world_time: { day: p.day, time_of_day: p.timeOfDay, ticks: p.ticks, weather: 'clear' },
    self: {
      position: { ...p.position, biome: 'plains' },
      health: p.health,
      hunger: p.food,
      armor: 0,
      held_item: null,
      inventory: p.inventory.map((s) => ({ item: s.item, count: s.count })),
      effects: [],
      budget_remaining_thoughts: p.budget ?? 99,
      days_since_sleep: p.daysSinceSleep ?? 0,
    },
    surroundings: {
      blocks_summary: 'Grass and a few oak trees.',
      notable_blocks: [{ type: 'oak_log', x: p.position.x + 2, y: p.position.y, z: p.position.z }],
      entities: [],
      agents: p.neighbours.map((n) => ({
        name: n.name,
        distance: n.distance,
        held_item: null,
        health_estimate: 'healthy',
      })),
    },
    heard: [],
    events_since_last_thought: [],
  };
  if (p.plan !== undefined) snapshot.current_plan = { ...p.plan };
  return snapshot;
}
