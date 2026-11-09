import { afterEach, describe, expect, it, vi } from 'vitest';
import { completed } from '../actions/outcome.ts';
import { fakeReflex } from './body.fakes.ts';
import { executorHarness, planFor, thought, waits } from './executor.fakes.ts';

/** A reflex that holds the Body until released, started by `start()` from inside an action. */
function holdingReflex() {
  const active = { on: false };
  const reflex = fakeReflex('eat', { priority: 1, hold: true, active: () => active.on });
  return { active, reflex };
}

describe('immediate actions and a reflex that starts between them', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('waits for a reflex that began while the first action ran before it starts the second', async () => {
    const { active, reflex } = holdingReflex();
    const h = executorHarness({ reflexes: [reflex] });
    let fired: Promise<void> | undefined;
    let calls = 0;
    h.handlers.wait.run = async () => {
      calls += 1;
      if (calls === 1) {
        active.on = true;
        fired = h.runtime.reflexRunner.onTick(1);
        active.on = false;
      }
      return completed();
    };
    const submitted = h.executor.submit(thought({ actions: waits(2) }), planFor(2));
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(calls).toBe(1);
    reflex.release();
    await fired;
    const result = await submitted;
    expect(calls).toBe(2);
    expect(result.actions.map((a) => a.record.state)).toEqual(['completed', 'completed']);
  });

  it('waits before the first action for a reflex that began while the intent was being paused', async () => {
    const { active, reflex } = holdingReflex();
    const h = executorHarness({ reflexes: [reflex], hold: true });
    await h.executor.submit(thought({ intent: {} }), planFor(0));
    let fired: Promise<void> | undefined;
    const cancel = h.runtime.cancelAction.bind(h.runtime);
    // The reflex starts after the wait at the top of submit, while the running intent is paused.
    vi.spyOn(h.runtime, 'cancelAction').mockImplementation(async () => {
      active.on = true;
      fired = h.runtime.reflexRunner.onTick(1);
      active.on = false;
      await cancel();
    });
    const submitted = h.executor.submit(thought({ actions: waits(1) }), planFor(1, { n: 2 }));
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(fired).toBeDefined();
    expect(h.handlers.runs).toEqual([]);
    reflex.release();
    await fired;
    const result = await submitted;
    expect(h.handlers.runs).toEqual(['wait:1']);
    expect(result.actions[0]?.record.state).toBe('completed');
  });

  it('gives up on a reflex that never ends after a scaled timeout, and warns', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { active, reflex } = holdingReflex();
    // Time scale 0 reads as 1: the bound is 10 s, not an instant timeout.
    const h = executorHarness({ reflexes: [reflex], timeScale: 0 });
    active.on = true;
    void h.runtime.reflexRunner.onTick(1);
    active.on = false;
    const submitted = h.executor.submit(thought({ actions: waits(1) }), planFor(1));
    await vi.advanceTimersByTimeAsync(9_999);
    expect(h.handlers.runs).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    const result = await submitted;
    expect(result.actions[0]?.record.state).toBe('completed');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('a reflex is still running'));
    reflex.release();
  });

  it('scales the bound with the time scale', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { active, reflex } = holdingReflex();
    const h = executorHarness({ reflexes: [reflex], timeScale: 0.1 });
    active.on = true;
    void h.runtime.reflexRunner.onTick(1);
    active.on = false;
    const submitted = h.executor.submit(thought({ actions: waits(1) }), planFor(1));
    await vi.advanceTimersByTimeAsync(999);
    expect(h.handlers.runs).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    await submitted;
    expect(h.handlers.runs).toEqual(['wait:1']);
    reflex.release();
  });
});
