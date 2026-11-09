import type { Intent } from '@geldar/contract';

/** How an intent run stands. */
export interface IntentState {
  /** The `in_` id of the run; empty until the caller sets one. */
  id: string;
  /** The intent as the model submitted it. */
  spec: Intent;
  /** The tick it started. */
  startedTick: number;
  /** How many ticks the run takes when nothing stops it. */
  durationTicks: number;
  /** Ticks run so far. */
  progressTicks: number;
  /** `running` until `advanceIntent` ends it as completed, failed or limit_reached. */
  status: 'running' | 'completed' | 'failed' | 'limit_reached';
  /** Resumable state saved by the executor. */
  checkpoint: { progress_ticks: number };
}

/** How `advanceIntent` ended a run, if it did. */
export type IntentEnd = 'completed' | 'failed' | 'limit_reached';

/** The tick at which a run ends if nothing fails it: its duration, or the tick limit if smaller. */
export function intentEndTick(state: IntentState): number {
  return state.startedTick + Math.min(state.durationTicks, state.spec.limits.max_world_ticks);
}

function missingPrecondition(spec: Intent, facts: ReadonlySet<string>): boolean {
  return (spec.preconditions ?? []).some((p) => !facts.has(p));
}

/**
 * Starts a scripted run. Every precondition must be in `facts`. Its length is `arguments.mock_ticks`
 * when that is a positive integer, else `defaultTicks`.
 */
export function startIntent(
  spec: Intent,
  atTick: number,
  defaultTicks: number,
  facts: ReadonlySet<string>,
): { ok: true; state: IntentState } | { ok: false; reason: 'precondition_false' } {
  if (missingPrecondition(spec, facts)) return { ok: false, reason: 'precondition_false' };
  const mock = spec.arguments.mock_ticks;
  const durationTicks =
    typeof mock === 'number' && Number.isInteger(mock) && mock > 0 ? mock : defaultTicks;
  return {
    ok: true,
    state: {
      id: '',
      spec,
      startedTick: atTick,
      durationTicks,
      progressTicks: 0,
      status: 'running',
      checkpoint: { progress_ticks: 0 },
    },
  };
}

/**
 * Moves a run to `toTick` against the facts that hold now. A missing precondition fails it at that
 * tick; reaching `max_world_ticks` first ends it `limit_reached`; reaching its length completes it.
 * Progress is clamped to the end tick. Pure.
 */
export function advanceIntent(
  state: IntentState,
  toTick: number,
  facts: ReadonlySet<string>,
): { state: IntentState; finished: IntentEnd | null; failure?: 'precondition_failed' } {
  if (state.status !== 'running') return { state, finished: null };
  const done = (
    progress: number,
    status: IntentEnd,
  ): { state: IntentState; finished: IntentEnd; failure?: 'precondition_failed' } => ({
    state: { ...state, progressTicks: progress, status, checkpoint: { progress_ticks: progress } },
    finished: status,
    ...(status === 'failed' ? { failure: 'precondition_failed' as const } : {}),
  });
  const elapsed = Math.max(0, toTick - state.startedTick);
  const limit = state.spec.limits.max_world_ticks;
  if (missingPrecondition(state.spec, facts))
    return done(Math.min(elapsed, limit, state.durationTicks), 'failed');
  if (limit < state.durationTicks && elapsed >= limit) return done(limit, 'limit_reached');
  if (elapsed >= state.durationTicks) return done(state.durationTicks, 'completed');
  return {
    state: { ...state, progressTicks: elapsed, checkpoint: { progress_ticks: elapsed } },
    finished: null,
  };
}
