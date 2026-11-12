import type { StatusResult, UntrustedWorldText } from '@geldar/contract';
import { type ActMeter, processMeter } from '../budget/meter.ts';
import type { AgentProfiles, BodyGateway, BudgetLedger, DeathMarks, SleepMarks } from '../ports.ts';
import { type ToolCall, WORLD_TEXT_NOTE } from './look.ts';

/** The most law lines `status` shows (the `signs` maxItems of the contract). */
export const STATUS_LAW_LIMIT = 20;

export interface StatusDeps {
  body: BodyGateway;
  budget: BudgetLedger;
  sleeps: SleepMarks;
  deaths: DeathMarks;
  profiles: AgentProfiles;
  /** The laws in force, as sign lines; the shard publishes them on the board, not here. */
  laws: readonly string[];
  now: () => number;
  /** The act meter (decision 0149). Defaults to the process meter that `act` records into. */
  meter?: ActMeter;
}

/**
 * `status`: budget, days alive and days since sleep, the laws as sign lines, and the act meter of
 * the life: what its acts would have cost (decision 0149). Free.
 */
export async function statusTool(deps: StatusDeps, call: ToolCall): Promise<StatusResult> {
  const snapshot = await deps.body.snapshot(call.lifeId);
  const budget = await deps.budget.balance(call.lifeId, deps.now());
  const profile = await deps.profiles.profile(call.lifeId);
  const mark = await deps.sleeps.read(call.lifeId);
  const deaths = await deps.deaths.read(call.lifeId);
  const totals = (deps.meter ?? processMeter).totalsOf(call.lifeId);
  const day = snapshot.world_time.day;
  const laws = deps.laws.slice(0, STATUS_LAW_LIMIT) as NonNullable<UntrustedWorldText['signs']>;
  return {
    budget_remaining_thoughts: Math.floor(budget),
    spent_this_life: totals.spent,
    would_have_been_balance: Math.floor(budget) - totals.spent,
    metered_acts: {
      calls: totals.calls,
      good: totals.good,
      bad: totals.bad,
      impossible: totals.impossible,
    },
    days_alive: day - profile.born_day,
    // The life is the deaths so far plus one (permadeath is off, decision 0147). Its days alive are
    // counted from its last death, or from birth before the first.
    life: deaths.deaths + 1,
    days_alive_this_life: Math.max(0, day - (deaths.lastDeathDay ?? profile.born_day)),
    days_since_sleep: day - mark.lastSleepDay,
    untrusted_world_text: laws.length > 0 ? { signs: laws } : {},
    note: WORLD_TEXT_NOTE,
  };
}
