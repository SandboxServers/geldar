import type { Action } from '@geldar/contract';
import type { ActionRun } from '../../actions/registry.ts';
import type { ProgramContext, StepResult } from '../program.ts';
import { hasBlockedReport } from '../reflexes/blocked-path.ts';

/** Fail reasons that mean the Mind must change the plan, not that the program broke. */
const PRECONDITION_REASONS = new Set(['missing_materials', 'missing_station']);

/**
 * Runs one action in the Body's current-action slot, tied to the step's abort signal, so a reflex
 * can pre-empt it and `timeScale` applies.
 */
export function runStepAction(ctx: ProgramContext, action: Action): Promise<ActionRun> {
  return ctx.runAction(action, ctx.signal);
}

/**
 * The step result for an action that did not complete, or null when it did. A cancel leaves the
 * program `running` (the executor owns the abort); a missing material or station wakes the Mind;
 * anything else fails the intent with `reason: message`. A walk that ended `blocked` while the
 * blocked-path reflex has a report waiting (`ctx` given) leaves the program `running`: the reflex
 * takes the detour next tick and the step then walks again, instead of the intent failing first.
 */
export function stopOf(run: ActionRun, ctx?: ProgramContext): StepResult | null {
  if (run.state === 'completed') return null;
  if (run.state === 'cancelled') return { status: 'running' };
  const reason = run.result.reason ?? 'internal';
  if (reason === 'blocked' && ctx && hasBlockedReport(ctx.view)) return { status: 'running' };
  const message = `${reason}: ${run.result.message ?? 'action failed'}`;
  if (PRECONDITION_REASONS.has(reason)) {
    return { status: 'wake', reason: 'precondition_failed', message };
  }
  return { status: 'failed', message };
}
