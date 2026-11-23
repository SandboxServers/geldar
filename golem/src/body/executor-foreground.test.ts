import { describe, expect, it, vi } from 'vitest';
import { arrayCellSource } from '../building/cell-source.ts';
import { contendFor } from '../building/contention.ts';
import { type LanePlan, PlanLane } from '../building/lane.ts';
import { executorHarness, planFor, scriptedProgram, thought } from './executor.fakes.ts';
import { IntentExecutor } from './executor.ts';

/** A lane that holds a plan at cursor 2, as a Body's lane does between cells. */
function laneAtCursor(): PlanLane {
  const lane = new PlanLane();
  const plan: LanePlan = {
    lifeId: 'ag_test_01',
    planId: 'p1',
    chunks: 1,
    source: arrayCellSource([]),
    total: 0,
    cursor: 2,
  };
  expect(lane.start(plan)).toBe(true);
  return lane;
}

/** The executor harness, with a real lane's contention in front of its intents (BLD-14). */
function foregroundHarness() {
  const h = executorHarness();
  const lane = laneAtCursor();
  const executor = new IntentExecutor({
    runtime: h.runtime,
    ticks: h.ticks.source,
    currentRevision: () => h.revision.current,
    wakeTap: h.tap,
    foreground: contendFor(lane),
  });
  return { ...h, executor, lane };
}

/** Lets queued microtasks and a zero timer run. */
function settle(): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

/** The steps the harness's scripted program has run. */
function stepsOf(h: { program: { current: unknown } }): number {
  return (h.program.current as ReturnType<typeof scriptedProgram>).log.steps;
}

/** A lane whose first pause waits until the test ends the in-flight cell. */
function slowLane() {
  let finishCell: () => void = () => undefined;
  const lane = {
    pauseForReflex: vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishCell = resolve;
        }),
    ),
    resume: vi.fn(),
  };
  return { lane, finishCell: () => finishCell() };
}

describe('the foreground hold comes before the intent runs (BLD-fix7a F4, F5)', () => {
  it('a tick during a slow hold runs no step, and the intent starts once the hold resolves', async () => {
    const h = executorHarness();
    const { lane, finishCell } = slowLane();
    const executor = new IntentExecutor({
      runtime: h.runtime,
      ticks: h.ticks.source,
      currentRevision: () => h.revision.current,
      wakeTap: h.tap,
      foreground: contendFor(lane),
    });
    executor.start();
    const submitting = executor.submit(thought({ intent: {} }), planFor(0, { n: 1 }));
    await vi.waitFor(() => expect(lane.pauseForReflex).toHaveBeenCalled());
    h.ticks.emit(1);
    await settle();
    expect(stepsOf(h)).toBe(0);
    finishCell();
    await submitting;
    expect(executor.intentState).toBe('running');
    await executor.stop();
  });

  it('a stop during the hold means the intent never runs, and the lane resumes once', async () => {
    const h = executorHarness();
    const { lane, finishCell } = slowLane();
    const executor = new IntentExecutor({
      runtime: h.runtime,
      ticks: h.ticks.source,
      currentRevision: () => h.revision.current,
      wakeTap: h.tap,
      foreground: contendFor(lane),
    });
    executor.start();
    const submitting = executor.submit(thought({ intent: {} }), planFor(0, { n: 1 }));
    await vi.waitFor(() => expect(lane.pauseForReflex).toHaveBeenCalled());
    const stopping = executor.stop();
    finishCell();
    await stopping;
    await submitting;
    h.ticks.emit(1);
    await settle();
    expect(stepsOf(h)).toBe(0);
    expect(executor.intentState).toBeNull();
    expect(lane.resume).toHaveBeenCalledTimes(1);
  });

  it('a death during the hold means the intent never runs, and the lane resumes once', async () => {
    const h = executorHarness();
    const { lane, finishCell } = slowLane();
    const executor = new IntentExecutor({
      runtime: h.runtime,
      ticks: h.ticks.source,
      currentRevision: () => h.revision.current,
      wakeTap: h.tap,
      foreground: contendFor(lane),
    });
    executor.start();
    const submitting = executor.submit(thought({ intent: {} }), planFor(0, { n: 1 }));
    await vi.waitFor(() => expect(lane.pauseForReflex).toHaveBeenCalled());
    const dying = executor.endForDeath(7);
    finishCell();
    await dying;
    await submitting;
    h.ticks.emit(1);
    await settle();
    expect(stepsOf(h)).toBe(0);
    expect(executor.intentState).toBeNull();
    expect(lane.resume).toHaveBeenCalledTimes(1);
  });

  it('replacing an intent does not resume the lane between the two intents', async () => {
    const h = executorHarness();
    const lane = { pauseForReflex: vi.fn(async () => undefined), resume: vi.fn() };
    const executor = new IntentExecutor({
      runtime: h.runtime,
      ticks: h.ticks.source,
      currentRevision: () => h.revision.current,
      wakeTap: h.tap,
      foreground: contendFor(lane),
    });
    executor.start();
    await executor.submit(thought({ intent: {} }), planFor(0, { n: 1 }));
    expect(executor.intentState).toBe('running');
    await executor.submit(thought({ intent: {} }), planFor(0, { n: 2 }));
    expect(executor.intentState).toBe('running');
    expect(lane.resume).not.toHaveBeenCalled();
    await executor.stop();
    expect(lane.resume).toHaveBeenCalledTimes(1);
  });
});

describe('a foreground intent holds the plan lane (BLD-14)', () => {
  it('pauses the lane while the intent is active and resumes it after, cursor kept', async () => {
    const h = foregroundHarness();
    h.executor.start();
    // The program is made at submit, so the one that completes is set before it.
    h.program.current = scriptedProgram([{ status: 'completed' }]);
    const submitted = await h.executor.submit(thought({ intent: {} }), planFor(0, { n: 1 }));
    expect(submitted.intent).toBe('started');
    expect(h.executor.intentState).toBe('running');
    expect(h.lane.snapshot()?.phase).toBe('paused');
    expect(h.lane.checkpointState()?.cursor).toBe(2);

    h.ticks.emit(1);
    // The ended intent is no longer the active one (intentState reads null).
    await vi.waitFor(() => expect(h.executor.intentId).toBeNull());
    expect(h.lane.snapshot()?.phase).toBe('running');
    expect(h.lane.checkpointState()?.cursor).toBe(2);
    await h.executor.stop();
  });

  it('a throw inside the intent releases the lane', async () => {
    const h = foregroundHarness();
    h.executor.start();
    h.program.current = {
      ...scriptedProgram([{ status: 'running' }]),
      step: async () => {
        throw new Error('boom in the program');
      },
    };
    await h.executor.submit(thought({ intent: {} }), planFor(0, { n: 1 }));
    expect(h.lane.snapshot()?.phase).toBe('paused');
    h.ticks.emit(1);
    await vi.waitFor(() => expect(h.executor.intentId).toBeNull());
    expect(h.sink.outcomes.at(-1)).toMatchObject({ intent: true, ok: false });
    expect(h.lane.snapshot()?.phase).toBe('running');
    expect(h.lane.checkpointState()?.cursor).toBe(2);
    await h.executor.stop();
  });

  it('a cancelled intent (stop) releases the lane', async () => {
    const h = foregroundHarness();
    await h.executor.submit(thought({ intent: {} }), planFor(0, { n: 1 }));
    expect(h.lane.snapshot()?.phase).toBe('paused');
    await h.executor.stop();
    expect(h.executor.intentState).toBeNull();
    expect(h.lane.snapshot()?.phase).toBe('running');
    expect(h.lane.checkpointState()?.cursor).toBe(2);
  });

  it('the Body death ends the intent and clears its hold', async () => {
    const h = foregroundHarness();
    await h.executor.submit(thought({ intent: {} }), planFor(0, { n: 1 }));
    expect(h.lane.snapshot()?.phase).toBe('paused');
    await h.executor.endForDeath(7);
    expect(h.executor.intentState).toBeNull();
    expect(h.lane.snapshot()?.phase).toBe('running');
    expect(h.lane.checkpointState()?.cursor).toBe(2);
  });

  it('an executor with no foreground gate runs an intent without touching a lane', async () => {
    const h = executorHarness();
    const submitted = await h.executor.submit(thought({ intent: {} }), planFor(0, { n: 1 }));
    expect(submitted.intent).toBe('started');
    expect(h.executor.intentState).toBe('running');
    await h.executor.stop();
  });
});
