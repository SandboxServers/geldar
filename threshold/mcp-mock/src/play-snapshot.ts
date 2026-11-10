import type { LookResult, Snapshot } from '@geldar/contract';

type PlaySnapshot = LookResult['snapshot'];

/**
 * The play view of a built snapshot, as `look` and `wait` return it (contract PlaySnapshot): no
 * snapshot_id, shard or body_generation, and the day and time of day in place of the raw ticks.
 */
export function toPlaySnapshot(built: Snapshot): PlaySnapshot {
  const {
    snapshot_id: _id,
    shard: _shard,
    body_generation: _generation,
    world_time: clock,
    ...playable
  } = built;
  return {
    ...playable,
    world_time: { day: clock.day, time_of_day: clock.time_of_day, weather: clock.weather },
    heard: [],
    events_since_last_thought: [],
  };
}
