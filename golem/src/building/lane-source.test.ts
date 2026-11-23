import type { Bot } from 'mineflayer';
import { describe, expect, it } from 'vitest';
import { type ActionOutcome, cancelled, completed } from '../actions/outcome.ts';
import type { ActionContext } from '../actions/registry.ts';
import type { CellEnv, CellHandlers, PlanCell } from './cell-do.ts';
import { arrayCellSource, lazyCellSource } from './cell-source.ts';
import { contendFor } from './contention.ts';
import { type LaneDeps, type LanePlan, PlanLane, SLICE_TICKS } from './lane.ts';
import { PlanQueue } from './queue.ts';
import type { HeldBlock } from './scaffold.ts';
import { countPlanCells, createPlanExpand, createPlanSource } from './wire-expand.ts';

const FEET = { x: 10, y: 70, z: -4 };
const feet = () => FEET;
const palette = { s: { block: 'stone' }, p: { block: 'oak_planks' } };

const multiStep = [
  { op: 'box', pal: 's', from: { x: 0, y: 60, z: 0 }, to: { x: 4, y: 63, z: 4 } },
  { op: 'sphere', pal: 'p', center: { x: 2, y: 62, z: 2 }, radius: 3 },
  { op: 'box', break: true, from: { x: 0, y: 63, z: 0 }, to: { x: 1, y: 65, z: 1 } },
  { op: 'replace', pal: 's', at: { x: 2, y: 61, z: 2 } },
];

const FLAT = {
  op: 'box',
  pal: 's',
  from: { x: 0, y: 64, z: 0 },
  to: { x: 4, y: 64, z: 4 },
};
// The same box extended in z: it overlaps every cell the old plan placed, so a replace must skip them.
const EXTENDED = { ...FLAT, to: { x: 4, y: 64, z: 6 } };

interface Coords {
  x: number;
  y: number;
  z: number;
}

const keyOf = (at: Coords) => `${at.x},${at.y},${at.z}`;

/** A world that remembers what was placed; every cell reads air until it is. */
class World implements CellEnv {
  readonly grid = new Map<string, string>();
  ticks = 0;
  items: HeldBlock[] = [
    { name: 'stone', count: 1_000_000 },
    { name: 'oak_planks', count: 1_000_000 },
  ];

  blockAt(at: Coords): string | null {
    return this.grid.get(keyOf(at)) ?? 'air';
  }

  propsAt(): Record<string, string> | null {
    return {};
  }

  held(): HeldBlock[] {
    return this.items;
  }

  heldNames(): string[] {
    return ['stone_pickaxe'];
  }
}

/** What a run did: each cell's code in order and each place's cell key in order. */
interface Run {
  codes: string[];
  placed: string[];
  /** Asked before each place; a non-null outcome takes the place over. */
  onPlace?: (ctx: ActionContext, key: string) => Promise<ActionOutcome | null>;
}

function depsFor(world: World, run: Run): LaneDeps {
  const place = {
    kind: 'place',
    timeoutMs: 1000,
    run: async (ctx: ActionContext, action: { block?: string; at: Coords }) => {
      const key = keyOf(action.at);
      const taken = await run.onPlace?.(ctx, key);
      if (taken) return taken;
      run.placed.push(key);
      world.grid.set(key, action.block ?? 'stone');
      world.ticks++;
      return completed();
    },
  };
  const dig = { kind: 'break', timeoutMs: 1000, run: async () => completed() };
  const handlers = { place, dig } as unknown as CellHandlers;
  return {
    env: world,
    handlers,
    now: () => world.ticks,
    onCell: (code) => run.codes.push(code),
  };
}

const bot = {} as unknown as Bot;
const ctxOf = (): ActionContext =>
  ({ bot, signal: new AbortController().signal, timeScale: 1 }) as unknown as ActionContext;

function newRun(): Run {
  return { codes: [], placed: [] };
}

/** Steps the lane until it is idle; a lane that stays in another state fails with that state, not a hang. */
async function runToIdle(lane: PlanLane, deps: LaneDeps): Promise<void> {
  for (let i = 0; i < 2000 && lane.state !== 'idle'; i++) {
    await lane.step(ctxOf(), deps);
  }
  expect(lane.state).toBe('idle');
}

/** Resolves when the signal fires. */
function untilAborted(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) =>
    signal.addEventListener('abort', () => resolve(), { once: true }),
  );
}

describe('plan lane on a lazy source (B8-lazy)', () => {
  const cases = {
    box: { palette, steps: [multiStep[0]] },
    sphere: { palette, steps: [multiStep[1]] },
    overlapping: { palette, steps: multiStep },
  };

  for (const [name, body] of Object.entries(cases)) {
    it(`places the same cells in the same order from a lazy source as from an array: ${name}`, async () => {
      const eager = createPlanExpand(feet)(body);
      const total = await countPlanCells(createPlanSource(feet)(body));
      expect(total).toBe(eager.length);

      const eagerRun = newRun();
      const eagerWorld = new World();
      const eagerLane = new PlanLane();
      const eagerPlan: LanePlan = {
        lifeId: 'life-1',
        planId: 'p1',
        chunks: 1,
        source: arrayCellSource(eager),
        total: eager.length,
      };
      expect(eagerLane.start(eagerPlan)).toBe(true);
      await runToIdle(eagerLane, depsFor(eagerWorld, eagerRun));

      const lazyRun = newRun();
      const lazyWorld = new World();
      const lazyLane = new PlanLane();
      const lazyPlan: LanePlan = {
        lifeId: 'life-1',
        planId: 'p1',
        chunks: 1,
        source: createPlanSource(feet)(body),
        total,
      };
      expect(lazyLane.start(lazyPlan)).toBe(true);
      expect(lazyLane.snapshot()?.total).toBe(eager.length);
      await runToIdle(lazyLane, depsFor(lazyWorld, lazyRun));

      expect(lazyRun.codes).toHaveLength(eager.length);
      expect(lazyRun.codes).toEqual(eagerRun.codes);
      // `placed` holds only the place calls; break cells run the dig handler, so the eager run is the reference.
      expect(lazyRun.placed).toEqual(eagerRun.placed);
      expect(lazyRun.placed.length).toBeGreaterThan(0);
    });
  }

  it('a reflex pause keeps the cursor on a lazy source, and the resumed lane places each cell once', async () => {
    const body = { palette, steps: [multiStep[0]] };
    const eager = createPlanExpand(feet)(body);
    const run = newRun();
    const world = new World();
    const lane = new PlanLane();
    let paused = false;
    let pausing: Promise<void> | null = null;
    run.onPlace = async (ctx, key) => {
      if (paused || run.placed.length !== 5) return null;
      paused = true;
      expect(key).toBe(keyOf(eager[5]?.at ?? { x: -1, y: -1, z: -1 }));
      // The pause waits for the cell to end, so it is awaited after the step, not inside the cell.
      pausing = lane.pauseForReflex();
      await untilAborted(ctx.signal);
      return cancelled();
    };
    lane.start({
      lifeId: 'life-1',
      planId: 'p1',
      chunks: 1,
      source: createPlanSource(feet)(body),
      total: eager.length,
    });
    while (lane.state !== 'paused' && lane.state !== 'idle') {
      await lane.step(ctxOf(), depsFor(world, run));
    }
    await pausing;
    expect(lane.state).toBe('paused');
    expect(lane.checkpointState()?.cursor).toBe(5);
    lane.resume();
    while (lane.state !== 'idle') {
      await lane.step(ctxOf(), depsFor(world, run));
    }
    expect(run.placed).toEqual(eager.map((c) => keyOf(c.at)));
    expect(lane.snapshot()?.phase).toBe('completed');
  });

  it('keeps the same slice length on a lazy source (the lane is still tick-bound)', async () => {
    const body = { palette, steps: [multiStep[0]] };
    const run = newRun();
    const world = new World();
    const lane = new PlanLane();
    lane.start({
      lifeId: 'life-1',
      planId: 'p1',
      chunks: 1,
      source: createPlanSource(feet)(body),
      total: 25,
    });
    await lane.step(ctxOf(), depsFor(world, run));
    expect(run.placed).toHaveLength(SLICE_TICKS);
  });
});

describe('stand path on a lazy source (B8-lazy)', () => {
  it('scaffold removal breaks only the scaffold cells that sit on a plan cell, read from the lazy source', async () => {
    // Target (3,70,0) from feet (0,64,0) has no stand: the pillar is 0,64..69. Only (0,65,0) is a
    // plan cell (the second cell of the lazy source), so only that scaffold cell is broken.
    const world = new World();
    world.items = [
      { name: 'dirt', count: 10 },
      { name: 'stone', count: 1 },
    ];
    for (let x = -2; x <= 16; x++) {
      for (let z = -6; z <= 6; z++) world.grid.set(keyOf({ x, y: 63, z }), 'stone');
    }
    const cells: PlanCell[] = [
      { at: { x: 3, y: 70, z: 0 }, prior: 'air', target: 'stone' },
      { at: { x: 0, y: 65, z: 0 }, prior: 'air', target: 'stone' },
    ];
    const lazy = () => lazyCellSource(() => cells[Symbol.iterator]());
    const port = {
      feet: (): Coords => ({ x: 0, y: 64, z: 0 }),
      world: (x: number, y: number, z: number) => {
        const name = world.blockAt({ x, y, z }) ?? 'air';
        return { name, boundingBox: name === 'air' ? 'empty' : 'block' };
      },
    };
    const broken: string[] = [];
    const run = newRun();
    const base = depsFor(world, run);
    const dig = {
      kind: 'break',
      timeoutMs: 1000,
      run: async (_ctx: ActionContext, action: { at: Coords }) => {
        broken.push(keyOf(action.at));
        world.grid.set(keyOf(action.at), 'air');
        return completed();
      },
    };
    const handlers = { ...base.handlers, dig, stand: port } as unknown as CellHandlers;
    const deps: LaneDeps = { ...base, handlers };
    const lane = new PlanLane();
    expect(
      lane.start({
        lifeId: 'life',
        planId: 'stand',
        chunks: 1,
        source: lazy(),
        fresh: lazy,
        total: 2,
      }),
    ).toBe(true);
    await runToIdle(lane, deps);
    expect(broken).toEqual(['0,65,0']);
    expect(world.blockAt({ x: 0, y: 66, z: 0 })).toBe('dirt');
    expect(run.codes[0]).toBe('placed');
  });
});

describe('plan queue on a lazy source (B8-lazy): cancel and replace', () => {
  const addBody = (step: object) => ({ palette, steps: [step] });

  function queueFixture() {
    const lane = new PlanLane();
    const queue = new PlanQueue({
      lifeId: 'life-1',
      lane,
      contention: contendFor(lane),
      expand: createPlanSource(feet),
    });
    return { lane, queue };
  }

  async function drain(queue: PlanQueue, world: World, run: Run): Promise<void> {
    for (let i = 0; i < 10_000 && queue.depth() > 0; i++) {
      await queue.step(ctxOf(), depsFor(world, run));
    }
  }

  it('a replace of the active lazy plan places only the cells the old plan had not reached', async () => {
    const { queue } = queueFixture();
    const run = newRun();
    const world = new World();
    const oldEager = createPlanExpand(feet)(addBody(FLAT));
    const newEager = createPlanExpand(feet)(addBody(EXTENDED));
    const placedOld = oldEager.slice(0, SLICE_TICKS).map((c) => keyOf(c.at));
    const rest = newEager.filter((c) => !placedOld.includes(keyOf(c.at)));

    const added = await queue.submit({
      planId: 'p1',
      op: 'add',
      final: true,
      body: addBody(FLAT),
    });
    expect(added).toEqual({ kind: 'queued', cells: oldEager.length, position: 1 });
    await queue.step(ctxOf(), depsFor(world, run));
    expect(run.placed).toEqual(placedOld);

    const replaced = await queue.submit({
      planId: 'p1',
      op: 'replace',
      final: true,
      body: addBody(EXTENDED),
    });
    expect(replaced).toEqual({ kind: 'queued', cells: rest.length, position: 1 });
    await drain(queue, world, run);
    expect(run.placed).toEqual([...placedOld, ...rest.map((c) => keyOf(c.at))]);
  });

  it('a replace that does not expand is refused and the active lazy plan keeps running', async () => {
    const { queue } = queueFixture();
    const run = newRun();
    const world = new World();
    const oldEager = createPlanExpand(feet)(addBody(FLAT));

    await queue.submit({ planId: 'p1', op: 'add', final: true, body: addBody(FLAT) });
    await queue.step(ctxOf(), depsFor(world, run));
    const refused = await queue.submit({
      planId: 'p1',
      op: 'replace',
      final: true,
      body: { palette: {}, steps: [FLAT] },
    });
    expect(refused.kind).toBe('refused');
    await drain(queue, world, run);
    expect(run.placed).toEqual(oldEager.map((c) => keyOf(c.at)));
  });

  it('cancel drops the active lazy plan: the lane is idle and places nothing more', async () => {
    const { lane, queue } = queueFixture();
    const run = newRun();
    const world = new World();

    await queue.submit({ planId: 'p1', op: 'add', final: true, body: addBody(FLAT) });
    await queue.step(ctxOf(), depsFor(world, run));
    expect(run.placed).toHaveLength(SLICE_TICKS);
    expect(await queue.cancel('p1')).toBe(1);
    expect(lane.state).toBe('idle');
    await queue.step(ctxOf(), depsFor(world, run));
    expect(run.placed).toHaveLength(SLICE_TICKS);
    expect(queue.depth()).toBe(0);
  });
});
