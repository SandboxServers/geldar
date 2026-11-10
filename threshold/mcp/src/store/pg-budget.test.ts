import { describe, expect, it } from 'vitest';
import { accrue, PgBudgetLedger, takeCredits } from './pg-budget.ts';
import { FakePool } from './pg-fakes.ts';

const HOUR = 3_600_000;
const RULES = { creditsPerRealHour: 30, capCredits: 240 };

describe('accrue', () => {
  it('mints whole credits: 30 an hour is one credit every two minutes', () => {
    const after = accrue({ credits: 0, accruedAtMs: 0 }, HOUR, RULES);
    expect(after).toEqual({ credits: 30, accruedAtMs: HOUR });
  });

  it('keeps a fraction: 90 s is no credit and the clock stays put', () => {
    expect(accrue({ credits: 0, accruedAtMs: 0 }, 90_000, RULES)).toEqual({
      credits: 0,
      accruedAtMs: 0,
    });
  });

  it('pays the kept fraction once it adds up: 90 s, then 120 s, is one credit', () => {
    const first = accrue({ credits: 0, accruedAtMs: 0 }, 90_000, RULES);
    const second = accrue(first, 120_000, RULES);
    expect(second).toEqual({ credits: 1, accruedAtMs: 120_000 });
  });

  it('moves the clock by exactly the time the minted credits took', () => {
    const after = accrue({ credits: 5, accruedAtMs: 1_000 }, 1_000 + 250_000, RULES);
    // 250 s at 30 an hour is 2 whole credits, which took 240 s.
    expect(after).toEqual({ credits: 7, accruedAtMs: 1_000 + 240_000 });
  });

  it('stops at the cap and does not bank the time spent full', () => {
    const after = accrue({ credits: 230, accruedAtMs: 0 }, 2 * HOUR, RULES);
    expect(after).toEqual({ credits: 240, accruedAtMs: 2 * HOUR });
  });

  it('is already at the cap when the balance is at the cap', () => {
    expect(accrue({ credits: 240, accruedAtMs: 0 }, HOUR, RULES)).toEqual({
      credits: 240,
      accruedAtMs: HOUR,
    });
  });

  it('treats a clock ahead of now as zero elapsed time', () => {
    expect(accrue({ credits: 3, accruedAtMs: HOUR }, 0, RULES)).toEqual({
      credits: 3,
      accruedAtMs: HOUR,
    });
  });
});

describe('takeCredits', () => {
  it('takes the cost when the balance covers it', () => {
    expect(takeCredits(10, 4)).toEqual({ ok: true, remaining: 6 });
    expect(takeCredits(4, 4)).toEqual({ ok: true, remaining: 0 });
  });

  it('takes nothing when the balance does not cover it', () => {
    expect(takeCredits(3, 4)).toEqual({ ok: false, remaining: 3 });
  });
});

describe('PgBudgetLedger', () => {
  it('refuses a rate of zero or less', () => {
    expect(
      () => new PgBudgetLedger(new FakePool().asPool(), { ...RULES, creditsPerRealHour: 0 }),
    ).toThrow();
  });

  it('refuses a rate that is not a whole number', () => {
    expect(
      () => new PgBudgetLedger(new FakePool().asPool(), { ...RULES, creditsPerRealHour: 1.5 }),
    ).toThrow();
  });

  it('refuses a cost that is zero, negative or fractional, so reserve cannot mint', async () => {
    const pool = new FakePool(() => ({ rows: [{ remaining: 9, ok: true }] }));
    const ledger = new PgBudgetLedger(pool.asPool(), RULES);
    await expect(ledger.reserve('ag_jason_01', -5, 0)).rejects.toThrow();
    await expect(ledger.reserve('ag_jason_01', 0, 0)).rejects.toThrow();
    await expect(ledger.reserve('ag_jason_01', 2.5, 0)).rejects.toThrow();
    expect(pool.sent).toHaveLength(0);
  });

  it('locks the budget row in the accrual CTE for reserve and balance, so a race re-reads it', async () => {
    // Without FOR UPDATE, two concurrent reserves both read 240 and both write 190 (see the IT).
    const pool = new FakePool(() => ({ rows: [{ credits: 1, remaining: 1, ok: true }] }));
    const ledger = new PgBudgetLedger(pool.asPool(), RULES);
    await ledger.reserve('ag_jason_01', 1, 0);
    await ledger.balance('ag_jason_01', 0);
    for (const sent of pool.sent) {
      expect(sent.text).toMatch(/FROM mcp_budget WHERE life_id = \$1 FOR UPDATE/);
    }
  });

  it('reserve sends the accrual inputs and the cost as bound values', async () => {
    const pool = new FakePool(() => ({ rows: [{ remaining: 5, ok: true }] }));
    const ledger = new PgBudgetLedger(pool.asPool(), RULES);
    const now = Date.UTC(2026, 10, 9);
    const result = await ledger.reserve('ag_jason_01', 3, now);
    expect(result).toEqual({ ok: true, remaining: 5 });
    expect(pool.sent[0]?.values).toEqual(['ag_jason_01', new Date(now), 30, 240, 3]);
  });

  it('reserve reports ok false when the row said so', async () => {
    const pool = new FakePool(() => ({ rows: [{ remaining: 2, ok: false }] }));
    const ledger = new PgBudgetLedger(pool.asPool(), RULES);
    expect(await ledger.reserve('ag_jason_01', 3, 0)).toEqual({ ok: false, remaining: 2 });
  });

  it('reserve reports ok false when no budget row exists', async () => {
    const ledger = new PgBudgetLedger(new FakePool().asPool(), RULES);
    expect(await ledger.reserve('ag_nobody_01', 1, 0)).toEqual({ ok: false, remaining: 0 });
  });

  it('balance and refund return the stored credits; refund caps at the cap', async () => {
    const pool = new FakePool(() => ({ rows: [{ credits: 17 }] }));
    const ledger = new PgBudgetLedger(pool.asPool(), RULES);
    expect(await ledger.balance('ag_jason_01', 0)).toBe(17);
    expect(await ledger.refund('ag_jason_01', 4)).toBe(17);
    expect(pool.sent[1]?.values).toEqual(['ag_jason_01', 4, 240]);
    expect(pool.sent[1]?.text).toContain('LEAST($3::int, credits + $2::int)');
  });

  it('keeps accrual, reserve and refund in a single statement each', async () => {
    const pool = new FakePool(() => ({ rows: [{ credits: 1, remaining: 1, ok: true }] }));
    const ledger = new PgBudgetLedger(pool.asPool(), RULES);
    await ledger.reserve('ag_jason_01', 1, 0);
    await ledger.balance('ag_jason_01', 0);
    expect(pool.sent).toHaveLength(2);
    expect(pool.sent[0]?.text).toContain('UPDATE mcp_budget');
    expect(pool.sent[0]?.text).toContain('acc.capped >= $5::int');
  });
});
