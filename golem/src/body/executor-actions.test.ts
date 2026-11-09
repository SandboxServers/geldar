import type { Action } from '@geldar/contract';
import { describe, expect, it, vi } from 'vitest';
import { cancelled, completed, failed } from '../actions/outcome.ts';
import type { ActionRun } from '../actions/registry.ts';
import { fakeReflex } from './body.fakes.ts';
import { executorHarness, fakeId, planFor, thought, waits } from './executor.fakes.ts';
import { IntentExecutor, type IntentObserver, type StepSnapshot } from './executor.ts';
import type { IntentProgram, ProgramContext } from './program.ts';
import { TravelProgram } from './programs/travel.ts';
import type { Reflex } from './reflex.ts';

const MINE: Action = { do: 'mine', block: 'oak_log', count: 8 };
const WAIT: Action = { do: 'wait', seconds: 5 };

const completedRun: ActionRun = {
  state: 'completed',
  result: { status: 'completed', latency_ms: 1, world_ticks: 1, detail: {} },
};

/** A program whose step runs `action` through the context (the way the real programs do). */
function actionProgram(
  action: Action,
  seen: { runs: ActionRun[]; contexts: ProgramContext[] } = { runs: [], contexts: [] },
): IntentProgram & { seen: typeof seen } {
  let steps = 0;
  return {
    name: 'fake',
    seen,
    start: async () => undefined,
    resume: async () => undefined,
    checkpoint: () => ({ steps }),
    step: async (ctx) => {
      steps += 1;
      seen.contexts.push(ctx);
      seen.runs.push(await ctx.runAction(action, ctx.signal));
      return { status: 'running' };
    },
  };
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('the current-action slot', () => {
  /** A `wait` handler that, once aborted, takes a moment to clean up before it returns. */
  function slowWait(h: ReturnType<typeof executorHarness>) {
    const state = { started: 0, aborted: false, cleaned: false };
    h.handlers.wait.run = async (ctx) => {
      state.started += 1;
      await new Promise<void>((resolve) =>
        ctx.signal.addEventListener('abort', () => resolve(), { once: true }),
      );
      state.aborted = true;
      await sleep(20);
      state.cleaned = true;
      return cancelled();
    };
    return state;
  }

  it('lets a reflex pre-empt a program step action and waits for the handler to wind down', async () => {
    const seen = { cleaned: null as boolean | null };
    const reflex: Reflex = {
      name: 'eat',
      priority: 1,
      cooldownTicks: 0,
      check: () => ({}),
      run: async (_trigger, ctx) => {
        await ctx.cancelAction();
        seen.cleaned = state.cleaned;
        return { result: 'handled' };
      },
    };
    const h = executorHarness({ reflexes: [reflex] });
    const state = slowWait(h);
    h.program.current = actionProgram(WAIT);
    await h.executor.submit(thought({ intent: {} }), planFor(0));
    const stepping = h.executor.onTick(1);
    await vi.waitFor(() => expect(state.started).toBe(1));
    // The executor is not told: only the reflex's cancelAction can reach the step's action.
    await h.runtime.reflexRunner.onTick(2);
    expect(state.aborted).toBe(true);
    expect(seen.cleaned).toBe(true);
    await stepping;
    expect(h.runtime.actionRunning).toBe(false);
  });

  it('lets a reflex pre-empt a real travel program, which then walks on once the reflex is done', async () => {
    const gotos = { started: 0, cleaned: false };
    const seen = { cleaned: null as boolean | null };
    const reflex: Reflex = {
      name: 'eat',
      priority: 1,
      cooldownTicks: 0,
      check: () => ({}),
      run: async (_trigger, ctx) => {
        await ctx.cancelAction();
        seen.cleaned = gotos.cleaned;
        return { result: 'handled' };
      },
    };
    const h = executorHarness({ reflexes: [reflex] });
    h.runtime.programs.register('travel', () => new TravelProgram());
    h.runtime.actions.register({
      kind: 'goto',
      timeoutMs: 1000,
      run: async (ctx) => {
        gotos.started += 1;
        if (gotos.started > 1) return completed();
        await new Promise<void>((resolve) =>
          ctx.signal.addEventListener('abort', () => resolve(), { once: true }),
        );
        await sleep(20);
        gotos.cleaned = true;
        return cancelled();
      },
    });
    const walk = {
      reasoning: 'go',
      intent: {
        goal: 'walk',
        program: 'travel',
        arguments: { target: { x: 50, y: 64, z: 50 } },
        wake_on: [],
        limits: { max_world_ticks: 1000, max_block_operations: 100 },
      },
    };
    expect((await h.executor.submit(walk, planFor(0))).intent).toBe('started');
    const stepping = h.executor.onTick(1);
    await vi.waitFor(() => expect(gotos.started).toBe(1));
    await h.runtime.reflexRunner.onTick(2);
    expect(seen.cleaned).toBe(true);
    await stepping;
    expect(h.executor.intentState).toBe('running');
    await h.executor.onTick(3);
    expect(gotos.started).toBe(2);
    expect(h.executor.intentState).toBe('running');
    expect(h.sink.wakes).toEqual([]);
  });
  it('makes immediate actions wait while a reflex is busy', async () => {
    const active = { on: true };
    const reflex = fakeReflex('eat', { priority: 1, hold: true, active: () => active.on });
    const h = executorHarness({ reflexes: [reflex] });
    const fired = h.runtime.reflexRunner.onTick(1);
    expect(h.runtime.reflexRunner.busy).toBe(true);
    active.on = false;
    const submitted = h.executor.submit(thought({ actions: waits(1) }), planFor(1));
    await sleep(15);
    expect(h.handlers.runs).toEqual([]);
    reflex.release();
    await fired;
    const result = await submitted;
    expect(result.actions[0]?.record.state).toBe('completed');
    expect(h.handlers.runs).toEqual(['wait:1']);
  });

  it('passes the runtime time scale to the program context and to the handler', async () => {
    const h = executorHarness({ timeScale: 0.25 });
    let handlerScale = 0;
    h.handlers.wait.run = async (ctx) => {
      handlerScale = ctx.timeScale;
      return completed();
    };
    const program = actionProgram(WAIT);
    h.program.current = program;
    await h.executor.submit(thought({ intent: {} }), planFor(0));
    await h.executor.onTick(1);
    expect(program.seen.contexts[0]?.timeScale).toBe(0.25);
    expect(handlerScale).toBe(0.25);
  });
});

describe('block operation limits', () => {
  /** A harness whose `mine` handler returns `outcome`, and whose finished actions reach the executor. */
  function mining(outcome: () => ReturnType<typeof failed> | ReturnType<typeof completed>) {
    const h = executorHarness();
    h.runtime.actions.register({ kind: 'mine', timeoutMs: 1000, run: async () => outcome() });
    h.runtime.actions.onFinished((action, run) => h.executor.noteAction(action as Action, run));
    return h;
  }

  it('counts the blocks a failed mine had already broken', async () => {
    const h = mining(() => failed('not_found', 'no more', { mined: 3 }));
    h.program.current = actionProgram(MINE);
    await h.executor.submit(thought({ intent: { limits: { ops: 3 } } }), planFor(0));
    await h.executor.onTick(1);
    expect(h.executor.intentState).toBe('running');
    await h.executor.onTick(2);
    expect(h.sink.intents.at(-1)?.detail).toBe('max_block_operations reached');
  });

  it('counts the blocks a cancelled mine had already broken, and nothing for a failed place', async () => {
    const h = mining(() => cancelled({ mined: 2 }));
    h.runtime.actions.register({
      kind: 'place',
      timeoutMs: 1000,
      run: async () => failed('not_possible', 'no room'),
    });
    h.program.current = actionProgram(MINE);
    await h.executor.submit(thought({ intent: { limits: { ops: 3 } } }), planFor(0));
    await h.executor.onTick(1);
    h.runtime.actions.notifyFinished(
      { do: 'place', block: 'dirt', at: { x: 1, y: 2, z: 3 } },
      { ...completedRun, state: 'failed' },
    );
    await h.executor.onTick(2);
    expect(h.executor.intentState).toBe('running');
    await h.executor.onTick(3);
    expect(h.sink.intents.at(-1)?.detail).toBe('max_block_operations reached');
  });

  it('counts a completed mine of a program and ignores one it did not run, even mid-step', async () => {
    const h = mining(() => completed({ mined: 2 }));
    let release: () => void = () => undefined;
    let hold = true;
    const program = actionProgram({ ...MINE, count: 2 });
    const step = program.step.bind(program);
    program.step = async (ctx) => {
      const result = await step(ctx);
      if (hold) {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
      return result;
    };
    h.program.current = program;
    await h.executor.submit(thought({ intent: { limits: { ops: 3 } } }), planFor(0));
    const stepping = h.executor.onTick(1);
    await vi.waitFor(() => expect(program.seen.runs).toHaveLength(1));
    // A reflex's mine ends while the step is in flight: it is not the intent's work.
    h.runtime.actions.notifyFinished({ do: 'mine', block: 'stone', count: 9 }, completedRun);
    hold = false;
    release();
    await stepping;
    expect(h.executor.intentState).toBe('running');
    await h.executor.onTick(2);
    expect(h.executor.intentState).toBe('running');
  });

  it('starts a resumed intent with the block operations the earlier run spent', async () => {
    const h = executorHarness();
    const t = thought({ intent: { limits: { ops: 5 } } }) as {
      intent: Parameters<IntentExecutor['resume']>[0];
    };
    await h.executor.resume(t.intent, fakeId('in', 1), 5);
    await h.executor.onTick(1);
    expect(h.sink.intents.at(-1)?.detail).toBe('max_block_operations reached');
  });
});

describe('checkpoints of the running intent', () => {
  function observed() {
    const h = executorHarness();
    const steps: StepSnapshot[] = [];
    const observer: IntentObserver = { stepped: (s) => steps.push(s), ended: () => undefined };
    const executor = new IntentExecutor({
      runtime: h.runtime,
      ticks: h.ticks.source,
      currentRevision: () => h.revision.current,
      observer,
    });
    return { h, executor, steps };
  }

  it('saves the checkpoint when the intent is installed, before any step', async () => {
    const { h, executor, steps } = observed();
    await executor.submit(thought({ intent: {} }), planFor(0));
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({
      intentId: fakeId('in', 1),
      checkpoint: { steps: 0 },
      blockOperationsUsed: 0,
    });
    await executor.onTick(1);
    expect(steps).toHaveLength(2);
    expect(steps[1]?.checkpoint).toEqual({ steps: 1 });
    expect(h.program.current).toBeDefined();
  });

  it('carries the block operations used so far', async () => {
    const { executor, steps } = observed();
    await executor.submit(thought({ intent: {} }), planFor(0));
    executor.noteBlockOperations(4);
    await executor.onTick(1);
    expect(steps.at(-1)?.blockOperationsUsed).toBe(4);
  });
});
