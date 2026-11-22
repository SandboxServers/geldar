import { describe, expect, it, vi } from 'vitest';
import { contendFor } from '../building/contention.ts';
import { type LanePlan, PlanLane } from '../building/lane.ts';
import { executorHarness, planFor, scriptedProgram, thought } from './executor.fakes.ts';
import { IntentExecutor } from './executor.ts';

/** A lane that holds a plan at cursor 2, as a Body's lane does between cells. */
function laneAtCursor(): PlanLane {
  const lane = new PlanLane();
  const plan: LanePlan = { lifeId: 'ag_test_01', planId: 'p1', chunks: 1, cells: [], cursor: 2 };
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
