import { type Measure, PENDING, type Restart, type ThoughtRow, type Value } from './types.ts';

export interface ContinuityInput {
  thoughts: ThoughtRow[];
  restarts: Restart[];
  continuousHours: number | null;
  continuousWorldDays: number | null;
  maxGapSeconds: number | null;
}

const HOUR_MS = 3_600_000;

/** The longest real gap between consecutive thoughts, in seconds; null with fewer than two. */
export function longestGapSeconds(thoughts: ThoughtRow[]): number | null {
  const times = thoughts.map((t) => t.atMs).sort((a, b) => a - b);
  if (times.length < 2) return null;
  let longest = 0;
  for (let i = 1; i < times.length; i++)
    longest = Math.max(longest, (times[i] ?? 0) - (times[i - 1] ?? 0));
  return longest / 1000;
}

/** The 24-hour continuity measure: duration, world days, gaps and restarts. Pure. */
export function continuityMeasure(input: ContinuityInput, windowText: string): Measure {
  const { thoughts, restarts } = input;
  const planned = restarts.filter((r) => r.kind === 'planned').length;
  const body = restarts.filter((r) => r.kind === 'body').length;
  const title = 'Continuous operation across restarts';
  if (thoughts.length < 2) {
    return {
      id: 'continuity',
      title,
      verdict: 'UNKNOWN',
      window: windowText,
      values: { thoughts: thoughts.length },
      note: 'fewer than two thoughts',
    };
  }
  const times = thoughts.map((t) => t.atMs);
  const hours = (Math.max(...times) - Math.min(...times)) / HOUR_MS;
  const days =
    Math.max(...thoughts.map((t) => t.day)) - Math.min(...thoughts.map((t) => t.day)) + 1;
  const gap = longestGapSeconds(thoughts);
  const values: Record<string, Value> = {
    run_hours: Math.round(hours * 100) / 100,
    world_days: days,
    longest_gap_seconds: gap,
    planned_restarts: planned,
    body_restarts: body,
  };
  if (input.continuousHours === null || input.continuousWorldDays === null) {
    return {
      id: 'continuity',
      title,
      verdict: 'UNKNOWN',
      window: windowText,
      values,
      note: PENDING,
    };
  }
  if (input.maxGapSeconds === null) {
    return {
      id: 'continuity',
      title,
      verdict: 'UNKNOWN',
      window: windowText,
      values,
      note: 'gap threshold pending: not computed',
    };
  }
  const shortRun = hours < input.continuousHours || days < input.continuousWorldDays;
  const longGap = (gap ?? 0) > input.maxGapSeconds;
  if (shortRun || longGap || planned < 1 || body < 1) {
    return {
      id: 'continuity',
      title,
      verdict: 'FAIL',
      window: windowText,
      values,
      note: 'run too short, a gap over the threshold, or a required restart missing',
    };
  }
  return {
    id: 'continuity',
    title,
    verdict: 'PASS',
    window: windowText,
    values,
    note: 'duration, world days, gaps and both restarts met',
  };
}
