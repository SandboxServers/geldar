import { describe, expect, it } from 'vitest';
import { ActMeter } from '../budget/meter.ts';
import { FakeBudgetLedger } from '../fakes/stores.fakes.ts';
import { FakeBody } from '../fakes/world.fakes.ts';
import type { AgentProfiles, SleepMarks } from '../ports.ts';
import { type StatusDeps, statusTool } from './status.ts';

const LIFE = 'ag_jason_01';
const NOW = 1_000_000;

/** A status call with a balance of `credits` and a meter holding the given acts. */
async function status(credits: number, meter: ActMeter) {
  const budget = new FakeBudgetLedger(0, 10);
  budget.seed(LIFE, credits, NOW);
  const profiles: AgentProfiles = { profile: async () => ({ born_day: 1 }) as never };
  const sleeps: SleepMarks = {
    read: async () => ({ lastSleepDay: 1, cursor: 0 }) as never,
    write: async () => {},
  };
  const deps: StatusDeps = {
    body: new FakeBody(),
    budget,
    profiles,
    sleeps,
    deaths: { read: async () => ({ deaths: 0, lastDeathDay: null }), recordDeath: async () => {} },
    laws: [],
    now: () => NOW,
    meter,
  };
  return statusTool(deps, { lifeId: LIFE } as never);
}

describe('status: the act meter of the life', () => {
  it('shows zero spend and no acts for a life that has not acted', async () => {
    const result = await status(10, new ActMeter());
    expect(result.spent_this_life).toBe(0);
    expect(result.would_have_been_balance).toBe(10);
    expect(result.metered_acts).toEqual({ calls: 0, good: 0, bad: 0, impossible: 0 });
  });

  it('shows the spend, the balance it would leave and the outcome counts of the life', async () => {
    const meter = new ActMeter();
    meter.record(LIFE, { wouldCost: 2, charged: 2, outcome: 'good', durationMs: 5 });
    meter.record(LIFE, { wouldCost: 3, charged: 0, outcome: 'bad', durationMs: 5 });
    meter.record(LIFE, { wouldCost: 1, charged: 0, outcome: 'impossible', durationMs: 5 });
    const result = await status(10, meter);
    expect(result.spent_this_life).toBe(2);
    expect(result.would_have_been_balance).toBe(8);
    expect(result.metered_acts).toEqual({ calls: 3, good: 1, bad: 1, impossible: 1 });
  });

  it('lets the would-have-been balance go negative for an unenforced life at 0 credits', async () => {
    const meter = new ActMeter();
    meter.record(LIFE, { wouldCost: 5, charged: 5, outcome: 'good', durationMs: 5 });
    const result = await status(0, meter);
    expect(result.budget_remaining_thoughts).toBe(0);
    expect(result.spent_this_life).toBe(5);
    expect(result.would_have_been_balance).toBe(-5);
  });
});
