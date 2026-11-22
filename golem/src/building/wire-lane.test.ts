import type { Bot } from 'mineflayer';
import { describe, expect, it, vi } from 'vitest';
import type { ActionContext } from '../actions/registry.ts';
import type { BodyRuntime } from '../body/runtime.ts';
import type { GolemMetrics } from '../metrics.ts';
import type { PlanCell } from './cell-do.ts';
import { cellEnvOf, cellHandlersOf, createLaneWiring } from './wire-lane.ts';

/** A bot whose block at any cell has the name and properties given (or no block when `block` is null). */
function botWith(block: { name: string; props: Record<string, unknown> } | null): Bot {
  const found = block === null ? null : { name: block.name, getProperties: () => block.props };
  return { blockAt: () => found, inventory: { items: () => [] } } as unknown as Bot;
}

describe('cellEnvOf (BLD-38b2)', () => {
  it('reads the state properties of the live block, each as a string', () => {
    const env = cellEnvOf(
      botWith({ name: 'oak_stairs', props: { facing: 'north', waterlogged: false } }),
    );
    expect(env.propsAt({ x: 0, y: 64, z: 0 })).toEqual({ facing: 'north', waterlogged: 'false' });
    expect(env.blockAt({ x: 0, y: 64, z: 0 })).toBe('oak_stairs');
  });

  it('reads no properties (null) where the chunk is not loaded', () => {
    expect(cellEnvOf(botWith(null)).propsAt({ x: 0, y: 64, z: 0 })).toBeNull();
  });
});

describe('cellHandlersOf (BLD-38b2)', () => {
  it('hands a place the block state it asks for to the runtime', async () => {
    const runAction = vi.fn(async (_action: unknown, _signal: unknown, _opts: unknown) => ({
      result: { status: 'completed' },
    }));
    const runtime = { actions: { get: () => undefined }, runAction } as unknown as BodyRuntime;
    const handlers = cellHandlersOf(runtime);
    const ctx = {
      bot: {},
      signal: new AbortController().signal,
      timeScale: 1,
      placeState: { facing: 'north' },
    } as unknown as ActionContext;
    const outcome = await handlers.place.run(ctx, {
      do: 'place',
      block: 'oak_stairs',
      at: { x: 0, y: 64, z: 0 },
    });
    expect(outcome.status).toBe('completed');
    expect(runAction.mock.calls[0]?.[2]).toEqual({ placeState: { facing: 'north' } });
  });

  it('passes no state option for a place that asks for none', async () => {
    const runAction = vi.fn(async (_action: unknown, _signal: unknown, _opts: unknown) => ({
      result: { status: 'completed' },
    }));
    const runtime = { actions: { get: () => undefined }, runAction } as unknown as BodyRuntime;
    const ctx = {
      bot: {},
      signal: new AbortController().signal,
      timeScale: 1,
    } as unknown as ActionContext;
    await cellHandlersOf(runtime).place.run(ctx, {
      do: 'place',
      block: 'stone',
      at: { x: 0, y: 64, z: 0 },
    });
    expect(runAction.mock.calls[0]?.[2]).toEqual({});
  });
});

/** One cell that is already the target block: the cell reads done without an action. */
const DONE_CELL: PlanCell = { at: { x: 0, y: 64, z: 0 }, prior: 'stone', target: 'stone' };

/** A bot whose every block is stone (the cell's target), with an empty inventory. */
const STONE_BOT = {
  blockAt: () => ({ name: 'stone', getProperties: () => ({}) }),
  inventory: { items: () => [] },
} as unknown as Bot;

describe('createLaneWiring plan metrics (BLD-fix1c D)', () => {
  it('counts each plan cell by its outcome and reports the queue depth after a tick', async () => {
    const planCell = vi.fn();
    const planQueueDepth = vi.fn();
    const metrics = { planCell, planQueueDepth, planThrottleWait: vi.fn(), planSeconds: vi.fn() };
    const runtime = {
      sink: { wake: vi.fn(), planProgress: vi.fn() },
      timeScale: 1,
      actions: { get: () => undefined },
      view: { tick: 0 },
    } as unknown as BodyRuntime;
    const wiring = createLaneWiring({
      lifeId: 'ag_test_01',
      bot: STONE_BOT,
      runtime,
      expand: () => [],
      metrics: metrics as unknown as GolemMetrics,
    });
    wiring.lane.start({ planId: 'p-metrics', cells: [DONE_CELL] } as never);
    await wiring.onTick(1, false);
    expect(planCell).toHaveBeenCalledWith('done_already');
    expect(planQueueDepth).toHaveBeenLastCalledWith(0);
  });
});

describe('createLaneWiring unexpected throw (BLD-fix1c E)', () => {
  it('fails the plan once with a failed progress event, then rethrows the error', async () => {
    const planProgress = vi.fn();
    // Reading the view throws inside the queue step, as an unexpected fault would.
    const runtime = {
      sink: { wake: vi.fn(), planProgress },
      timeScale: 1,
      actions: { get: () => undefined },
      get view(): { tick?: number } {
        throw new Error('view unreadable');
      },
    } as unknown as BodyRuntime;
    const wiring = createLaneWiring({
      lifeId: 'ag_test_01',
      bot: STONE_BOT,
      runtime,
      expand: () => [],
    });
    wiring.lane.start({ planId: 'p-throw', cells: [DONE_CELL] } as never);
    await expect(wiring.onTick(7, false)).rejects.toThrow('view unreadable');
    expect(wiring.lane.snapshot()?.phase).toBe('failed');
    const failedEvents = planProgress.mock.calls.filter((call) => call[0]?.phase === 'failed');
    expect(failedEvents).toHaveLength(1);
  });
});
