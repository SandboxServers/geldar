import { describe, expect, it } from 'vitest';
import { type ActionOutcome, completed, failed } from '../actions/outcome.ts';
import type { ActionContext, ActionHandler } from '../actions/registry.ts';
import type { CellEnv, CellHandlers, PlanCell } from './cell-do.ts';
import { arrayCellSource } from './cell-source.ts';
import { type LaneDeps, type LanePlan, PlanLane } from './lane.ts';
import type { HeldBlock } from './scaffold.ts';

/** One cell whose fine outcome is `code`: the cell, the held tools and what the break handler returns. */
interface FineCase {
  code: string;
  /** The block at the cell when the agent reads it. */
  live: string;
  prior: string | null;
  target: string;
  tools: string[];
  dig: ActionOutcome;
}

/** Every fine outcome an out-of-view cell collapses (decision 0424 addendum, F12), plus the in-view cases. */
const FINE: FineCase[] = [
  {
    code: 'done_already',
    live: 'stone',
    prior: 'stone',
    target: 'stone',
    tools: ['wooden_pickaxe'],
    dig: completed(),
  },
  { code: 'changed', live: 'dirt', prior: 'air', target: 'stone', tools: [], dig: completed() },
  {
    code: 'blocked',
    live: 'stone',
    prior: 'stone',
    target: 'air',
    tools: ['wooden_pickaxe'],
    dig: completed(),
  },
  {
    code: 'unbreakable',
    live: 'stone',
    prior: 'stone',
    target: 'air',
    tools: ['wooden_pickaxe'],
    dig: failed('not_possible', 'bedrock'),
  },
  { code: 'no_tool', live: 'stone', prior: 'stone', target: 'air', tools: [], dig: completed() },
];

/** The view the lane's `inView` hook reads; a test flips it between plan and execution. */
interface View {
  inView: boolean;
}

const CELL_AT = { x: 0, y: 64, z: 0 };
const STONE_HELD: HeldBlock[] = [{ name: 'stone', count: 1 }];

function lanePlan(c: FineCase): LanePlan {
  const cell: PlanCell = { at: CELL_AT, prior: c.prior, target: c.target };
  return { lifeId: 'life', planId: 'p1', chunks: 1, source: arrayCellSource([cell]), total: 1 };
}

/** A one-cell world: the block at the cell stays `live` whatever the agent does (blocked, unbreakable). */
function depsFor(c: FineCase, view: View, held: HeldBlock[] = STONE_HELD): LaneDeps {
  const env: CellEnv = {
    blockAt: () => c.live,
    propsAt: () => ({}),
    held: () => held,
    heldNames: () => c.tools,
  };
  const place: ActionHandler<'place'> = {
    kind: 'place',
    timeoutMs: 1000,
    run: async () => completed(),
  };
  const dig: ActionHandler<'break'> = { kind: 'break', timeoutMs: 1000, run: async () => c.dig };
  const handlers: CellHandlers = { place, dig };
  return { env, handlers, now: () => 0, inView: () => view.inView };
}

function ctxSignal(): ActionContext {
  return { bot: {} as never, signal: new AbortController().signal, timeScale: 1 };
}

describe('out-of-view cells report one code (decision 0424 addendum, F12)', () => {
  it.each(FINE)('$code on an out-of-view cell reports only changed', async (c) => {
    const lane = new PlanLane();
    lane.start(lanePlan(c));
    await lane.step(ctxSignal(), depsFor(c, { inView: false }));
    expect(lane.progress().counts).toEqual({ changed: 1 });
    expect(lane.progress().skipped).toEqual([{ at: [0, 64, 0], code: 'changed' }]);
  });

  it.each(FINE)('$code on an in-view cell keeps its detailed code', async (c) => {
    const lane = new PlanLane();
    lane.start(lanePlan(c));
    await lane.step(ctxSignal(), depsFor(c, { inView: true }));
    expect(lane.progress().counts).toEqual({ [c.code]: 1 });
  });

  it('reads the view at execution: out of view at plan time, in view when run keeps the detail', async () => {
    const c = FINE[0] as FineCase;
    const view: View = { inView: false };
    const lane = new PlanLane();
    lane.start(lanePlan(c));
    view.inView = true;
    await lane.step(ctxSignal(), depsFor(c, view));
    expect(lane.progress().counts).toEqual({ done_already: 1 });
  });

  it('reads the view at execution: in view at plan time, out of view when run collapses', async () => {
    const c = FINE[0] as FineCase;
    const view: View = { inView: true };
    const lane = new PlanLane();
    lane.start(lanePlan(c));
    view.inView = false;
    await lane.step(ctxSignal(), depsFor(c, view));
    expect(lane.progress().counts).toEqual({ changed: 1 });
  });

  it('a materials wait on an out-of-view cell still holds the cursor and counts nothing', async () => {
    // The cell holds the planned prior stone, the target glass is not held: missing_materials.
    const c: FineCase = {
      code: 'missing',
      live: 'stone',
      prior: 'stone',
      target: 'glass',
      tools: [],
      dig: completed(),
    };
    const lane = new PlanLane();
    lane.start(lanePlan(c));
    await lane.step(ctxSignal(), depsFor(c, { inView: false }, []));
    expect(lane.state).toBe('waiting_materials');
    expect(lane.checkpointState()?.cursor).toBe(0);
    expect(lane.progress().counts).toEqual({});
  });
});
