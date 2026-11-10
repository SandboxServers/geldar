import { describe, expect, it } from 'vitest';
import { accrue, takeCredits } from './accrual.ts';
import { batchCost, itemCost, toolCharges } from './cost.ts';

describe('credit cost', () => {
  it('charges one credit for each say, action and intent', () => {
    expect(itemCost('say')).toBe(1);
    expect(itemCost('action')).toBe(1);
    expect(itemCost('intent')).toBe(1);
    expect(batchCost(['say', 'action', 'action', 'action', 'intent'])).toBe(5);
  });

  it('charges the state-changing tools and no others', () => {
    expect(toolCharges('act')).toBe(true);
    expect(toolCharges('say')).toBe(true);
    expect(toolCharges('wait')).toBe(false);
    expect(toolCharges('look')).toBe(false);
    expect(toolCharges('read_book')).toBe(false);
    expect(toolCharges('status')).toBe(false);
  });
});

describe('accrual', () => {
  const rules = { creditsPerRealHour: 3600, capCredits: 5 };

  it('mints whole credits at the rate and moves the clock by the time they took', () => {
    const next = accrue({ credits: 0, accruedAtMs: 0 }, 2500, rules);
    expect(next).toEqual({ credits: 2, accruedAtMs: 2000 });
  });

  it('caps the balance and does not bank the time spent full', () => {
    const next = accrue({ credits: 4, accruedAtMs: 0 }, 60_000, rules);
    expect(next).toEqual({ credits: 5, accruedAtMs: 60_000 });
  });

  it('takes credits only when the balance covers them', () => {
    expect(takeCredits(2, 1)).toEqual({ ok: true, remaining: 1 });
    expect(takeCredits(0, 1)).toEqual({ ok: false, remaining: 0 });
  });
});
