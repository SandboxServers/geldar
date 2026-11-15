import { heardMuffledSentence, type LookResult, type Snapshot } from '@geldar/contract';

type PlaySnapshot = LookResult['snapshot'];

/** The most muffled sentences a play view carries (contract PlaySnapshot.muffled, maxItems 3). */
const MUFFLED_LIMIT = 3;

/**
 * The player's sentences for the Body's muffled notices, nearest first, as the play view words them: at
 * most MUFFLED_LIMIT, and a notice whose direction or band is unknown is skipped and takes no place.
 */
function muffledSentences(notices: Snapshot['heard_muffled']): string[] {
  const sentences: string[] = [];
  for (const notice of Array.isArray(notices) ? notices : []) {
    if (sentences.length === MUFFLED_LIMIT) break;
    try {
      sentences.push(heardMuffledSentence(notice.direction, notice.band));
    } catch {
      // An unknown code is skipped, as the play view skips it.
    }
  }
  return sentences;
}

/**
 * The play view of a built snapshot, as `look` and `wait` return it (contract PlaySnapshot): no
 * snapshot_id, shard, body_generation or heard_muffled, and the day and time of day in place of the raw
 * ticks. Muffled notices come out as their sentences under `muffled`, and the key is left out when none.
 */
export function toPlaySnapshot(built: Snapshot): PlaySnapshot {
  const muffled = muffledSentences(built.heard_muffled);
  const {
    snapshot_id: _id,
    shard: _shard,
    body_generation: _generation,
    world_time: clock,
    heard_muffled: _muffled,
    ...playable
  } = built;
  return {
    ...playable,
    world_time: { day: clock.day, time_of_day: clock.time_of_day, weather: clock.weather },
    heard: [],
    events_since_last_thought: [],
    ...(muffled.length === 0 ? {} : { muffled: muffled as NonNullable<PlaySnapshot['muffled']> }),
  };
}
