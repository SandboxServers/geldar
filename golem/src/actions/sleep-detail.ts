import type { Bot } from 'mineflayer';
import type { ActionOutcome, JsonValue } from './outcome.ts';
import type { BedCensus } from './sleep-census.ts';
import type { Hostile } from './sleep-hostiles.ts';

/** One bed the bed loop tried: the bed block the attempt ended on, and the reason it gave. */
export interface BedTry {
  block: { x: number; y: number; z: number };
  reason: string;
}

/** Per bot, the world age at which each hostile id was first seen in a monsters refusal's bed box. */
const FIRST_SEEN = new WeakMap<Bot, Map<number, number>>();

/**
 * Records the hostiles in this monsters refusal's bed box: an id not yet seen takes the current world age, and
 * an id not in this box is dropped, so its dwell starts again when it comes back. Returns the dwell in ticks of
 * the nearest counted hostile, or undefined when that hostile has no id.
 */
export function observeMonsters(bot: Bot, hostiles: readonly Hostile[]): number | undefined {
  const age = bot.time.age;
  let firstSeen = FIRST_SEEN.get(bot);
  if (firstSeen === undefined) {
    firstSeen = new Map();
    FIRST_SEEN.set(bot, firstSeen);
  }
  const inBox = new Set(
    hostiles.flatMap((hostile) => (hostile.id === undefined ? [] : [hostile.id])),
  );
  for (const id of [...firstSeen.keys()]) {
    if (!inBox.has(id)) firstSeen.delete(id);
  }
  for (const id of inBox) {
    if (!firstSeen.has(id)) firstSeen.set(id, age);
  }
  const nearest = hostiles[0]?.id;
  if (nearest === undefined) return undefined;
  return age - (firstSeen.get(nearest) ?? age);
}

/** A number rounded to one decimal place. */
function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * The detail a failed sleep carries: the bot's final position (each axis to one decimal), the beds the loop
 * tried, in the order tried (absent when none was tried), and the bed census when the loop read one (decision 0226).
 */
export function sleepFailureDetail(
  bot: Bot,
  tries: readonly BedTry[],
  census?: BedCensus,
): Record<string, JsonValue> {
  const { x, y, z } = bot.entity.position;
  return {
    final_position: { x: roundToTenth(x), y: roundToTenth(y), z: roundToTenth(z) },
    beds_tried: tries.map(({ block, reason }) => ({ ...block, reason })),
    ...(census === undefined
      ? {}
      : {
          beds_in_range: census.in_range,
          beds_occupied: census.occupied,
          beds_unknown: census.unknown,
        }),
  };
}

/** Adds the detail to a failed outcome; a completed or cancelled outcome is returned as it is. */
export function withSleepDetail(
  outcome: ActionOutcome,
  detail: Record<string, JsonValue>,
): ActionOutcome {
  return outcome.status === 'failed'
    ? { ...outcome, detail: { ...outcome.detail, ...detail } }
    : outcome;
}
