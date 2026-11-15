import { ABANDONED_KEY } from './executor-intent.ts';
import type { ActiveIntent, StepSnapshot } from './executor-types.ts';
import type { ProgramCheckpoint } from './program.ts';
import { isBlockedAbandoned } from './reflexes/blocked-path.ts';
import type { BodyRuntime } from './runtime.ts';

/** True when the intent was given up on: a resumed abandoned intent, or the blocked-path reflex gave up on it. */
export function abandonedIntent(runtime: BodyRuntime, a: ActiveIntent): boolean {
  return a.resumedAbandoned || isBlockedAbandoned(runtime.view, a.id);
}

/** The program's checkpoint plus the abandoned flag when the intent was given up on. */
export function savedCheckpointOf(runtime: BodyRuntime, a: ActiveIntent): ProgramCheckpoint | null {
  const own = a.program.checkpoint();
  if (!abandonedIntent(runtime, a)) return own;
  return { ...own, [ABANDONED_KEY]: true };
}

/** What the observer and a restart see of a running intent. */
export function snapshotOf(runtime: BodyRuntime, a: ActiveIntent): StepSnapshot {
  return {
    intentId: a.id,
    intent: a.intent,
    checkpoint: savedCheckpointOf(runtime, a),
    blockOperationsUsed: a.limits.blockOperationsUsed,
    expiresTick: a.expiresTick,
  };
}
