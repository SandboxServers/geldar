import type { SnapshotProjector } from './types.ts';

/** The identifiers the agent keeps (agent_id, revision) and the world's day and time of day. */
export const headerProjector: SnapshotProjector = (snapshot) => ({
  agent_id: snapshot.agent_id,
  revision: snapshot.revision,
  world_time: {
    day: snapshot.world_time.day,
    time_of_day: snapshot.world_time.time_of_day,
    weather: snapshot.world_time.weather,
  },
});
