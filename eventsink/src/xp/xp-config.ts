// XP settings read from the environment. Off by default: GELDAR_XP must be exactly '1' (card AN-10a).
import { DEFAULT_THRESHOLDS } from '@geldar/psyche';

export type XpThresholds = readonly [number, number, number];

/** True only for GELDAR_XP='1'. Unset, '0' and anything else leave XP counting off. */
export function xpEnabled(env: NodeJS.ProcessEnv): boolean {
  return env.GELDAR_XP === '1';
}

/**
 * GELDAR_PROFICIENCY_THRESHOLDS as three comma-separated integers ("10,30,70"); unset or blank gives
 * psyche's DEFAULT_THRESHOLDS. A value that is set but malformed or unordered throws, so a typo fails
 * at startup instead of silently counting with other thresholds.
 */
export function xpThresholds(env: NodeJS.ProcessEnv): XpThresholds {
  const raw = env.GELDAR_PROFICIENCY_THRESHOLDS;
  if (raw === undefined || raw.trim() === '') return DEFAULT_THRESHOLDS;
  const parts = raw.split(',').map((part) => part.trim());
  if (parts.length !== 3 || !parts.every((part) => /^\d+$/.test(part))) {
    throw new RangeError(`GELDAR_PROFICIENCY_THRESHOLDS must be three integers, got "${raw}"`);
  }
  const first = Number(parts[0]);
  const second = Number(parts[1]);
  const third = Number(parts[2]);
  if (!(first <= second && second <= third)) {
    throw new RangeError(`GELDAR_PROFICIENCY_THRESHOLDS must be non-decreasing, got "${raw}"`);
  }
  return [first, second, third];
}
