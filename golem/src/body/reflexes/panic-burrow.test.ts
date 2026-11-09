import { Vec3 } from 'vec3';
import { describe, expect, it } from 'vitest';
import { ActionRegistry } from '../../actions/registry.ts';
import { allReflexesOn, ReflexRunner } from '../index.ts';
import { MemorySink } from '../records.ts';
import { panicBurrowReflex, pickSeal, planBurrow } from './panic-burrow.ts';
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
  const grid = gridBot(world, FEET);
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
    expect(world.cells.size).toBe(before);
    expect(view.enclosed).toBe(false);
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
