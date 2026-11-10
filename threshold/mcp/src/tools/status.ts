import type { StatusResult, UntrustedWorldText } from '@geldar/contract';
import type { BodyGateway, BudgetLedger } from '../ports.ts';
import type { AgentProfiles } from '../resources.ts';
import { type ToolCall, WORLD_TEXT_NOTE } from './look.ts';
import type { SleepMarks } from './sleep.ts';

/** The most law lines `status` shows (the `signs` maxItems of the contract). */
export const STATUS_LAW_LIMIT = 20;

export interface StatusDeps {
  body: BodyGateway;
  budget: BudgetLedger;
  sleeps: SleepMarks;
  profiles: AgentProfiles;
  /** The laws in force, as sign lines; the shard publishes them on the board, not here. */
  laws: readonly string[];
  now: () => number;
}

/** `status`: budget, days alive and days since sleep, and the laws as sign lines. Free. */
export async function statusTool(deps: StatusDeps, call: ToolCall): Promise<StatusResult> {
  const snapshot = await deps.body.snapshot(call.lifeId);
  const budget = await deps.budget.balance(call.lifeId, deps.now());
  const profile = await deps.profiles.profile(call.lifeId);
  const mark = await deps.sleeps.read(call.lifeId);
  const day = snapshot.world_time.day;
  const laws = deps.laws.slice(0, STATUS_LAW_LIMIT) as NonNullable<UntrustedWorldText['signs']>;
  return {
    budget_remaining_thoughts: Math.floor(budget),
    days_alive: day - profile.born_day,
    days_since_sleep: day - mark.lastSleepDay,
    untrusted_world_text: laws.length > 0 ? { signs: laws } : {},
    note: WORLD_TEXT_NOTE,
  };
}
