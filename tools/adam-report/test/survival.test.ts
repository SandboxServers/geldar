import { describe, expect, it } from 'vitest';
import { hasStonePickaxe, survivalMeasure } from '../src/survival.ts';
import { toLiteSnapshot } from '../src/snapshot.ts';
import type { EventRow, LiteSnapshot, ThoughtRow } from '../src/types.ts';
import { DAY_MS, event, snap, thought } from './fixture.ts';

/** A contract snapshot as the loader reads it: the snapshot's `self` mapped to a LiteSnapshot. */
const lite = (o: Parameters<typeof snap>[0]): LiteSnapshot => {
  const mapped = toLiteSnapshot(snap(o));
  if (mapped === null) throw new Error('fixture snapshot did not map');
  return mapped;
};

interface DayOpts {
  bed?: boolean;
  food?: boolean;
  pickaxe?: boolean;
  snaps?: boolean;
}

/**
 * `days` in-game days. Each day has two snapshots (hunger rises in the second when food is
 * eaten), a stone pickaxe in the inventory, and a sleep event. `byDay` turns one item off.
 */
function life(
  days: number,
  byDay: Record<number, DayOpts> = {},
): { thoughts: ThoughtRow[]; events: EventRow[] } {
  const thoughts: ThoughtRow[] = [];
  const events: EventRow[] = [];
  for (let d = 0; d < days; d++) {
    const o = { bed: true, food: true, pickaxe: true, snaps: true, ...byDay[d] };
    const base = d * DAY_MS;
    if (o.bed) events.push(event('sleep', d, base + 1000));
    if (!o.snaps) {
      thoughts.push(thought(`d${d}-a`, { day: d, atMs: base }));
      continue;
    }
    const inv: [string, number][] = o.pickaxe ? [['stone_pickaxe', 1]] : [];
    thoughts.push(
      thought(`d${d}-a`, { day: d, atMs: base, snapshot: lite({ hunger: 10, inventory: inv }) }),
      thought(`d${d}-b`, {
        day: d,
        atMs: base + 60_000,
        snapshot: lite({ hunger: o.food ? 14 : 10, inventory: inv }),
      }),
    );
  }
  return { thoughts, events };
}

const measure = (data: { thoughts: ThoughtRow[]; events: EventRow[] }, days = 5) =>
  survivalMeasure({ ...data, days, deathFailsRun: true });

describe('survival measure (decision 0061 item 1)', () => {
  it('PASS: no death in 5 days and every day boundary has a bed, food and a stone pickaxe', () => {
    const m = measure(life(5));
    expect(m.verdict).toBe('PASS');
    expect(m.values).toMatchObject({
      days_covered: 5,
      deaths: 0,
      beds_present: 5,
      food_eaten_days: 5,
    });
  });

  it('FAIL on a death inside the window', () => {
    const data = life(5);
    data.events.push(event('death', 2, 2 * DAY_MS));
    const m = measure(data);
    expect(m.verdict).toBe('FAIL');
    expect(m.values.deaths).toBe(1);
    expect(m.note).toContain('death');
  });

  it('UNKNOWN when the thoughts cover fewer days than the window', () => {
    const m = measure(life(4));
    expect(m.verdict).toBe('UNKNOWN');
    expect(m.note).toBe('thoughts cover 4 of 5 days');
  });

  it('UNKNOWN with no thoughts at all', () => {
    const m = measure({ thoughts: [], events: [] });
    expect(m.verdict).toBe('UNKNOWN');
    expect(m.note).toBe('no thoughts recorded');
  });

  it.each([
    ['bed', { bed: false }, 'day 3 (bed)'],
    ['food', { food: false }, 'day 3 (food)'],
    ['stone pickaxe', { pickaxe: false }, 'day 3 (stone pickaxe)'],
  ] as const)('FAIL naming the missing %s with its day number', (_item, opts, expected) => {
    const m = measure(life(5, { 3: opts }));
    expect(m.verdict).toBe('FAIL');
    expect(m.note).toContain(expected);
  });

  it('FAIL lists every failing day, not only the first', () => {
    const m = measure(life(5, { 1: { bed: false }, 4: { pickaxe: false } }));
    expect(m.verdict).toBe('FAIL');
    expect(m.note).toContain('day 1 (bed)');
    expect(m.note).toContain('day 4 (stone pickaxe)');
  });

  it('UNKNOWN, not PASS, when a day has no snapshot', () => {
    const m = measure(life(5, { 3: { snaps: false } }));
    expect(m.verdict).toBe('UNKNOWN');
    expect(m.note).toBe('no snapshot for day 3');
  });

  it('a wielded stone pickaxe counts as held', () => {
    expect(hasStonePickaxe({ hunger: 5, heldItem: 'stone_pickaxe', inventory: [] })).toBe(true);
    expect(hasStonePickaxe({ hunger: 5, heldItem: 'wooden_pickaxe', inventory: [] })).toBe(false);
  });
});
