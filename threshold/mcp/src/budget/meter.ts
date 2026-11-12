/**
 * The act meter (decision 0149). While the act budget is suspended, every `act` is still metered:
 * what its items would have cost, its outcome class, its duration, and running totals per life.
 * Enforcement is a config switch: `GELDAR_ACT_BUDGET_ENFORCE=1` turns the reserve and the rejections
 * back on; any other value (the default) leaves them off.
 */

import type { ChargedItem } from './cost.ts';

/** The environment variable that turns act budget enforcement on. Only the value `1` enables it. */
export const ENFORCE_ENV = 'GELDAR_ACT_BUDGET_ENFORCE';

/** True only when the switch is set to `1`. Every other value, or none, leaves enforcement off. */
export function actBudgetEnforced(env: Record<string, string | undefined>): boolean {
  return env[ENFORCE_ENV] === '1';
}

/**
 * How an act ended: `good` when an item was accepted; `bad` when the Body refused the plan or the
 * call failed after the plan was sent; `impossible` when nothing reached the Body (the validator or
 * a precondition refused every item).
 */
export type OutcomeClass = 'good' | 'bad' | 'impossible';

/** One metered act. `wouldCost` is the credits the whole thought would have cost; `charged` the accepted part. */
export interface MeteredAct {
  wouldCost: number;
  charged: number;
  outcome: OutcomeClass;
  durationMs: number;
}

/** Running totals of one life's metered acts. */
export interface LifeTotals {
  /** Credits that accepted items would have cost: the spend of the life so far. */
  spent: number;
  /** Credits the whole of every thought would have cost, accepted or not. */
  wouldCost: number;
  calls: number;
  good: number;
  bad: number;
  impossible: number;
  durationMs: number;
}

/** The outcome class of an act, from what was accepted and whether the plan reached the Body. */
export function outcomeClassOf(accepted: number, sent: boolean, failed: boolean): OutcomeClass {
  if (accepted > 0) return 'good';
  if (sent || failed) return 'bad';
  return 'impossible';
}

/** The credits a whole thought would cost: one per item, say, action or intent. */
export function wouldCostOf(kinds: readonly ChargedItem[]): number {
  return kinds.length;
}

const EMPTY: LifeTotals = {
  spent: 0,
  wouldCost: 0,
  calls: 0,
  good: 0,
  bad: 0,
  impossible: 0,
  durationMs: 0,
};

/** In-memory running totals per life. The events carry the same figures to the sink for analysis. */
export class ActMeter {
  private readonly lives = new Map<string, LifeTotals>();

  /** Adds one metered act to its life's totals and returns the new totals. */
  record(lifeId: string, act: MeteredAct): LifeTotals {
    const prior = this.lives.get(lifeId) ?? EMPTY;
    const next: LifeTotals = {
      spent: prior.spent + act.charged,
      wouldCost: prior.wouldCost + act.wouldCost,
      calls: prior.calls + 1,
      good: prior.good + (act.outcome === 'good' ? 1 : 0),
      bad: prior.bad + (act.outcome === 'bad' ? 1 : 0),
      impossible: prior.impossible + (act.outcome === 'impossible' ? 1 : 0),
      durationMs: prior.durationMs + Math.max(0, act.durationMs),
    };
    this.lives.set(lifeId, next);
    return next;
  }

  /** The totals of one life; zero when it has no metered act yet. */
  totalsOf(lifeId: string): LifeTotals {
    return this.lives.get(lifeId) ?? EMPTY;
  }
}

/** The process-wide meter: `act` records into it and `status` reads it, unless a caller gives its own. */
export const processMeter = new ActMeter();
