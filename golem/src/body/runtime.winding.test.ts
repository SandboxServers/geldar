import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cancelled } from '../actions/outcome.ts';
import type { ActionHandler } from '../actions/registry.ts';
import { fakeBot, fakeView, manualTicks } from './body.fakes.ts';
import { BodyRuntime, MemorySink } from './index.ts';
import { sanitiseTimeScale } from './runtime.ts';

/** A `wait` handler that ignores its abort and ends only when `finish()` is called. */
function stubbornWait(): ActionHandler<'wait'> & { started(): number; finish(): void } {
  let started = 0;
  const finishers: Array<() => void> = [];
  return {
    kind: 'wait',
    timeoutMs: 600_000,
    started: () => started,
    finish: () => {
      for (const finish of finishers.splice(0)) finish();
    },
    run: async () => {
      started += 1;
      await new Promise<void>((resolve) => finishers.push(resolve));
      return cancelled();
    },
  };
}

function runtimeWith(timeScale?: number) {
  const runtime = new BodyRuntime({
    lifeId: 'ag_test_01',
    bodyGeneration: 1,
    bot: fakeBot(),
    ticks: manualTicks().source,
    sink: new MemorySink(),
    view: fakeView(),
    ...(timeScale === undefined ? {} : { timeScale }),
  });
  const wait = stubbornWait();
  runtime.actions.register(wait);
  return { runtime, wait };
}

const WAIT = { do: 'wait', seconds: 1 };

/** Starts an action and aborts it by its own signal: its run settles, its handler keeps going. */
async function abandonedRun(runtime: BodyRuntime): Promise<void> {
  const abort = new AbortController();
  const run = runtime.runAction(WAIT, abort.signal);
  await vi.advanceTimersByTimeAsync(0);
  abort.abort();
  expect((await run).state).toBe('cancelled');
  expect(runtime.actionRunning).toBe(false);
}

describe('BodyRuntime: the handler winding down', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('cancelAction waits for a handler that outlives its settled run', async () => {
    const { runtime, wait } = runtimeWith();
    await abandonedRun(runtime);
    let done = false;
    const cancel = runtime.cancelAction().then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(500);
    expect(done).toBe(false);
    wait.finish();
    await cancel;
    expect(done).toBe(true);
  });

  it('runAction does not start the next action until the old handler has ended', async () => {
    const { runtime, wait } = runtimeWith();
    await abandonedRun(runtime);
    const next = runtime.runAction(WAIT);
    await vi.advanceTimersByTimeAsync(500);
    expect(wait.started()).toBe(1);
    wait.finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(wait.started()).toBe(2);
    wait.finish();
    await next;
  });

  it('gives up on a handler that ignores the abort after the grace, scaled by the time scale', async () => {
    const { runtime } = runtimeWith(0.5);
    await abandonedRun(runtime);
    let done = false;
    const cancel = runtime.cancelAction().then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await cancel;
    expect(done).toBe(true);
  });

  it('a second cancelAction during the grace waits as well', async () => {
    const { runtime, wait } = runtimeWith();
    await abandonedRun(runtime);
    const first = runtime.cancelAction();
    await vi.advanceTimersByTimeAsync(100);
    let secondDone = false;
    const second = runtime.cancelAction().then(() => {
      secondDone = true;
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(secondDone).toBe(false);
    wait.finish();
    await Promise.all([first, second]);
    expect(secondDone).toBe(true);
  });

  it('reads a zero, NaN or infinite time scale as 1', async () => {
    for (const bad of [0, Number.NaN, Number.POSITIVE_INFINITY, -3]) {
      expect(sanitiseTimeScale(bad)).toBe(1);
    }
    expect(sanitiseTimeScale(0.25)).toBe(0.25);
    const { runtime } = runtimeWith(0);
    expect(runtime.timeScale).toBe(1);
    await abandonedRun(runtime);
    let done = false;
    const cancel = runtime.cancelAction().then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(1999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await cancel;
    expect(done).toBe(true);
  });
});
