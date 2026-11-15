// Proficiency levels from XP. The thresholds are unmeasured and shard-configurable (0186 D-CS-04).
// levelForXp is the one function eventsink and the Body both use, so they cannot disagree.

export type Level = 0 | 1 | 2 | 3;

export const DEFAULT_THRESHOLDS: readonly [10, 30, 70] = [10, 30, 70];

/** xp at or above the first threshold is level 1, at or above the second level 2, at or above the third level 3. */
export function levelForXp(
  xp: number,
  thresholds: readonly [number, number, number] = DEFAULT_THRESHOLDS,
): Level {
  const [first, second, third] = thresholds;
  if (xp >= third) return 3;
  if (xp >= second) return 2;
  if (xp >= first) return 1;
  return 0;
}
