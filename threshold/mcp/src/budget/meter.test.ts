import { describe, expect, it } from 'vitest';
import { ActMeter, actBudgetEnforced, ENFORCE_ENV, outcomeClassOf, wouldCostOf } from './meter.ts';

describe('act budget switch (decision 0149)', () => {
  it('is off by default and on only for the value 1', () => {
    expect(ENFORCE_ENV).toBe('GELDAR_ACT_BUDGET_ENFORCE');
    expect(actBudgetEnforced({})).toBe(false);
    expect(actBudgetEnforced({ [ENFORCE_ENV]: '0' })).toBe(false);
    expect(actBudgetEnforced({ [ENFORCE_ENV]: '' })).toBe(false);
    expect(actBudgetEnforced({ [ENFORCE_ENV]: 'true' })).toBe(false);
    expect(actBudgetEnforced({ [ENFORCE_ENV]: '1' })).toBe(true);
  });
});

describe('outcome class', () => {
  it('is good when an item was accepted, bad when the plan was sent or failed, else impossible', () => {
    expect(outcomeClassOf(1, true, false)).toBe('good');
    expect(outcomeClassOf(2, false, true)).toBe('good');
    expect(outcomeClassOf(0, true, false)).toBe('bad');
    expect(outcomeClassOf(0, false, true)).toBe('bad');
    expect(outcomeClassOf(0, false, false)).toBe('impossible');
  });

  it('costs one credit per item of the whole thought, accepted or not', () => {
    expect(wouldCostOf(['say', 'action', 'action', 'intent'])).toBe(4);
    expect(wouldCostOf([])).toBe(0);
  });
});

describe('ActMeter', () => {
  it('keeps running totals per life, and spends only what was accepted', () => {
    const meter = new ActMeter();
    const first = meter.record('life-a', {
      wouldCost: 3,
      charged: 2,
      outcome: 'good',
      durationMs: 40,
    });
    expect(first).toMatchObject({
      spent: 2,
      wouldCost: 3,
      calls: 1,
      good: 1,
      bad: 0,
      durationMs: 40,
    });
    const second = meter.record('life-a', {
      wouldCost: 2,
      charged: 0,
      outcome: 'bad',
      durationMs: 10,
    });
    expect(second).toMatchObject({
      spent: 2,
      wouldCost: 5,
      calls: 2,
      good: 1,
      bad: 1,
      durationMs: 50,
    });
    const third = meter.record('life-a', {
      wouldCost: 1,
      charged: 0,
      outcome: 'impossible',
      durationMs: 5,
    });
    expect(third).toMatchObject({ impossible: 1, calls: 3, durationMs: 55 });
  });

  it('keeps each life apart and reports zero for a life with no act', () => {
    const meter = new ActMeter();
    meter.record('life-a', { wouldCost: 4, charged: 4, outcome: 'good', durationMs: 1 });
    expect(meter.totalsOf('life-b')).toMatchObject({ spent: 0, wouldCost: 0, calls: 0 });
    expect(meter.totalsOf('life-a').spent).toBe(4);
  });

  it('ignores a negative duration rather than subtracting time', () => {
    const meter = new ActMeter();
    const totals = meter.record('life-a', {
      wouldCost: 1,
      charged: 1,
      outcome: 'good',
      durationMs: -9,
    });
    expect(totals.durationMs).toBe(0);
  });
});
