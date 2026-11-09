import type { Action } from '@geldar/contract';
import { type ActionRun, runAction } from '../../actions/registry.ts';
import type { ProgramContext, StepResult } from '../program.ts';

/** Fail reasons that mean the Mind must change the plan, not that the program broke. */
const PRECONDITION_REASONS = new Set(['missing_materials', 'missing_station']);

/** Runs one action through the shared registry, tied to the intent's abort signal. */
export function runStepAction(ctx: ProgramContext, action: Action): Promise<ActionRun> {
  return runAction(ctx.registry, ctx.bot, action, { signal: ctx.signal });
}

/**
 * The step result for an action that did not complete, or null when it did. A cancel leaves the
 * program `running` (the executor owns the abort); a missing material or station wakes the Mind;
 * anything else fails the intent with `reason: message`.
 */
export function stopOf(run: ActionRun): StepResult | null {
  if (run.state === 'completed') return null;
  if (run.state === 'cancelled') return { status: 'running' };
  const reason = run.result.reason ?? 'internal';
  const message = `${reason}: ${run.result.message ?? 'action failed'}`;
  if (PRECONDITION_REASONS.has(reason)) {
    return { status: 'wake', reason: 'precondition_failed', message };
  }
  return { status: 'failed', message };
}
