import type { Action } from '@geldar/contract';
import { Vec3 } from 'vec3';
import { describe, expect, it } from 'vitest';
import { type ActionContext, type ActionHandler, ActionRegistry } from '../../actions/registry.ts';
import { allReflexesOn, ReflexRunner } from '../index.ts';
import { MemorySink } from '../records.ts';
import { panicBurrowReflex, pickSeal, planBreakout, planBurrow } from './panic-burrow.ts';
import {
  GridWorld,
  gridBot,
  gridMine,
  gridPlace,
  reflexContext,
  settableView,
} from './reflexes.fakes.ts';

const FEET = new Vec3(0, 64, 0);

/** Grass floor under a stone wall that starts one block east of the bot. */
function wallWorld(): GridWorld {
  const world = new GridWorld();
  world.fill(new Vec3(-5, 63, -5), new Vec3(5, 63, 5), 'grass_block');
  world.fill(new Vec3(1, 64, -3), new Vec3(5, 67, 3), 'stone');
  return world;
}

function setup(world: GridWorld, drops?: Record<string, string>) {
  const grid = gridBot(world, FEET, drops);
  const registry = new ActionRegistry();
  registry.register(gridMine(world, grid, drops));
  registry.register(gridPlace(world, grid));
  const view = settableView(grid);
  return { grid, registry, view, ctx: reflexContext(grid.bot, view, registry) };
}

describe('panic burrow: planning', () => {
  it('finds a pocket in a solid wall', () => {
    const world = wallWorld();
    const plan = planBurrow((cell) => world.blockAt(cell) as never, FEET);
    expect(plan?.pocket.map((c) => c.toString())).toEqual(['(1, 64, 0)', '(1, 65, 0)']);
  });

  it('refuses on open ground', () => {
    const world = new GridWorld();
    world.fill(new Vec3(-5, 63, -5), new Vec3(5, 63, 5), 'grass_block');
    expect(planBurrow((cell) => world.blockAt(cell) as never, FEET)).toBeNull();
  });

  it('refuses a wall with a hole in its flank', () => {
    const world = wallWorld();
    world.set(new Vec3(1, 64, 1), null);
    expect(planBurrow((cell) => world.blockAt(cell) as never, FEET)).toBeNull();
  });

  it('refuses a falling wall', () => {
    const world = wallWorld();
    world.fill(new Vec3(1, 64, -3), new Vec3(5, 67, 3), 'gravel');
    expect(planBurrow((cell) => world.blockAt(cell) as never, FEET)).toBeNull();
  });

  it('picks the first seal block it carries', () => {
    expect(pickSeal((item) => (item === 'cobblestone' ? 2 : 0))).toBe('cobblestone');
    expect(pickSeal(() => 0)).toBeNull();
  });
});

describe('panic burrow: check', () => {
  it('fires only at night with no bed and no shelter', () => {
    const view = settableView();
    expect(panicBurrowReflex.check(view)).toBeNull();
    view.isNight = true;
    expect(panicBurrowReflex.check(view)).toMatchObject({ phase: 'night' });
    view.bedNearby = true;
    expect(panicBurrowReflex.check(view)).toBeNull();
    view.bedNearby = false;
    view.enclosed = true;
    expect(panicBurrowReflex.check(view)).toBeNull();
  });

  it('never fires on a view that has no night read', () => {
    const { isNight: _n, bedNearby: _b, enclosed: _e, ...bare } = settableView();
    expect(panicBurrowReflex.check(bare)).toBeNull();
  });
});

describe('panic burrow: run', () => {
  it('digs the pocket, seals the mouth, and leaves at dawn', async () => {
    const world = wallWorld();
    const { grid, view, ctx } = setup(world);
    grid.inventory.set('dirt', 4);
    view.isNight = true;
    const trigger = panicBurrowReflex.check(view);
    expect(trigger).not.toBeNull();

    const sealed = await panicBurrowReflex.run(trigger ?? {}, ctx);
    expect(sealed).toMatchObject({ result: 'handled', detail: 'sealed in' });
    expect(ctx.cancels).toBe(1);
    // The pocket is open, the mouth is closed behind the Body.
    expect(world.name(new Vec3(1, 64, 0))).toBe('air');
    expect(world.name(new Vec3(1, 65, 0))).toBe('air');
    expect(world.name(new Vec3(0, 64, 0))).toBe('dirt');
    expect(world.name(new Vec3(0, 65, 0))).toBe('dirt');
    expect(Math.floor(grid.bot.entity.position.x)).toBe(1);

    // Still night: nothing more to do. At dawn it opens up again.
    expect(panicBurrowReflex.check(view)).toBeNull();
    view.isNight = false;
    const dawn = panicBurrowReflex.check(view);
    expect(dawn).toEqual({ phase: 'dawn' });
    const left = await panicBurrowReflex.run(dawn ?? {}, ctx);
    expect(left).toMatchObject({ result: 'handled', detail: 'left at dawn' });
    expect(world.name(new Vec3(0, 64, 0))).toBe('air');
    expect(world.name(new Vec3(0, 65, 0))).toBe('air');
    expect(Math.floor(grid.bot.entity.position.x)).toBe(0);
    expect(panicBurrowReflex.check(view)).toBeNull();
  });

  it('refuses when no wall can hold a pocket, and digs nothing', async () => {
    const world = new GridWorld();
    world.fill(new Vec3(-5, 63, -5), new Vec3(5, 63, 5), 'grass_block');
    const { view, ctx } = setup(world);
    const before = world.cells.size;
    const outcome = await panicBurrowReflex.run({ phase: 'night' }, ctx);
    expect(outcome).toEqual({ result: 'abandoned', detail: 'no suitable block' });
    // Nothing to do, so the running action is left alone.
    expect(ctx.cancels).toBe(0);
    expect(world.cells.size).toBe(before);
    expect(view.enclosed).toBe(false);
  });

  it('digs exactly the pocket cells and leaves the flanks, floor and roof alone', async () => {
    // A stone floor under a stone wall: a dig by name could take a floor or flank block instead.
    const world = new GridWorld();
    world.fill(new Vec3(-5, 63, -5), new Vec3(5, 63, 5), 'stone');
    world.fill(new Vec3(1, 64, -3), new Vec3(5, 67, 3), 'stone');
    const { grid, ctx } = setup(world);
    grid.inventory.set('dirt', 4);
    const closed = planBurrow((cell) => world.blockAt(cell) as never, FEET)?.closed ?? [];
    expect(closed).toHaveLength(8);
    const stone = world.nearest('stone', FEET).length;

    const sealed = await panicBurrowReflex.run({ phase: 'night' }, ctx);
    expect(sealed).toMatchObject({ result: 'handled' });
    for (const cell of closed) expect(world.name(cell)).toBe('stone');
    // Two stone blocks became the pocket; the rest of the stone is where it was.
    expect(world.nearest('stone', FEET)).toHaveLength(stone - 2);
    expect(world.name(new Vec3(1, 64, 0))).toBe('air');
    expect(world.name(new Vec3(1, 65, 0))).toBe('air');

    // Leaving opens the two mouth cells and nothing else.
    ctx.cancels = 0;
    const left = await panicBurrowReflex.run({ phase: 'dawn' }, ctx);
    expect(left).toMatchObject({ result: 'handled', detail: 'left at dawn' });
    expect(world.nearest('stone', FEET)).toHaveLength(stone - 2);
  });

  it('leaves a dirt floor alone when it opens the dirt seal', async () => {
    const world = wallWorld();
    world.fill(new Vec3(-5, 63, -5), new Vec3(5, 63, 5), 'dirt');
    const { grid, ctx } = setup(world);
    grid.inventory.set('dirt', 4);
    await panicBurrowReflex.run({ phase: 'night' }, ctx);
    const dirt = world.nearest('dirt', FEET).length;
    await panicBurrowReflex.run({ phase: 'dawn' }, ctx);
    // Only the two mouth cells (dirt) are removed: the floor under the Body stays.
    expect(world.nearest('dirt', FEET)).toHaveLength(dirt - 2);
    expect(world.name(new Vec3(0, 63, 0))).toBe('dirt');
    expect(world.name(new Vec3(0, 64, 0))).toBe('air');
  });

  it('fails when a flank is breached while it waited, and digs nothing', async () => {
    const world = wallWorld();
    const { grid, ctx } = setup(world);
    grid.inventory.set('dirt', 4);
    ctx.cancelAction = async () => {
      ctx.cancels += 1;
      world.set(new Vec3(1, 64, 1), null);
    };
    const outcome = await panicBurrowReflex.run({ phase: 'night' }, ctx);
    expect(outcome).toEqual({ result: 'failed', detail: 'pocket wall breached' });
    expect(world.name(new Vec3(1, 64, 0))).toBe('stone');
    expect(world.name(new Vec3(1, 65, 0))).toBe('stone');
  });

  it('never digs a block outside the allowlist', async () => {
    const world = wallWorld();
    world.set(new Vec3(1, 64, 0), 'diamond_ore');
    const { ctx } = setup(world);
    const outcome = await panicBurrowReflex.run({ phase: 'night' }, ctx);
    // The plan refuses before the intent's action is cancelled: nothing to dig, nothing lost.
    expect(outcome).toEqual({ result: 'abandoned', detail: 'no suitable block' });
    expect(ctx.cancels).toBe(0);
    expect(world.name(new Vec3(1, 64, 0))).toBe('diamond_ore');
  });

  it('refuses a sandstone wall at the plan, without cancelling the action', async () => {
    const world = wallWorld();
    world.fill(new Vec3(1, 64, -3), new Vec3(5, 67, 3), 'sandstone');
    expect(planBurrow((cell) => world.blockAt(cell) as never, FEET)).toBeNull();
    const { ctx } = setup(world);
    const outcome = await panicBurrowReflex.run({ phase: 'night' }, ctx);
    expect(outcome).toMatchObject({ result: 'abandoned' });
    expect(ctx.cancels).toBe(0);
  });

  it('digs out toward the side that opens to the outside, not the first rock side', async () => {
    const world = new GridWorld();
    world.fill(new Vec3(-5, 62, -5), new Vec3(5, 67, 5), 'stone');
    world.set(new Vec3(0, 64, 0), null);
    world.set(new Vec3(0, 65, 0), null);
    // Outside lies beyond the west side only: the cells two steps west are open.
    world.set(new Vec3(-2, 64, 0), null);
    world.set(new Vec3(-2, 65, 0), null);
    const way = planBreakout((cell) => world.blockAt(cell) as never, FEET);
    expect(way?.map((c) => c.toString())).toEqual(['(-1, 64, 0)', '(-1, 65, 0)']);
    const { view, ctx } = setup(world);
    view.enclosed = true;
    view.isNight = false;
    const outcome = await panicBurrowReflex.run({ phase: 'dawn', orphan: true }, ctx);
    expect(outcome).toMatchObject({ result: 'handled' });
    expect(world.name(new Vec3(-1, 64, 0))).toBe('air');
    expect(world.name(new Vec3(1, 64, 0))).toBe('stone');
  });

  it('refuses a breakout cell that has water or lava next to it', () => {
    const world = new GridWorld();
    world.fill(new Vec3(-5, 62, -5), new Vec3(5, 67, 5), 'stone');
    world.set(new Vec3(0, 64, 0), null);
    world.set(new Vec3(0, 65, 0), null);
    // Open outside beyond east, but lava sits behind it: east is refused, west is taken.
    world.set(new Vec3(2, 64, 0), 'lava');
    const way = planBreakout((cell) => world.blockAt(cell) as never, FEET);
    expect(way?.[0].toString()).toBe('(-1, 64, 0)');
    for (const cell of [new Vec3(-2, 64, 0), new Vec3(0, 64, 2), new Vec3(0, 64, -2)]) {
      world.set(cell, 'water');
    }
    expect(planBreakout((cell) => world.blockAt(cell) as never, FEET)).toBeNull();
  });

  it('digs out at dawn when it is closed in and remembers no burrow', async () => {
    const world = new GridWorld();
    world.fill(new Vec3(-3, 62, -3), new Vec3(3, 67, 3), 'stone');
    world.set(new Vec3(0, 64, 0), null);
    world.set(new Vec3(0, 65, 0), null);
    const { view, ctx } = setup(world);
    view.enclosed = true;
    view.isNight = false;
    const trigger = panicBurrowReflex.check(view);
    expect(trigger).toEqual({ phase: 'dawn', orphan: true });
    const outcome = await panicBurrowReflex.run(trigger ?? {}, ctx);
    expect(outcome).toMatchObject({ result: 'handled', detail: 'dug out at dawn' });
    expect(world.name(new Vec3(1, 64, 0))).toBe('air');
    expect(world.name(new Vec3(1, 65, 0))).toBe('air');
    expect(Math.floor(ctx.bot.entity.position.x)).toBe(1);
  });

  it('does not dig out at night, or when it is not closed in', () => {
    const view = settableView();
    view.isNight = true;
    view.enclosed = true;
    expect(panicBurrowReflex.check(view)).toBeNull();
    view.isNight = false;
    view.enclosed = false;
    expect(panicBurrowReflex.check(view)).toBeNull();
  });
  it('runs the seal placements at the runtime time scale', async () => {
    const world = wallWorld();
    const grid = gridBot(world, FEET);
    grid.inventory.set('dirt', 4);
    const seen: number[] = [];
    const registry = new ActionRegistry();
    registry.register(gridMine(world, grid));
    const place: ActionHandler<'place'> = gridPlace(world, grid);
    registry.register({
      ...place,
      run: async (actx: ActionContext, action: Extract<Action, { do: 'place' }>) => {
        seen.push(actx.timeScale);
        return place.run(actx, action);
      },
    });
    const ctx = reflexContext(grid.bot, settableView(grid), registry);
    ctx.timeScale = 5;
    await panicBurrowReflex.run({ phase: 'night' }, ctx);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((scale) => scale === 5)).toBe(true);
  });

  it('fails when it has nothing to seal with', async () => {
    const world = wallWorld();
    // Stone drops a block that is no seal, so the Body has nothing to close the mouth with.
    const { ctx } = setup(world, { stone: 'coal' });
    const outcome = await panicBurrowReflex.run({ phase: 'night' }, ctx);
    expect(outcome).toEqual({ result: 'failed', detail: 'nothing to seal with' });
  });

  it('runs through the runner and writes one reflex_fired record', async () => {
    const world = wallWorld();
    const { grid, view, ctx } = setup(world);
    grid.inventory.set('dirt', 4);
    view.isNight = true;
    const sink = new MemorySink();
    const runner = new ReflexRunner({
      reflexes: [panicBurrowReflex],
      config: allReflexesOn(),
      view,
      sink,
      lifeId: 'ag_test_01',
      bodyGeneration: 1,
      context: () => ctx,
    });
    await runner.onTick(100);
    expect(sink.reflexes).toHaveLength(1);
    expect(sink.reflexes[0]).toMatchObject({
      name: 'panic_burrow',
      outcome: { result: 'handled' },
    });
    // Leave the shared burrow state clean for the next test.
    view.isNight = false;
    await runner.onTick(1000);
    expect(sink.reflexes).toHaveLength(2);
  });
});
