import { validateWakePayload } from '@geldar/contract';
import { describe, expect, it, vi } from 'vitest';
import { completed } from '../actions/outcome.ts';
import type { ActionContext, ActionHandler } from '../actions/registry.ts';
import type { CellEnv, CellHandlers, PlanCell } from './cell-do.ts';
import { arrayCellSource } from './cell-source.ts';
import { type LanePlan, PlanLane } from './lane.ts';
import { PLAN_WAKE_REASON } from './names.ts';
import { materialsWakeText } from './progress.ts';
import { PlanProgressEmitter } from './progress-emitter.ts';

/** A world with one empty cell and `stone` held: a place of stone finds it missing when `stone` is 0. */
function world(stone: number) {
  const state = { stone, block: 'air' };
  const env: CellEnv = {
    blockAt: () => state.block,
    propsAt: () => ({}),
    held: () => (state.stone > 0 ? [{ name: 'stone', count: state.stone }] : []),
    heldNames: () => (state.stone > 0 ? ['stone'] : []),
  };
  const place: ActionHandler<'place'> = {
    kind: 'place',
    timeoutMs: 1000,
    run: async () => {
      state.block = 'stone';
      state.stone--;
      return completed();
    },
  };
  const dig = { ...place, kind: 'break' } as unknown as CellHandlers['dig'];
  const handlers: CellHandlers = { place, dig };
  return { state, env, handlers };
}

function stoneCells(n: number): PlanCell[] {
  return Array.from({ length: n }, (_, z) => ({
    at: { x: 0, y: 64, z },
    prior: null,
    target: 'stone',
  }));
}

function plan(n: number): LanePlan {
  const cells = stoneCells(n);
  return { lifeId: 'life', planId: 'p1', chunks: 1, source: arrayCellSource(cells), total: n };
}

function ctx(): ActionContext {
  return { bot: {} as never, signal: new AbortController().signal, timeScale: 1 };
}

function stepWith(lane: PlanLane, w: ReturnType<typeof world>) {
  return lane.step(ctx(), { env: w.env, handlers: w.handlers, now: () => 0 });
}

describe('the lane materials shortfall (BLD-38f3)', () => {
  it('a missing item holds the cursor and names the block, the held count and the need', async () => {
    const lane = new PlanLane();
    const w = world(0);
    lane.start(plan(2));
    await stepWith(lane, w);
    expect(lane.state).toBe('waiting_materials');
    expect(lane.materialsShortfall()).toEqual({ block: 'stone', have: 0, need: 1 });
  });

  it('the shortfall is re-read on each slice with the count held then', async () => {
    const lane = new PlanLane();
    const w = world(0);
    lane.start(plan(2));
    await stepWith(lane, w);
    await stepWith(lane, w);
    expect(lane.materialsShortfall()).toEqual({ block: 'stone', have: 0, need: 1 });
    expect(w.state.stone).toBe(0);
  });

  it('the shortfall clears once the item arrives and the cell is placed', async () => {
    const lane = new PlanLane();
    const w = world(0);
    lane.start(plan(1));
    await stepWith(lane, w);
    expect(lane.materialsShortfall()).not.toBeNull();
    w.state.stone = 1;
    await stepWith(lane, w);
    expect(w.state.block).toBe('stone');
    expect(lane.state).toBe('idle');
    expect(lane.materialsShortfall()).toBeNull();
  });

  it('no shortfall with no plan, and none once the plan is failed', async () => {
    const lane = new PlanLane();
    expect(lane.materialsShortfall()).toBeNull();
    const w = world(0);
    lane.start(plan(2));
    await stepWith(lane, w);
    lane.fail();
    expect(lane.materialsShortfall()).toBeNull();
  });
});

describe('the lane failed phase (BLD-38f3)', () => {
  it('fail() ends the plan: the snapshot reads failed, and no cell runs after it', async () => {
    const lane = new PlanLane();
    const w = world(5);
    lane.start(plan(3));
    lane.fail();
    expect(lane.snapshot()?.phase).toBe('failed');
    expect(lane.state).toBe('idle');
    await stepWith(lane, w);
    expect(w.state.stone).toBe(5);
    expect(lane.checkpointState()).toBeNull();
  });

  it('fail() with no plan is a no-op: nothing to report', () => {
    const lane = new PlanLane();
    lane.fail();
    expect(lane.snapshot()).toBeNull();
  });

  it('a new plan clears the failed phase', () => {
    const lane = new PlanLane();
    lane.start(plan(1));
    lane.fail();
    expect(lane.start(plan(1))).toBe(true);
    expect(lane.snapshot()?.phase).toBe('running');
  });
});

describe('PlanProgressEmitter materials wake and failed event (BLD-38f3)', () => {
  function setup() {
    const sink = { wake: vi.fn(), planProgress: vi.fn() };
    const emitter = new PlanProgressEmitter(sink, () => 0);
    return { sink, emitter };
  }
  const shortfall = { block: 'stone', have: 0, need: 1 };
  const wakeOf = (tick: number) => ({
    reason: PLAN_WAKE_REASON,
    tick,
    intentId: null,
    detail: materialsWakeText('stone', 0, 1),
  });

  it('the materials wake passes the contract wake validator (review fix 1)', () => {
    const { sink, emitter } = setup();
    emitter.observeShortfall(shortfall, 7);
    const sent = sink.wake.mock.calls[0]?.[0];
    expect(sent).toBeDefined();
    const verdict = validateWakePayload({
      reason: sent?.reason,
      tick: sent?.tick,
      intent_id: null,
      detail: sent?.detail,
    });
    expect(verdict.ok).toBe(true);
  });

  it('wakes the Mind once per wait, through sink.wake, not once per slice', () => {
    const { sink, emitter } = setup();
    emitter.observeShortfall(shortfall, 1);
    emitter.observeShortfall(shortfall, 2);
    emitter.observeShortfall(shortfall, 3);
    expect(sink.wake).toHaveBeenCalledTimes(1);
    expect(sink.wake).toHaveBeenCalledWith(wakeOf(1));
  });

  it('a new wake after the shortfall clears and returns', () => {
    const { sink, emitter } = setup();
    emitter.observeShortfall(shortfall, 1);
    emitter.observeShortfall(null, 2);
    emitter.observeShortfall(shortfall, 3);
    expect(sink.wake).toHaveBeenCalledTimes(2);
    expect(sink.wake).toHaveBeenLastCalledWith(wakeOf(3));
  });

  it('no wake without a shortfall', () => {
    const { sink, emitter } = setup();
    emitter.observeShortfall(null, 1);
    expect(sink.wake).not.toHaveBeenCalled();
  });

  it('a failed plan sends one failed phase event and no completed wake', () => {
    const { sink, emitter } = setup();
    const failedSnap = { planId: 'p1', total: 10, phase: 'failed' as const, counts: { placed: 3 } };
    emitter.observe(failedSnap, 4);
    emitter.observe(failedSnap, 5);
    expect(sink.planProgress).toHaveBeenCalledTimes(1);
    expect(sink.planProgress.mock.calls[0]?.[0]).toMatchObject({ phase: 'failed', done: 3 });
    expect(sink.planProgress.mock.calls[0]?.[1]).toBe(4);
    expect(sink.wake).not.toHaveBeenCalled();
  });
});
