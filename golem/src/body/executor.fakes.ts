import { completed, failed } from '../actions/outcome.ts';
import type { ActionHandler } from '../actions/registry.ts';
import { fakeBot, fakeView, manualTicks } from './body.fakes.ts';
import { IntentExecutor, type PlanEnvelope } from './executor.ts';
import type { IntentProgram, ProgramContext, StepResult } from './program.ts';
import { MemorySink } from './records.ts';
import type { Reflex } from './reflex.ts';
import { BodyRuntime } from './runtime.ts';
import type { BodyView } from './view.ts';
import { WakeTap } from './wake-conditions.ts';

/** A well-formed id: `prefix_` and 26 Crockford characters, derived from `n`. */
export function fakeId(prefix: 'ac' | 'in' | 'sn', n: number): string {
  return `${prefix}_${String(n).padStart(26, '0')}`;
}

/** What a scripted program did, for the test to read. */
export interface ProgramLog {
  started: unknown[];
  resumed: unknown[];
  steps: number;
  /** One entry per step: whether its signal was already aborted when it returned. */
  aborted: boolean[];
}

/**
 * A program that returns `script[n]` on step n (the last entry repeats). With `hold`, each step
 * waits until its signal aborts or `releaseStep()` is called.
 */
export function scriptedProgram(
  script: StepResult[],
  opts: { hold?: boolean } = {},
): IntentProgram & { log: ProgramLog; releaseStep(): void } {
  const log: ProgramLog = { started: [], resumed: [], steps: 0, aborted: [] };
  let release: () => void = () => undefined;
  return {
    name: 'fake',
    log,
    releaseStep: () => release(),
    start: async (args) => {
      log.started.push(args);
    },
    resume: async (checkpoint) => {
      log.resumed.push(checkpoint);
    },
    checkpoint: () => ({ steps: log.steps }),
    step: async (ctx: ProgramContext) => {
      const result = script[Math.min(log.steps, script.length - 1)] ?? { status: 'running' };
      log.steps += 1;
      if (opts.hold) {
        await new Promise<void>((resolve) => {
          release = resolve;
          ctx.signal.addEventListener('abort', () => resolve(), { once: true });
        });
      }
      log.aborted.push(ctx.signal.aborted);
      return result;
    },
  };
}

/** A `wait` handler that completes and counts its runs, and an `eat` handler that always fails. */
export function countingHandlers(): {
  wait: ActionHandler<'wait'>;
  eat: ActionHandler<'eat'>;
  runs: string[];
} {
  const runs: string[] = [];
  return {
    runs,
    wait: {
      kind: 'wait',
      timeoutMs: 1000,
      run: async (_ctx, action) => {
        runs.push(`wait:${action.seconds}`);
        return completed();
      },
    },
    eat: {
      kind: 'eat',
      timeoutMs: 1000,
      run: async () => {
        runs.push('eat');
        return failed('not_possible', 'nothing to eat');
      },
    },
  };
}

/** A view whose health, tick and inventory the test sets. */
export interface MutableView extends BodyView {
  health: number;
  tick: number;
  inventory: Record<string, number>;
}

/** Everything one executor test needs, wired with fakes. */
export interface ExecutorHarness {
  ticks: ReturnType<typeof manualTicks>;
  sink: MemorySink;
  tap: WakeTap;
  view: MutableView;
  runtime: BodyRuntime;
  executor: IntentExecutor;
  handlers: ReturnType<typeof countingHandlers>;
  /** The snapshot revision the Body is at; the test may change it. */
  revision: { current: number };
  /** The agents near the Body, by name, for `new_agent_within_N`. */
  agents: { within: Record<number, string[]> };
  /** The program the registry hands out for `program: 'fake'`. */
  program: { current: IntentProgram };
}

export const LIFE = 'ag_test_01';
export const GENERATION = 3;

export function executorHarness(
  opts: { reflexes?: Reflex[]; script?: StepResult[]; hold?: boolean; window?: number } = {},
): ExecutorHarness {
  const ticks = manualTicks();
  const sink = new MemorySink();
  const tap = new WakeTap(sink);
  const base = fakeView();
  const view = Object.assign(base, { inventory: {} as Record<string, number> }) as MutableView;
  view.inventoryCount = (item) => view.inventory[item] ?? 0;
  const runtime = new BodyRuntime({
    lifeId: LIFE,
    bodyGeneration: GENERATION,
    bot: fakeBot(),
    ticks: ticks.source,
    sink: tap,
    view,
    reflexes: opts.reflexes ?? [],
  });
  const handlers = countingHandlers();
  runtime.actions.register(handlers.wait);
  runtime.actions.register(handlers.eat);
  const program = { current: scriptedProgram(opts.script ?? [{ status: 'running' }], opts) };
  runtime.programs.register('fake', () => program.current);
  const revision = { current: 5 };
  const agents = { within: {} as Record<number, string[]> };
  const executor = new IntentExecutor({
    runtime,
    ticks: ticks.source,
    currentRevision: () => revision.current,
    wakeTap: tap,
    nearbyAgents: (radius) => agents.within[radius] ?? [],
    ...(opts.window === undefined ? {} : { snapshotWindow: opts.window }),
  });
  return { ticks, sink, tap, view, runtime, executor, handlers, revision, agents, program };
}

/** A valid envelope for the harness body; `n` keeps ids apart between plans. */
export function planFor(
  actions: number,
  opts: Partial<PlanEnvelope> & { n?: number } = {},
): PlanEnvelope {
  const n = opts.n ?? 1;
  const { n: _n, ...rest } = opts;
  return {
    lifeId: LIFE,
    bodyGeneration: GENERATION,
    sourceSnapshotId: fakeId('sn', n),
    snapshotRevision: 5,
    expiresTick: 1000,
    intentId: fakeId('in', n),
    actionIds: Array.from({ length: actions }, (_, i) => fakeId('ac', n * 100 + i)),
    ...rest,
  };
}

/** A thought with `waits` wait actions and, when `intent` is given, that intent over program `fake`. */
export function thought(
  opts: {
    actions?: unknown[];
    intent?: {
      wake_on?: string[];
      preconditions?: string[];
      program?: string;
      limits?: { ticks?: number; ops?: number };
    };
  } = {},
): unknown {
  const out: Record<string, unknown> = { reasoning: 'test' };
  if (opts.actions) out.actions = opts.actions;
  if (opts.intent) {
    out.intent = {
      goal: 'test_goal',
      program: opts.intent.program ?? 'fake',
      arguments: { n: 1 },
      wake_on: opts.intent.wake_on ?? [],
      ...(opts.intent.preconditions ? { preconditions: opts.intent.preconditions } : {}),
      limits: {
        max_world_ticks: opts.intent.limits?.ticks ?? 1000,
        max_block_operations: opts.intent.limits?.ops ?? 100,
      },
    };
  }
  return out;
}

/** `count` `wait` actions. */
export function waits(count: number): unknown[] {
  return Array.from({ length: count }, (_, i) => ({ do: 'wait', seconds: i + 1 }));
}
