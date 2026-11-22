import type { SimEvent } from '@geldar/mcp-mock';
import { definePresentHandler } from './types.ts';

/** A phase or block name the sentence may show: lower-case words, 32 characters at most. Others are left out. */
const NAME = /^[a-z_]{1,32}$/;

/**
 * The plan's progress as one fixed sentence: the counts, the phase and the next item needed. Only numbers and
 * the names the Body sends appear; a name that fails the pattern is left out. The sentence is about the plan
 * alone and says nothing about anyone watching.
 */
export function planProgressSentence(plan: NonNullable<SimEvent['plan']>): string {
  const done = Number.isSafeInteger(plan.done) ? Math.max(0, plan.done) : 0;
  const total = Number.isSafeInteger(plan.total) ? Math.max(0, plan.total) : 0;
  const phase = NAME.test(plan.phase) ? ` Phase: ${plan.phase}.` : '';
  const next = plan.nextNeed;
  const need =
    next !== undefined && NAME.test(next.block) && Number.isSafeInteger(next.count)
      ? ` Next: ${next.count} ${next.block} needed.`
      : '';
  return `Plan: ${done} of ${total} cells done.${phase}${need}`;
}

/** The plan_progress presenter: one line per event that carries the plan's counts. */
export const planProgressPresenter = definePresentHandler('plan_progress', (e, base) =>
  e.plan === undefined
    ? []
    : [{ ...base, type: 'plan_progress', text: planProgressSentence(e.plan) }],
);
