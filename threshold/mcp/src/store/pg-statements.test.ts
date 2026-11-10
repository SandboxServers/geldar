import { describe, expect, it } from 'vitest';
import { PgBudgetLedger } from './pg-budget.ts';
import { FakePool } from './pg-fakes.ts';
import { PgJournalStore } from './pg-journal.ts';
import { PgPlayerDirectory } from './pg-players.ts';
import { PgTokenStore } from './pg-tokens.ts';

/**
 * Every store sends its user values as bound parameters. Each call below carries a hostile value
 * that would break out of a quoted literal; the test fails if that text reaches any SQL statement
 * or if a statement is missing its placeholders.
 */
const HOSTILE = "x'); DROP TABLE mcp_tokens; --";
const NOW = Date.UTC(2026, 10, 9);
const RULES = { creditsPerRealHour: 30, capCredits: 240 };

function assertBound(pool: FakePool): void {
  expect(pool.sent.length).toBeGreaterThan(0);
  for (const sent of pool.sent) {
    expect(sent.text).not.toContain(HOSTILE);
    expect(sent.text).not.toContain('DROP TABLE');
    expect(sent.text).toMatch(/\$\d/);
  }
}

describe('every store statement is parameterised', () => {
  it('PgTokenStore.resolve and touch', async () => {
    const pool = new FakePool();
    const store = new PgTokenStore(pool.asPool(), {}, {});
    await store.resolve(Buffer.alloc(32, 1), NOW);
    await store.touch(HOSTILE, NOW);
    assertBound(pool);
    expect(pool.sent[1]?.values).toEqual([HOSTILE, new Date(NOW)]);
  });

  it('PgBudgetLedger.balance, reserve and refund', async () => {
    const pool = new FakePool(() => ({ rows: [{ credits: 1, remaining: 1, ok: true }] }));
    const ledger = new PgBudgetLedger(pool.asPool(), RULES);
    await ledger.balance(HOSTILE, NOW);
    await ledger.reserve(HOSTILE, 1, NOW);
    await ledger.refund(HOSTILE, 1);
    assertBound(pool);
    for (const sent of pool.sent) expect(sent.values).toContain(HOSTILE);
  });

  it('PgPlayerDirectory.find', async () => {
    const pool = new FakePool();
    await new PgPlayerDirectory(pool.asPool()).find(HOSTILE);
    assertBound(pool);
    expect(pool.sent[0]?.values).toEqual([HOSTILE]);
  });

  it('PgJournalStore.append and recent', async () => {
    const pool = new FakePool();
    const journal = new PgJournalStore(pool.asPool());
    await journal.append(HOSTILE, HOSTILE, NOW);
    await journal.recent(HOSTILE, 5);
    assertBound(pool);
    expect(pool.sent[0]?.values).toEqual([HOSTILE, new Date(NOW), HOSTILE]);
  });
});
