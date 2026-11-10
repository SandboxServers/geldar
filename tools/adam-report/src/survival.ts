import type { EventRow, LiteSnapshot, Measure, ThoughtRow, Verdict } from './types.ts';

export interface SurvivalInput {
  thoughts: ThoughtRow[];
  events: EventRow[];
  /** The window length in consecutive world days (criteria: survival_days). */
  days: number;
  deathFailsRun: boolean;
}

export interface DayCheck {
  day: number;
  bed: boolean;
  /** True, false, or null when fewer than two snapshots of the day exist. */
  food: boolean | null;
  /** True, false, or null when the day has no snapshot. */
  stonePickaxe: boolean | null;
}

const STONE_PICKAXE = 'stone_pickaxe';

/** True when the snapshot's hunger rose between two consecutive snapshots of one day. */
export function ateOnDay(snaps: LiteSnapshot[]): boolean | null {
  if (snaps.length < 2) return null;
  for (let i = 1; i < snaps.length; i++) {
    const before = snaps[i - 1]?.hunger;
    const after = snaps[i]?.hunger;
    if (before != null && after != null && after > before) return true;
  }
  return false;
}

/** True when the last snapshot of the day holds or wields a stone pickaxe. */
export function hasStonePickaxe(last: LiteSnapshot): boolean {
  if (last.heldItem === STONE_PICKAXE) return true;
  return last.inventory.some((s) => s.item === STONE_PICKAXE && s.count >= 1);
}

/** The day-boundary checks for each day in [first, last], from snapshots and sleep events. */
export function dayChecks(
  thoughts: ThoughtRow[],
  events: EventRow[],
  first: number,
  last: number,
): DayCheck[] {
  const checks: DayCheck[] = [];
  for (let day = first; day <= last; day++) {
    const snaps = thoughts
      .filter((t) => t.day === day && t.snapshot !== null)
      .sort((a, b) => a.atMs - b.atMs || a.tick - b.tick)
      .map((t) => t.snapshot as LiteSnapshot);
    const lastSnap = snaps.at(-1);
    checks.push({
      day,
      bed: events.some((e) => e.type === 'sleep' && e.day === day),
      food: ateOnDay(snaps),
      stonePickaxe: lastSnap === undefined ? null : hasStonePickaxe(lastSnap),
    });
  }
  return checks;
}

function verdictOf(
  deaths: number,
  coveredDays: number,
  days: number,
  checks: DayCheck[],
  deathFailsRun: boolean,
): { verdict: Verdict; note: string } {
  if (deaths > 0 && deathFailsRun)
    return { verdict: 'FAIL', note: 'a death fell inside the window' };
  if (coveredDays < days)
    return { verdict: 'UNKNOWN', note: `thoughts cover ${coveredDays} of ${days} days` };
  const failed = checks.filter((c) => !c.bed || c.food === false || c.stonePickaxe === false);
  if (failed.length > 0)
    return { verdict: 'FAIL', note: `a day boundary failed: day ${failed[0]?.day}` };
  const unknown = checks.filter((c) => c.food === null || c.stonePickaxe === null);
  if (unknown.length > 0)
    return { verdict: 'UNKNOWN', note: `no snapshot for day ${unknown[0]?.day}` };
  return {
    verdict: 'PASS',
    note: 'no death; every day boundary had a bed, food and a stone pickaxe',
  };
}

/** The survival measure (decision 0061 item 1). Pure. */
export function survivalMeasure(input: SurvivalInput): Measure {
  const { thoughts, events, days, deathFailsRun } = input;
  const title = `Survival: ${days} consecutive in-game days`;
  if (thoughts.length === 0) {
    return {
      id: 'survival',
      title,
      verdict: 'UNKNOWN',
      window: 'no thoughts',
      values: {},
      note: 'no thoughts recorded',
    };
  }
  const allDays = thoughts.map((t) => t.day);
  const first = Math.min(...allDays);
  const last = first + days - 1;
  const covered = new Set(allDays.filter((d) => d >= first && d <= last)).size;
  const deaths = events.filter((e) => e.type === 'death' && e.day >= first && e.day <= last).length;
  const checks = dayChecks(thoughts, events, first, last);
  const { verdict, note } = verdictOf(deaths, covered, days, checks, deathFailsRun);
  const count = (f: (c: DayCheck) => boolean) => checks.filter(f).length;
  return {
    id: 'survival',
    title,
    verdict,
    window: `world days ${first} to ${last} (${days} days from the first thought)`,
    values: {
      days_covered: covered,
      deaths,
      beds_present: count((c) => c.bed),
      food_eaten_days: count((c) => c.food === true),
      stone_pickaxe_days: count((c) => c.stonePickaxe === true),
    },
    note,
  };
}
