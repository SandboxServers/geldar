import type { SnapshotProjector } from './types.ts';

/**
 * The fields the play view leaves empty (heard lines and the event log come from the player log) and the
 * plan and stuck flags, which pass through when the Body sent them.
 */
export const logAndPlanProjector: SnapshotProjector = (snapshot) => ({
  heard: [],
  events_since_last_thought: [],
  ...(snapshot.current_plan === undefined ? {} : { current_plan: snapshot.current_plan }),
  ...(snapshot.stuck === undefined ? {} : { stuck: snapshot.stuck }),
});
