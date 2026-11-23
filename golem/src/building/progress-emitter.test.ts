import { describe, expect, it, vi } from 'vitest';
import type { LaneSnapshot } from './lane.ts';
import { PROGRESS_EVERY_CELLS, PROGRESS_EVERY_MS } from './progress.ts';
import { PlanProgressEmitter } from './progress-emitter.ts';

function snap(
  done: number,
  phase: LaneSnapshot['phase'] = 'running',
  total = 100,
  planId = 'p1',
): LaneSnapshot {
  return { planId, total, phase, counts: done > 0 ? { placed: done } : {} };
}

function setup() {
  const clock = { now: 0 };
  const sink = { wake: vi.fn(), planProgress: vi.fn() };
  const emitter = new PlanProgressEmitter(sink, () => clock.now);
  return { clock, sink, emitter };
}

describe('PlanProgressEmitter cadence (BLD-38f2)', () => {
  it('sends nothing before any plan', () => {
    const { sink, emitter } = setup();
    emitter.observe(null, 1);
    expect(sink.planProgress).not.toHaveBeenCalled();
    expect(sink.wake).not.toHaveBeenCalled();
  });

  it('sends the first event at once, then none while nothing changes', () => {
    const { sink, emitter } = setup();
    emitter.observe(snap(0), 1);
    emitter.observe(snap(0), 2);
    expect(sink.planProgress).toHaveBeenCalledTimes(1);
    expect(sink.planProgress.mock.calls[0]?.[1]).toBe(1);
  });

  it(`sends an event after ${PROGRESS_EVERY_CELLS} cells, not before`, () => {
    const { sink, emitter } = setup();
    emitter.observe(snap(0), 1);
    emitter.observe(snap(PROGRESS_EVERY_CELLS - 1), 2);
    expect(sink.planProgress).toHaveBeenCalledTimes(1);
    emitter.observe(snap(PROGRESS_EVERY_CELLS), 3);
    expect(sink.planProgress).toHaveBeenCalledTimes(2);
    expect(sink.planProgress.mock.calls[1]?.[0]).toMatchObject({ done: PROGRESS_EVERY_CELLS });
  });

  it(`sends an event after ${PROGRESS_EVERY_MS} ms with no new cells, not before`, () => {
    const { clock, sink, emitter } = setup();
    emitter.observe(snap(0), 1);
    clock.now = PROGRESS_EVERY_MS - 1;
    emitter.observe(snap(0), 2);
    expect(sink.planProgress).toHaveBeenCalledTimes(1);
    clock.now = PROGRESS_EVERY_MS;
    emitter.observe(snap(0), 3);
    expect(sink.planProgress).toHaveBeenCalledTimes(2);
  });

  it('sends on a phase change: paused and waiting_tps', () => {
    const { sink, emitter } = setup();
    emitter.observe(snap(0, 'running'), 1);
    emitter.observe(snap(0, 'paused'), 2);
    emitter.observe(snap(0, 'waiting_tps'), 3);
    emitter.observe(snap(0, 'waiting_materials'), 4);
    expect(sink.planProgress.mock.calls.map((call) => call[0].phase)).toEqual([
      'running',
      'paused',
      'waiting_tps',
      'waiting_materials',
    ]);
  });

  it('restarts its count for a new plan', () => {
    const { sink, emitter } = setup();
    emitter.observe(snap(0, 'running', 100, 'p1'), 1);
    emitter.observe(snap(0, 'running', 50, 'p2'), 2);
    expect(sink.planProgress).toHaveBeenCalledTimes(2);
    expect(sink.planProgress.mock.calls[1]?.[0]).toMatchObject({ plan_id: 'p2', total: 50 });
  });

  it('a sink with no planProgress hook still gets the completion wake', () => {
    const wake = vi.fn();
    const emitter = new PlanProgressEmitter({ wake }, () => 0);
    emitter.observe(snap(2, 'completed', 2), 9);
    expect(wake).toHaveBeenCalledTimes(1);
  });
});

describe('PlanProgressEmitter completion (BLD-38f2)', () => {
  it('sends a completed event and one goal_completed wake with the counts', () => {
    const { sink, emitter } = setup();
    emitter.observe(snap(2, 'running', 2), 1);
    emitter.observe(snap(2, 'completed', 2), 2);
    expect(sink.planProgress.mock.calls.at(-1)?.[0]).toMatchObject({
      done: 2,
      total: 2,
      phase: 'completed',
    });
    expect(sink.wake).toHaveBeenCalledTimes(1);
    expect(sink.wake.mock.calls[0]?.[0]).toMatchObject({
      reason: 'goal_completed',
      tick: 2,
      intentId: null,
    });
    expect(sink.wake.mock.calls[0]?.[0].detail).toContain('2 of 2 cells done');
  });

  it('does not wake again for the same completed plan', () => {
    const { sink, emitter } = setup();
    emitter.observe(snap(2, 'completed', 2), 2);
    emitter.observe(snap(2, 'completed', 2), 3);
    emitter.observe(snap(2, 'completed', 2), 4);
    expect(sink.wake).toHaveBeenCalledTimes(1);
  });
});
