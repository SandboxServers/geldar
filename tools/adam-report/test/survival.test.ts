import { describe, expect, it } from 'vitest';
import { toLiteSnapshot } from '../src/snapshot.ts';
import { hasStonePickaxe, survivalMeasure } from '../src/survival.ts';
import type { ActionRow, EventRow, LiteSnapshot, ReceiptRow, ThoughtRow } from '../src/types.ts';
import { DAY_MS, action, event, receipt, snap, thought } from './fixture.ts';

/** A contract snapshot as the loader reads it: the snapshot's `self` mapped to a LiteSnapshot. */
const lite = (o: Parameters<typeof snap>[0]): LiteSnapshot => {
  const mapped = toLiteSnapshot(snap(o));
  if (mapped === null) throw new Error('fixture snapshot did not map');
  return mapped;
};

interface DayOpts {
  slept?: boolean;
  food?: boolean;
  pickaxe?: boolean;
  snaps?: boolean;
}

interface Life {
  thoughts: ThoughtRow[];
  events: EventRow[];
  actions: ActionRow[];
  receipts: ReceiptRow[];
}

/**
 * `days` in-game days. Each day has two snapshots (hunger rises in the second when food is
 * eaten), a stone pickaxe in the inventory and a sleep event. A red bed is placed on `bedDay`
 * (null: never placed) with a committed receipt. `byDay` turns one item off for one day.
 */
function life(days: number, byDay: Record<number, DayOpts> = {}, bedDay: number | null = 0): Life {
  const thoughts: ThoughtRow[] = [];
  const events: EventRow[] = [];
  const actions: ActionRow[] = [];
  const receipts: ReceiptRow[] = [];
  if (bedDay !== null) {
    actions.push(action('bed-1', { kind: 'place', placeBlock: 'red_bed' }));
    receipts.push(receipt('bed-1', 'committed', bedDay * DAY_MS + 500));
  }
  for (let d = 0; d < days; d++) {
    const o = { slept: true, food: true, pickaxe: true, snaps: true, ...byDay[d] };
    const base = d * DAY_MS;
    if (o.slept) events.push(event('sleep', d, base + 1000));
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
  return { thoughts, events, actions, receipts };
}

const measure = (data: Life, days = 5) => survivalMeasure({ ...data, days, deathFailsRun: true });

describe('survival measure (decision 0061 item 1)', () => {
  it('PASS: no death in 5 days and every day boundary has a bed, a sleep, food and a pickaxe', () => {
    const m = measure(life(5));
    expect(m.verdict).toBe('PASS');
    expect(m.values).toMatchObject({
      days_covered: 5,
      deaths: 0,
      beds_present: 5,
      slept_days: 5,
      food_eaten_days: 5,
      stone_pickaxe_days: 5,
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
    const m = measure({ thoughts: [], events: [], actions: [], receipts: [] });
    expect(m.verdict).toBe('UNKNOWN');
    expect(m.note).toBe('no thoughts recorded');
  });

  it.each([
    ['bed placed', life(5, {}, null), 'day 3 (bed placed)'],
    ['slept in bed', life(5, { 3: { slept: false } }), 'day 3 (slept in bed)'],
    ['food', life(5, { 3: { food: false } }), 'day 3 (food)'],
    ['stone pickaxe', life(5, { 3: { pickaxe: false } }), 'day 3 (stone pickaxe)'],
  ])('FAIL naming the missing %s with its day number', (_item, data, expected) => {
    const m = measure(data);
    expect(m.verdict).toBe('FAIL');
    expect(m.note).toContain(expected);
  });

  it('a bed placed on an earlier day still counts on the later days', () => {
    const m = measure(life(5, {}, 0));
    expect(m.verdict).toBe('PASS');
  });

  it('a bed placed on day 2 fails days 0 and 1 and passes day 2', () => {
    const m = measure(life(5, {}, 2));
    expect(m.verdict).toBe('FAIL');
    expect(m.note).toContain('day 0 (bed placed)');
    expect(m.note).toContain('day 1 (bed placed)');
    expect(m.note).not.toContain('day 2 (bed placed)');
  });

  it.each(['white_bed', 'red_bed', 'cyan_bed'])('a placed %s counts as a bed', (block) => {
    const data = life(5);
    data.actions = data.actions.map((a) => ({ ...a, placeBlock: block }));
    expect(measure(data).verdict).toBe('PASS');
  });

  it('a place of a block that is not a bed does not count', () => {
    const data = life(5);
    data.actions = data.actions.map((a) => ({ ...a, placeBlock: 'crafting_table' }));
    const m = measure(data);
    expect(m.verdict).toBe('FAIL');
    expect(m.note).toContain('day 0 (bed placed)');
  });

  it('a bed placement whose receipt is not committed does not count', () => {
    const data = life(5);
    data.receipts = data.receipts.map((r) => ({ ...r, phase: 'aborted' }));
    const m = measure(data);
    expect(m.verdict).toBe('FAIL');
    expect(m.note).toContain('day 0 (bed placed)');
  });

  it('a bed placement with no receipt row does not count', () => {
    const data = life(5);
    data.receipts = [];
    expect(measure(data).note).toContain('day 0 (bed placed)');
  });

  it('FAIL lists every failing day, not only the first', () => {
    const m = measure(life(5, { 1: { slept: false }, 4: { pickaxe: false } }));
    expect(m.verdict).toBe('FAIL');
    expect(m.note).toContain('day 1 (slept in bed)');
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
