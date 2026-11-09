import type { Thought } from '@geldar/contract';
import { errorText } from '../actions/outcome.ts';
import type { ActiveIntent, IntentDisposition } from './executor.ts';
import { LimitTracker } from './limits.ts';
import type { PreconditionRegistry } from './preconditions.ts';
import type { ProgramCheckpoint } from './program.ts';
import type { IntentState } from './records.ts';
import type { BodyRuntime } from './runtime.ts';
import type { WakeReason } from './wake.ts';
import { WakeConditions } from './wake-conditions.ts';

/** What starting an intent needs from the executor. */
export interface IntentStartDeps {
  runtime: BodyRuntime;
  preconditions: PreconditionRegistry;
  agents: (radius: number) => string[];
  tick: () => number;
  setState(a: ActiveIntent, state: IntentState, detail?: string): void;
  end(a: ActiveIntent, state: IntentState, detail: string, wake?: WakeReason): Promise<void>;
  current(): ActiveIntent | null;
  install(a: ActiveIntent): void;
}

/** How an intent starts: fresh from its arguments, or again after a Body restart. */
export interface IntentStartMode {
  /**
   * True after a restart: the program is resumed from the intent's saved `checkpoint` (when it
   * has one). A thought's own `checkpoint` is never trusted: a plan always starts the program
   * from its arguments.
   */
  resumed: boolean;
  /** Block operations the earlier run already counted against `max_block_operations`. */
  usedBlockOperations?: number;
}

/**
 * Replaces the current intent (it ends `cancelled`) with a new one: records `accepted`, checks the
 * preconditions (an unknown name fails), builds the program from the registry, starts it (or, in
 * `resumed` mode, resumes it from the intent's `checkpoint`), then records `running`. A failure
 * ends the new intent `failed` and says which of the dispositions it was.
 */
export async function startIntentRun(
  deps: IntentStartDeps,
  intent: NonNullable<Thought['intent']>,
  id: string,
  mode: IntentStartMode = { resumed: false },
): Promise<IntentDisposition> {
  const { runtime } = deps;
  const old = deps.current();
  if (old) await deps.end(old, 'cancelled', `replaced by ${id}`);

  const controller = new AbortController();
  const view = runtime.view;
  const a: ActiveIntent = {
    id,
    intent,
    expiresTick: deps.tick() + intent.limits.max_world_ticks,
    // Replaced below; the intent is not visible to the executor until it is installed.
    program: undefined as never,
    base: {
      bot: runtime.bot,
      view,
      registry: runtime.actions,
      sink: runtime.sink,
      lifeId: runtime.lifeId,
      bodyGeneration: runtime.bodyGeneration,
      timeScale: runtime.timeScale,
      // Every action a program runs goes through the runtime's one slot; the executor counts it.
      runAction: (action, signal) => {
        a.ownActions.add(action);
        return runtime.runAction(action, signal);
      },
    },
    controller,
    stepController: null,
    limits: new LimitTracker(
      {
        maxWorldTicks: intent.limits.max_world_ticks,
        maxBlockOperations: intent.limits.max_block_operations,
      },
      deps.tick(),
    ),
    wake: new WakeConditions(intent.wake_on, { health: view.health, agentsWithin: deps.agents }),
    preconditions: intent.preconditions ?? [],
    state: 'accepted',
    pause: null,
    stepping: null,
    ended: false,
    interrupted: false,
    reflexWoke: false,
    ownActions: new WeakSet(),
  };
  a.limits.addBlockOperations(mode.usedBlockOperations ?? 0);
  deps.setState(a, 'accepted');

  const verdict = deps.preconditions.evaluate(a.preconditions, view);
  if (!verdict.ok) {
    const why = verdict.unknown ? 'unknown precondition' : 'precondition failed';
    await deps.end(a, 'failed', `${why}: ${verdict.name}`, 'precondition_failed');
    return 'precondition_failed';
  }
  const program = runtime.programs.create(intent.program);
  if (!program) {
    await deps.end(a, 'failed', `unsupported program ${intent.program}`);
    return 'unsupported_program';
  }
  a.program = program;
  try {
    const ctx = { ...a.base, signal: controller.signal };
    if (mode.resumed && intent.checkpoint)
      await program.resume(intent.checkpoint as ProgramCheckpoint, ctx);
    else await program.start(intent.arguments, ctx);
  } catch (error) {
    await deps.end(a, 'failed', errorText(error));
    return 'invalid_arguments';
  }
  deps.install(a);
  deps.setState(a, 'running');
  return 'started';
}
