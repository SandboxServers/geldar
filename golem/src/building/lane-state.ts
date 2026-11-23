// Plan lane state (BLD-13): where the lane is in its one plan.

/**
 * The lane's states: `idle` (no plan), `running`, `paused` (a reflex holds it), `waiting_materials`,
 * `waiting_tps` (TPS below 12: no cell runs until it recovers).
 */
export const LANE_STATES = [
  'idle',
  'running',
  'paused',
  'waiting_materials',
  'waiting_tps',
] as const;
export type LaneStateName = (typeof LANE_STATES)[number];

/** Anything that reports its lane state (the plan lane). */
export interface HasLaneState {
  readonly state: LaneStateName;
}

/** The lane's state name. */
export function laneStateOf(lane: HasLaneState): LaneStateName {
  return lane.state;
}
