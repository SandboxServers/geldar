import { describe, expect, it } from 'vitest';
import {
  autoRetryDelay,
  FIRST_VISIT_MARGIN_MS,
  firstVisitPlan,
  MAX_AUTO_RETRIES,
  openingPlan,
  pickRandom,
} from '../../web/kino/panes/first-visit.ts';
import { GATE_REFILL_MS } from '../../web/kino/panes/subscribe-gate.ts';

const IDS = ['ag_a', 'ag_b', 'ag_c', 'ag_d', 'ag_e', 'ag_f'];

/** A scripted random source: each value in turn, then 0. */
const rngOf = (...values: number[]) => {
  let i = 0;
  return () => values[i++] ?? 0;
};

describe('random pick', () => {
  it('picks distinct ids, the count asked for, using the injected source', () => {
    // 0.0 picks index 0; after removal the pool shifts, so 0.99 picks the last remaining.
    expect(pickRandom(IDS, 3, rngOf(0, 0, 0.99))).toEqual(['ag_a', 'ag_b', 'ag_f']);
    const picked = pickRandom(IDS, 4, rngOf(0.5, 0.5, 0.5, 0.5));
    expect(new Set(picked).size).toBe(4);
    expect(picked.every((id) => IDS.includes(id))).toBe(true);
  });

  it('never repeats an id even when the source keeps returning the same value', () => {
    const picked = pickRandom(IDS, 6, () => 0);
    expect([...picked].sort()).toEqual([...IDS].sort());
  });

  it('does not change the input list', () => {
    const copy = [...IDS];
    pickRandom(IDS, 4, rngOf(0.9, 0.1, 0.4, 0.7));
    expect(IDS).toEqual(copy);
  });
});

describe('first visit plan', () => {
  it('opens four monitors: the first at once, then one per refill plus the margin', () => {
    const plan = firstVisitPlan(IDS, rngOf(0, 0, 0, 0), GATE_REFILL_MS);
    expect(plan).toHaveLength(4);
    const step = GATE_REFILL_MS + FIRST_VISIT_MARGIN_MS;
    expect(plan.map((m) => m.delayMs)).toEqual([0, step, 2 * step, 3 * step]);
    expect(plan.every((m) => m.mode === 'follow')).toBe(true);
    expect(new Set(plan.map((m) => m.target)).size).toBe(4);
  });

  it('opens that many when there are fewer than four public cameras', () => {
    const plan = firstVisitPlan(['ag_a', 'ag_b'], () => 0, GATE_REFILL_MS);
    expect(plan.map((m) => m.target)).toEqual(['ag_a', 'ag_b']);
    expect(firstVisitPlan([], () => 0, GATE_REFILL_MS)).toEqual([]);
  });

  it('a saved wall wins: no random pick, the saved monitors come back', () => {
    const saved = {
      layout: 'wall' as const,
      monitors: [{ target: 'ag_z', mode: 'follow' as const }],
    };
    const plan = openingPlan(saved, false, IDS, () => 0, GATE_REFILL_MS);
    expect(plan).toEqual([{ target: 'ag_z', mode: 'follow', delayMs: 0 }]);
  });

  it('a signed-in first visit keeps the existing CH 1 tune (no random four)', () => {
    const plan = openingPlan(null, true, IDS, () => 0.99, GATE_REFILL_MS);
    expect(plan).toEqual([{ target: 'ag_a', mode: 'follow', delayMs: 0 }]);
  });

  it('an anonymous first visit with no saved wall opens the random four', () => {
    const plan = openingPlan(null, false, IDS, rngOf(0.99, 0.99, 0.99, 0.99), GATE_REFILL_MS);
    expect(plan).toHaveLength(4);
    expect(plan[0]?.target).toBe('ag_f');
  });
});

describe('automatic retry', () => {
  it('backs off and gives up after the last allowed retry (the Try again button takes over)', () => {
    expect(MAX_AUTO_RETRIES).toBe(3);
    expect(autoRetryDelay(0)).toBe(4000);
    expect(autoRetryDelay(1)).toBe(8000);
    // The third (last allowed) retry still waits; the fourth refusal is null.
    expect(autoRetryDelay(2)).toBe(16000);
    expect(autoRetryDelay(3)).toBeNull();
  });
});
