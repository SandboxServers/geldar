import { describe, expect, it } from 'vitest';
import { completed } from '../actions/outcome.ts';
import type { ActionContext, ActionHandler } from '../actions/registry.ts';
import type { CellEnv, CellHandlers, PlanCell } from './cell-do.ts';
import { arrayCellSource } from './cell-source.ts';
import { type LaneDeps, type LanePlan, PlanLane } from './lane.ts';
import { TickThrottle } from './throttle.ts';

const env: CellEnv = {
  blockAt: () => 'stone',
  propsAt: () => ({}),
  held: () => [],
  heldNames: () => [],
};

const handler: ActionHandler<'place'> = {
  kind: 'place',
  timeoutMs: 1000,
  run: async () => completed(),
};

const handlers: CellHandlers = { place: handler, dig: { ...handler, kind: 'break' } as never };

function cells(n: number): PlanCell[] {
  return Array.from({ length: n }, (_, z) => ({
    at: { x: 0, y: 64, z },
    prior: 'stone',
    target: 'stone',
  }));
}

function plan(n: number, cursor?: number): LanePlan {
  return {
    lifeId: 'life',
    planId: 'p1',
    chunks: 1,
    source: arrayCellSource(cells(n)),
    total: n,
    ...(cursor === undefined ? {} : { cursor }),
  };
}

function ctxWith(signal: AbortSignal): ActionContext {
  return { bot: {} as never, signal, timeScale: 1 };
}

function deps(beforeCell?: LaneDeps['beforeCell'], now: () => number = () => 0): LaneDeps {
  return {
    env,
    handlers,
    now,
    ...(beforeCell === undefined ? {} : { beforeCell }),
  };
}

describe('lane throttle hook', () => {
  it('asks before every cell, in order', async () => {
    const lane = new PlanLane();
    lane.start(plan(3));
    const ticks: number[] = [];
    await lane.step(ctxWith(new AbortController().signal), {
      ...deps((now) => {
        ticks.push(now);
        return 'go';
      }),
    });
    expect(ticks).toHaveLength(3);
    expect(lane.state).toBe('idle');
  });

  it('cancels the cell and keeps the cursor when the throttle throws', async () => {
    const lane = new PlanLane();
    lane.start(plan(2));
    await lane.step(ctxWith(new AbortController().signal), {
      ...deps(() => {
        throw new Error('tps read failed');
      }),
    });
    expect(lane.checkpointState()?.cursor).toBe(0);
    expect(lane.checkpointState()?.counts).toEqual({});
    expect(lane.state).toBe('running');
  });

  it('runs no cell on a tps verdict: phase waiting_tps, cursor kept', async () => {
    const lane = new PlanLane();
    lane.start(plan(2));
    await lane.step(
      ctxWith(new AbortController().signal),
      deps(() => 'tps'),
    );
    expect(lane.state).toBe('waiting_tps');
    expect(lane.checkpointState()?.cursor).toBe(0);
    expect(lane.progress().counts).toEqual({});
  });

  it('with no hook the cells run as before', async () => {
    const lane = new PlanLane();
    lane.start(plan(2));
    await lane.step(ctxWith(new AbortController().signal), deps());
    expect(lane.checkpointState()).toBeNull();
    expect(lane.progress().counts).toEqual({ done_already: 2 });
  });
});

describe('lane throttle by ticks (fake clock)', () => {
  /** Steps the lane once per world tick from `from` to `to`, returning the cursor after each tick. */
  async function runTicks(
    lane: PlanLane,
    throttle: TickThrottle,
    from: number,
    to: number,
  ): Promise<number[]> {
    const done: number[] = [];
    for (let tick = from; tick <= to; tick++) {
      await lane.step(
        ctxWith(new AbortController().signal),
        deps(
          (now) => throttle.before(now),
          () => tick,
        ),
      );
      // Cells done so far: the counts, which keep the total after the plan ends.
      done.push(Object.values(lane.progress().counts).reduce((sum, n) => sum + n, 0));
    }
    return done;
  }

  it('at 20 TPS one cell per 4 ticks: the gap is counted in ticks', async () => {
    const lane = new PlanLane();
    lane.start(plan(3));
    const done = await runTicks(lane, new TickThrottle(() => 20), 0, 8);
    // Cell 1 at tick 0, cell 2 at tick 4, cell 3 at tick 8 (the plan ends there).
    expect(done).toEqual([1, 1, 1, 1, 2, 2, 2, 2, 3]);
  });

  it('at 15 TPS the gap doubles: one cell per 8 ticks', async () => {
    const lane = new PlanLane();
    lane.start(plan(3));
    const done = await runTicks(lane, new TickThrottle(() => 15), 0, 8);
    expect(done).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 2]);
  });

  it('below 12 TPS no cell runs, and the lane resumes on the tick TPS recovers', async () => {
    let tps = 8;
    const lane = new PlanLane();
    lane.start(plan(2));
    const throttle = new TickThrottle(() => tps);
    const first = await runTicks(lane, throttle, 0, 3);
    expect(first).toEqual([0, 0, 0, 0]);
    expect(lane.state).toBe('waiting_tps');
    tps = 20;
    const second = await runTicks(lane, throttle, 4, 4);
    expect(second).toEqual([1]);
    expect(lane.state).toBe('running');
  });
});

describe('restored plan counts', () => {
  it('keeps the saved counts and skipped cells when a plan starts from a cursor', () => {
    const lane = new PlanLane();
    lane.start(plan(4, 2), {
      counts: { placed: 2, missing_target: 1 },
      skipped: [{ at: [0, 64, 1], code: 'missing_target' }],
    });
    expect(lane.progress()).toEqual({
      counts: { placed: 2, missing_target: 1 },
      skipped: [{ at: [0, 64, 1], code: 'missing_target' }],
    });
    expect(lane.checkpointState()?.cursor).toBe(2);
  });

  it('a new plan starts with empty counts', () => {
    const lane = new PlanLane();
    lane.start(plan(2));
    expect(lane.progress()).toEqual({ counts: {}, skipped: [] });
  });
});
