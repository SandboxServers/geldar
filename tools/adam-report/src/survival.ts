import type {
  ActionRow,
  EventRow,
  LiteSnapshot,
  Measure,
  ReceiptRow,
  ThoughtRow,
  Verdict,
} from './types.ts';

export interface SurvivalInput {
  thoughts: ThoughtRow[];
  events: EventRow[];
  actions: ActionRow[];
  receipts: ReceiptRow[];
  /** The window length in consecutive world days (criteria: survival_days). */
  days: number;
  deathFailsRun: boolean;
}

export interface DayCheck {
  day: number;
  /** A bed was placed on this day or an earlier one of the window. */
  bedPlaced: boolean;
  /** A sleep event fell on this day. */
  slept: boolean;
  /** True, false, or null when fewer than two snapshots of the day exist. */
  food: boolean | null;
  /** True, false, or null when the day has no snapshot. */
  stonePickaxe: boolean | null;
}

const STONE_PICKAXE = 'stone_pickaxe';
const BED_SUFFIX = '_bed';

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

/**
 * The world day of each bed placement: a place action of a bed of any colour whose receipt is
 * committed. The day is the day of the last thought at or before the receipt (the first thought's
 * day when none is earlier). `sorted` is the thoughts in time order.
 */
export function bedPlacementDays(
  sorted: ThoughtRow[],
  actions: ActionRow[],
  receipts: ReceiptRow[],
): number[] {
  const beds = new Set(
    actions.filter((a) => a.placeBlock?.endsWith(BED_SUFFIX) === true).map((a) => a.actionId),
  );
  const days: number[] = [];
  for (const r of receipts) {
    if (r.phase !== 'committed' || !beds.has(r.actionId) || sorted.length === 0) continue;
    let day = sorted[0]?.day ?? 0;
    for (const t of sorted) {
      if (t.atMs > r.atMs) break;
      day = t.day;
    }
    days.push(day);
  }
  return days;
}

/** The day-boundary checks for each day in [first, last], from snapshots, sleep and bed placements. */
export function dayChecks(
  thoughts: ThoughtRow[],
  events: EventRow[],
  bedDays: number[],
  first: number,
  last: number,
): DayCheck[] {
  const checks: DayCheck[] = [];
  const firstBed = bedDays.length > 0 ? Math.min(...bedDays) : null;
  for (let day = first; day <= last; day++) {
    const snaps = thoughts
      .filter((t) => t.day === day && t.snapshot !== null)
      .sort((a, b) => a.atMs - b.atMs || a.tick - b.tick)
      .map((t) => t.snapshot as LiteSnapshot);
    const lastSnap = snaps.at(-1);
    checks.push({
      day,
      bedPlaced: firstBed !== null && firstBed <= day,
      slept: events.some((e) => e.type === 'sleep' && e.day === day),
      food: ateOnDay(snaps),
      stonePickaxe: lastSnap === undefined ? null : hasStonePickaxe(lastSnap),
    });
  }
  return checks;
}

/** The items a day boundary is missing: no bed placed, no sleep, no food eaten, or no stone pickaxe. */
function missingItems(c: DayCheck): string[] {
  const out: string[] = [];
  if (!c.bedPlaced) out.push('bed placed');
  if (!c.slept) out.push('slept in bed');
  if (c.food === false) out.push('food');
  if (c.stonePickaxe === false) out.push('stone pickaxe');
  return out;
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
  const failed = checks.filter((c) => missingItems(c).length > 0);
  if (failed.length > 0) {
    const list = failed.map((c) => `day ${c.day} (${missingItems(c).join(', ')})`).join('; ');
    return { verdict: 'FAIL', note: `missing at a day boundary: ${list}` };
  }
  const unknown = checks.filter((c) => c.food === null || c.stonePickaxe === null);
  if (unknown.length > 0)
    return { verdict: 'UNKNOWN', note: `no snapshot for day ${unknown[0]?.day}` };
  return {
    verdict: 'PASS',
    note: 'no death; every day boundary had a bed placed, a sleep, food and a stone pickaxe',
  };
}

/** The survival measure (decision 0061 item 1). Pure. */
export function survivalMeasure(input: SurvivalInput): Measure {
  const { thoughts, events, actions, receipts, days, deathFailsRun } = input;
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
  const sorted = [...thoughts].sort((a, b) => a.atMs - b.atMs || a.tick - b.tick);
  const allDays = thoughts.map((t) => t.day);
  const first = Math.min(...allDays);
  const last = first + days - 1;
  const covered = new Set(allDays.filter((d) => d >= first && d <= last)).size;
  const deaths = events.filter((e) => e.type === 'death' && e.day >= first && e.day <= last).length;
  const bedDays = bedPlacementDays(sorted, actions, receipts);
  const checks = dayChecks(thoughts, events, bedDays, first, last);
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
      beds_present: count((c) => c.bedPlaced),
      slept_days: count((c) => c.slept),
      food_eaten_days: count((c) => c.food === true),
      stone_pickaxe_days: count((c) => c.stonePickaxe === true),
    },
    note,
  };
}
