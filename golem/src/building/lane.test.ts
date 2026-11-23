import type { Bot } from 'mineflayer';
import { describe, expect, it } from 'vitest';
import { type ActionOutcome, cancelled, completed, failed } from '../actions/outcome.ts';
import type { ActionContext, ActionHandler } from '../actions/registry.ts';
import { cancelForDeath } from '../body/death-cancel.ts';
import type { CellEnv, CellHandlers, PlanCell } from './cell-do.ts';
import { arrayCellSource } from './cell-source.ts';
import { createPlanLane, type LaneDeps, type LanePlan, PlanLane, SLICE_TICKS } from './lane.ts';
import { laneStateOf } from './lane-state.ts';
import type { HeldBlock } from './scaffold.ts';

/** A world and inventory. Ticks advance once per place, so a slice's length is observable. */
class World implements CellEnv {
  readonly grid = new Map<string, string>();
  items: HeldBlock[] = [{ name: 'stone', count: 64 }];
  names = ['stone_pickaxe'];
  ticks = 0;
  /** Each cell (by z) written by a completed place, in order: a double place shows as a repeat. */
  readonly writes: number[] = [];

  blockAt(at: { x: number; y: number; z: number }): string | null {
    return this.grid.get(`${at.x},${at.y},${at.z}`) ?? 'air';
  }

  propsAt(): Record<string, string> | null {
    return {};
  }

  held(): HeldBlock[] {
    return this.items;
  }

  heldNames(): string[] {
    return this.names;
  }
}

interface Act {
  block?: string;
  at: { x: number; y: number; z: number };
}

/** Builds a plan of `n` air-to-stone cells along z. */
function plan(n: number, cursor?: number): LanePlan {
  const cells: PlanCell[] = Array.from({ length: n }, (_, z) => ({
    at: { x: 0, y: 64, z },
    prior: 'air',
    target: 'stone',
  }));
  return {
    lifeId: 'life-1',
    planId: 'p1',
    chunks: 1,
    source: arrayCellSource(cells),
    total: n,
    ...(cursor === undefined ? {} : { cursor }),
  };
}

/** The place handler the test drives. `onCall` may take over one call (by z) to simulate a reflex. */
function placeHandler(
  world: World,
  onCall: (ctx: ActionContext, act: Act) => Promise<ActionOutcome | null> | ActionOutcome | null,
): ActionHandler<'place'> {
  return {
    kind: 'place',
    timeoutMs: 1000,
    run: async (ctx: ActionContext, action: Act) => {
      const taken = await onCall(ctx, action);
      if (taken !== null) return taken;
      world.grid.set(`${action.at.x},${action.at.y},${action.at.z}`, action.block ?? 'stone');
      world.writes.push(action.at.z);
      world.ticks++;
      return completed();
    },
  } as never;
}

function digHandler(): ActionHandler<'break'> {
  return { kind: 'break', timeoutMs: 1000, run: async () => completed() } as never;
}

const bot = {} as unknown as Bot;

function ctxWith(signal: AbortSignal): ActionContext {
  return { bot, signal, timeScale: 1 } as unknown as ActionContext;
}

function depsFor(world: World, place: ActionHandler<'place'>): LaneDeps {
  const handlers: CellHandlers = { place, dig: digHandler() };
  return { env: world, handlers, now: () => world.ticks };
}

/** Resolves when the signal fires (the stand-in for an action that runs until it is aborted). */
function untilAborted(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) =>
    signal.addEventListener('abort', () => resolve(), { once: true }),
  );
}

describe('plan lane', () => {
  it('is absent with the flag off and starts idle with it on', () => {
    expect(createPlanLane(false)).toBeNull();
    const lane = createPlanLane(true);
    expect(lane).toBeInstanceOf(PlanLane);
    expect(laneStateOf(lane as PlanLane)).toBe('idle');
  });

  it('runs cells in order and ends idle', async () => {
    const world = new World();
    const lane = new PlanLane();
    expect(lane.start(plan(3))).toBe(true);
    await lane.step(
      ctxWith(new AbortController().signal),
      depsFor(
        world,
        placeHandler(world, () => null),
      ),
    );
    expect(world.writes).toEqual([0, 1, 2]);
    expect(laneStateOf(lane)).toBe('idle');
    expect(lane.checkpointState()).toBeNull();
  });

  it('stops each slice when its ticks are spent and continues on the next', async () => {
    const world = new World();
    const lane = new PlanLane();
    const total = SLICE_TICKS + 2;
    lane.start(plan(total));
    const ctx = ctxWith(new AbortController().signal);
    const deps = depsFor(
      world,
      placeHandler(world, () => null),
    );
    await lane.step(ctx, deps);
    expect(world.writes).toHaveLength(SLICE_TICKS);
    expect(lane.checkpointState()?.cursor).toBe(SLICE_TICKS);
    expect(laneStateOf(lane)).toBe('running');
    await lane.step(ctx, deps);
    expect(world.writes).toEqual([0, 1, 2, 3, 4, 5]);
    expect(laneStateOf(lane)).toBe('idle');
  });

  it('refuses a second plan while one is active', async () => {
    const world = new World();
    const lane = new PlanLane();
    expect(lane.start(plan(2))).toBe(true);
    expect(lane.start({ ...plan(1), planId: 'p2' })).toBe(false);
    await lane.step(
      ctxWith(new AbortController().signal),
      depsFor(
        world,
        placeHandler(world, () => null),
      ),
    );
    expect(world.writes).toEqual([0, 1]);
    expect(lane.start({ ...plan(1), planId: 'p2' })).toBe(true);
  });

  it('a reflex mid-cell pauses the lane, and resume places each cell once', async () => {
    const world = new World();
    const lane = new PlanLane();
    lane.start(plan(3));
    const ctx = ctxWith(new AbortController().signal);
    let pausing: Promise<void> | null = null;
    let calls = 0;
    const place = placeHandler(world, async (c, act) => {
      if (act.at.z !== 1 || ++calls !== 1) return null;
      pausing = lane.pauseForReflex();
      await untilAborted(c.signal);
      return cancelled();
    });
    const deps = depsFor(world, place);
    await lane.step(ctx, deps);
    await pausing;
    expect(laneStateOf(lane)).toBe('paused');
    expect(lane.checkpointState()?.cursor).toBe(1);
    expect(world.writes).toEqual([0]);

    lane.resume();
    await lane.step(ctx, deps);
    expect(world.writes).toEqual([0, 1, 2]);
    expect(laneStateOf(lane)).toBe('idle');
  });

  it('a cell that landed before the pause is read as done, not placed again', async () => {
    const world = new World();
    const lane = new PlanLane();
    lane.start(plan(2));
    const ctx = ctxWith(new AbortController().signal);
    let pausing: Promise<void> | null = null;
    let calls = 0;
    const place = placeHandler(world, async (c, act) => {
      if (act.at.z !== 0 || ++calls !== 1) return null;
      world.grid.set('0,64,0', 'stone');
      world.writes.push(0);
      pausing = lane.pauseForReflex();
      await untilAborted(c.signal);
      return cancelled();
    });
    const deps = depsFor(world, place);
    await lane.step(ctx, deps);
    await pausing;
    lane.resume();
    await lane.step(ctx, deps);
    expect(world.writes).toEqual([0, 1]);
    expect(lane.checkpointState()).toBeNull();
  });

  it('a pause that lands as a cell completes keeps the lane paused and the cell is not placed twice', async () => {
    const world = new World();
    const lane = new PlanLane();
    lane.start(plan(3));
    const ctx = ctxWith(new AbortController().signal);
    let pausing: Promise<void> | null = null;
    let calls = 0;
    const place = placeHandler(world, async (c, act) => {
      if (act.at.z !== 1 || ++calls !== 1) return null;
      pausing = lane.pauseForReflex();
      await untilAborted(c.signal);
      world.grid.set('0,64,1', 'stone');
      world.writes.push(1);
      return completed();
    });
    const deps = depsFor(world, place);
    await lane.step(ctx, deps);
    await pausing;
    expect(laneStateOf(lane)).toBe('paused');
    expect(lane.checkpointState()?.cursor).toBe(1);

    lane.resume();
    await lane.step(ctx, deps);
    expect(world.writes).toEqual([0, 1, 2]);
    expect(laneStateOf(lane)).toBe('idle');
  });

  it('a pause with no plan is a no-op', async () => {
    const lane = new PlanLane();
    await lane.pauseForReflex();
    expect(laneStateOf(lane)).toBe('idle');
  });

  it('a death drops the plan, aborts the cell and nothing resumes', async () => {
    const world = new World();
    const lane = new PlanLane();
    lane.start(plan(3));
    const ctx = ctxWith(new AbortController().signal);
    let dying: Promise<void> | null = null;
    const place = placeHandler(world, async (c, act) => {
      if (act.at.z !== 1) return null;
      dying = cancelForDeath(lane, () => 7);
      await untilAborted(c.signal);
      return cancelled();
    });
    const deps = depsFor(world, place);
    await lane.step(ctx, deps);
    await dying;
    expect(laneStateOf(lane)).toBe('idle');
    expect(lane.checkpointState()).toBeNull();
    expect(world.writes).toEqual([0]);
    await lane.step(ctx, deps);
    expect(world.writes).toEqual([0]);
  });

  it('a runtime stop ends the slice and leaves the cursor for the next run', async () => {
    const world = new World();
    const lane = new PlanLane();
    lane.start(plan(2));
    const runtime = new AbortController();
    const place = placeHandler(world, async (c) => {
      runtime.abort();
      await untilAborted(c.signal);
      return cancelled();
    });
    await lane.step(ctxWith(runtime.signal), depsFor(world, place));
    expect(lane.checkpointState()).toMatchObject({ cursor: 0, skipped: [] });
    expect(laneStateOf(lane)).toBe('running');

    await lane.step(
      ctxWith(new AbortController().signal),
      depsFor(
        world,
        placeHandler(world, () => null),
      ),
    );
    expect(world.writes).toEqual([0, 1]);
  });

  it('a failed cell is recorded as skipped and the cursor moves on', async () => {
    const world = new World();
    const lane = new PlanLane();
    lane.start(plan(3));
    const place = placeHandler(world, (_c, act) =>
      act.at.z === 1 ? failed('blocked', 'something is in the way') : null,
    );
    await lane.step(ctxWith(new AbortController().signal), depsFor(world, place));
    expect(world.writes).toEqual([0, 2]);
    expect(lane.progress()).toEqual({
      counts: { placed: 2, blocked: 1 },
      skipped: [{ at: [0, 64, 1], code: 'blocked' }],
    });
    expect(laneStateOf(lane)).toBe('idle');
  });

  it('waits for materials without moving the cursor and resumes when they arrive', async () => {
    const world = new World();
    world.items = [];
    const lane = new PlanLane();
    lane.start(plan(2));
    const ctx = ctxWith(new AbortController().signal);
    const deps = depsFor(
      world,
      placeHandler(world, () => null),
    );
    await lane.step(ctx, deps);
    expect(laneStateOf(lane)).toBe('waiting_materials');
    expect(lane.checkpointState()?.cursor).toBe(0);
    expect(world.writes).toEqual([]);

    await lane.step(ctx, deps);
    expect(laneStateOf(lane)).toBe('waiting_materials');

    world.items = [{ name: 'stone', count: 64 }];
    await lane.step(ctx, deps);
    expect(world.writes).toEqual([0, 1]);
    expect(laneStateOf(lane)).toBe('idle');
  });

  it('a restart resumes at the checkpoint cursor and does not re-run earlier cells', async () => {
    const world = new World();
    const lane = new PlanLane();
    lane.start(plan(3, 2));
    await lane.step(
      ctxWith(new AbortController().signal),
      depsFor(
        world,
        placeHandler(world, () => null),
      ),
    );
    expect(world.writes).toEqual([2]);
    expect(laneStateOf(lane)).toBe('idle');
  });
});
