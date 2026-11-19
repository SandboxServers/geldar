import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { completed, failed } from '../../actions/outcome.ts';
import { isOwnPlacement } from '../../actions/own-placements.ts';
import { SEED_CROPS } from '../../actions/place.ts';
import { ownerRecordAt, prefetchOwners } from '../../actions/protected-blocks.ts';
import {
  type ActionContext,
  ActionRegistry,
  type ActionRun,
  runAction,
} from '../../actions/registry.ts';
import { canSeeBlock } from '../../perception/notable-blocks.ts';
import type { ProgramContext, StepResult } from '../program.ts';
import { MemorySink } from '../records.ts';
import type { BodyView } from '../view.ts';
import { FarmProgram } from './farm.ts';

vi.mock('../../actions/own-placements.ts', () => ({ isOwnPlacement: vi.fn(() => false) }));
vi.mock('../../actions/protected-blocks.ts', () => ({
  ownerRecordAt: vi.fn(() => null),
  prefetchOwners: vi.fn(async () => undefined),
}));
vi.mock('../../perception/notable-blocks.ts', () => ({ canSeeBlock: vi.fn(() => true) }));

interface Tile {
  name: string;
  age?: number | undefined;
}

/** The fake world: tiles keyed `x,y,z`, what the Body carries, and every action it ran. */
interface World {
  tiles: Map<string, Tile>;
  inventory: Record<string, number>;
  log: string[];
  feet: Vec3;
  failMine: boolean;
  failPlace: boolean;
  cancelNextMine: boolean;
  /** What a mine leaves at the block: air (broken), kept, age reset to 0, or unloaded. */
  afterMine: 'air' | 'keep' | 'reset' | 'unloaded';
}

function newWorld(): World {
  return {
    tiles: new Map(),
    inventory: {},
    log: [],
    feet: new Vec3(0, 64, 0),
    failMine: false,
    failPlace: false,
    cancelNextMine: false,
    afterMine: 'air',
  };
}

/** A crop at (x, y, z) on farmland one block below it. */
function crop(world: World, x: number, y: number, z: number, name: string, age?: number): void {
  world.tiles.set(`${x},${y - 1},${z}`, { name: 'farmland' });
  world.tiles.set(`${x},${y},${z}`, { name, age });
}

/** Empty farmland at (x, y, z): farmland below, air in the cell. */
function farmland(world: World, x: number, y: number, z: number): void {
  crop(world, x, y, z, 'air');
}

function readTile(world: World, pos: Vec3): ReturnType<Bot['blockAt']> {
  const tile = world.tiles.get(`${pos.x},${pos.y},${pos.z}`);
  if (!tile) return null;
  return {
    name: tile.name,
    position: pos,
    getProperties: () => ({ age: tile.age }),
  } as never;
}

/** The block a mine without a cell takes: the nearest mature block of that name. */
function nearest(world: World, name: string): string | undefined {
  const keys = [...world.tiles.keys()].filter((k) => {
    const tile = world.tiles.get(k);
    return tile?.name === name && (tile.age ?? 1) > 0;
  });
  const dist = (key: string) => {
    const [x, y, z] = key.split(',').map(Number) as [number, number, number];
    return new Vec3(x, y, z).distanceTo(world.feet);
  };
  const x = (key: string) => Number(key.split(',')[0]);
  return keys.sort((a, b) => dist(a) - dist(b) || x(a) - x(b))[0];
}

function registryFor(world: World): ActionRegistry {
  const registry = new ActionRegistry();
  registry.register({
    kind: 'mine',
    timeoutMs: 1000,
    run: async (ctx: ActionContext, action: { block: string }) => {
      if (world.failMine) return failed('not_possible', 'fake mine failure');
      const key = ctx.mineAt
        ? `${ctx.mineAt.x},${ctx.mineAt.y},${ctx.mineAt.z}`
        : nearest(world, action.block);
      const tile = key ? world.tiles.get(key) : undefined;
      if (!key || !tile || tile.name !== action.block) {
        return failed('not_found', 'that block is other');
      }
      world.log.push(`mine:${action.block}`);
      if (world.afterMine === 'air') world.tiles.set(key, { name: 'air' });
      if (world.afterMine === 'reset') world.tiles.set(key, { name: tile.name, age: 0 });
      if (world.afterMine === 'unloaded') world.tiles.delete(key);
      return completed({ mined: 1 });
    },
  } as never);
  registry.register({
    kind: 'place',
    timeoutMs: 1000,
    run: async (
      _ctx: unknown,
      action: { block: string; at: { x: number; y: number; z: number } },
    ) => {
      const { x, y, z } = action.at;
      if (world.failPlace) return failed('not_possible', 'fake place failure');
      const crop = SEED_CROPS.get(action.block);
      world.log.push(`place:${action.block}@${x},${y},${z}`);
      world.inventory[action.block] = (world.inventory[action.block] ?? 0) - 1;
      world.tiles.set(`${x},${y},${z}`, { name: crop as string, age: 0 });
      return completed();
    },
  } as never);
  return registry;
}

/** A program context over the fake world; a `cancelNextMine` world cancels the first mine. */
function contextFor(world: World): ProgramContext {
  const bot = {
    entity: { position: world.feet },
    blockAt: (pos: Vec3) => readTile(world, pos),
  } as unknown as Bot;
  const registry = registryFor(world);
  const view = {
    inventoryCount: (item: string) => world.inventory[item] ?? 0,
  } as unknown as BodyView;
  return {
    bot,
    view,
    registry,
    sink: new MemorySink(),
    lifeId: 'life-1',
    bodyGeneration: 1,
    timeScale: 1,
    runAction: async (action, signal, opts) => {
      if (world.cancelNextMine && action.do === 'mine') {
        world.cancelNextMine = false;
        return { state: 'cancelled', result: {} } as unknown as ActionRun;
      }
      return runAction(registry, bot, action, {
        signal,
        ...(opts?.mineAt ? { mineAt: opts.mineAt } : {}),
      });
    },
    signal: new AbortController().signal,
  };
}

interface Driven {
  last: StepResult;
  steps: number;
  program: FarmProgram;
}

/** Runs the program to its stop; `interruptAfter` restarts it from its checkpoint at that step. */
async function drive(
  world: World,
  args: Record<string, unknown>,
  interruptAfter: number | null = null,
): Promise<Driven> {
  const ctx = contextFor(world);
  let program = new FarmProgram();
  await program.start(args as never, ctx);
  const interrupt = async (): Promise<void> => {
    const saved = JSON.parse(JSON.stringify(program.checkpoint()));
    program = new FarmProgram();
    await program.resume(saved, ctx);
  };
  if (interruptAfter === 0) await interrupt();
  let steps = 0;
  let last: StepResult = { status: 'running' };
  while (last.status === 'running' && steps < 200) {
    last = await program.step(ctx);
    steps += 1;
    if (last.status === 'running' && steps === interruptAfter) await interrupt();
  }
  return { last, steps, program };
}

function snapshot(world: World) {
  return {
    log: world.log,
    inventory: world.inventory,
    tiles: [...world.tiles.entries()],
  };
}

function detailOf(last: StepResult): Record<string, unknown> {
  if (last.status !== 'completed') throw new Error(`not completed: ${last.status}`);
  return last.detail ?? {};
}

describe('farm', () => {
  /** Whether the owner cache has been prefetched: a cold cache answers unknown. */
  let warm = false;

  beforeEach(() => {
    warm = false;
    vi.mocked(prefetchOwners).mockReset();
    vi.mocked(prefetchOwners).mockImplementation(async () => undefined);
    vi.mocked(canSeeBlock).mockImplementation(() => true);
    vi.mocked(isOwnPlacement).mockImplementation(() => false);
    vi.mocked(ownerRecordAt).mockImplementation(() => ({ known: true, owner: null }));
  });

  it('harvests each ripe crop, then sows the farmland with a carried seed', async () => {
    const world = newWorld();
    crop(world, 1, 64, 0, 'wheat', 7);
    crop(world, -1, 64, 0, 'wheat', 7);
    world.inventory.wheat_seeds = 2;
    const run = await drive(world, {});
    expect(detailOf(run.last)).toEqual({
      harvested: 2,
      sown: 2,
      skipped_owned: 0,
      skipped_unknown: 0,
      stopped: 'done',
    });
    expect(world.log.filter((l) => l.startsWith('mine:'))).toHaveLength(2);
    expect(world.log.filter((l) => l.startsWith('place:'))).toHaveLength(2);
    expect(world.inventory.wheat_seeds).toBe(0);
  });

  it('leaves an unripe crop alone, even with a seed carried', async () => {
    const world = newWorld();
    crop(world, 1, 64, 0, 'wheat', 3);
    world.inventory.wheat_seeds = 1;
    const run = await drive(world, {});
    expect(detailOf(run.last)).toMatchObject({ harvested: 0, sown: 0 });
    expect(world.log).toEqual([]);
  });

  it('sows only a seed of the harvested crop, and ends no_seeds without one', async () => {
    const world = newWorld();
    crop(world, 1, 64, 0, 'beetroots', 7);
    world.inventory.wheat_seeds = 1;
    const run = await drive(world, {});
    expect(detailOf(run.last)).toMatchObject({ harvested: 1, sown: 0, stopped: 'no_seeds' });
    expect(world.log).toEqual(['mine:beetroots']);
  });

  it('prefers the harvested crop seed over another carried seed', async () => {
    const world = newWorld();
    crop(world, 1, 64, 0, 'beetroots', 7);
    world.inventory.wheat_seeds = 1;
    world.inventory.beetroot_seeds = 1;
    const run = await drive(world, {});
    expect(detailOf(run.last)).toMatchObject({ harvested: 1, sown: 1 });
    expect(world.log).toEqual(['mine:beetroots', 'place:beetroot_seeds@1,64,0']);
  });

  it('ends no_seeds when a sow is due and no seed is carried', async () => {
    const world = newWorld();
    farmland(world, 1, 64, 0);
    const run = await drive(world, {});
    expect(detailOf(run.last)).toMatchObject({ sown: 0, stopped: 'no_seeds' });
    expect(world.log).toEqual([]);
  });

  it('harvests without sowing when replant is off', async () => {
    const world = newWorld();
    crop(world, 1, 64, 0, 'wheat', 7);
    world.inventory.wheat_seeds = 1;
    const run = await drive(world, { replant: false });
    expect(detailOf(run.last)).toMatchObject({ harvested: 1, sown: 0, stopped: 'done' });
    expect(world.log).toEqual(['mine:wheat']);
  });

  it("skips another player's crop and counts it", async () => {
    const world = newWorld();
    crop(world, 1, 64, 0, 'wheat', 7);
    vi.mocked(ownerRecordAt).mockImplementation(() => ({ known: true, owner: 'other-player' }));
    const run = await drive(world, {});
    expect(detailOf(run.last)).toMatchObject({
      harvested: 0,
      skipped_owned: 1,
      skipped_unknown: 0,
    });
    expect(world.log).toEqual([]);
  });

  it('skips a cell of unknown ownership and counts it', async () => {
    const world = newWorld();
    crop(world, 1, 64, 0, 'wheat', 7);
    vi.mocked(ownerRecordAt).mockImplementation(() => ({ known: false }));
    const run = await drive(world, {});
    expect(detailOf(run.last)).toMatchObject({
      harvested: 0,
      skipped_owned: 0,
      skipped_unknown: 1,
    });
    expect(world.log).toEqual([]);
  });

  it("skips an empty cell whose farmland is another player's, and sows nothing", async () => {
    const world = newWorld();
    farmland(world, 1, 64, 0);
    world.inventory.wheat_seeds = 1;
    vi.mocked(ownerRecordAt).mockImplementation((pos) =>
      pos.y === 63 ? { known: true, owner: 'other-player' } : { known: true, owner: null },
    );
    const run = await drive(world, {});
    expect(detailOf(run.last)).toMatchObject({
      sown: 0,
      skipped_owned: 1,
      skipped_unknown: 0,
    });
    expect(world.log.filter((l) => l.startsWith('place:'))).toEqual([]);
  });

  it('skips an empty cell whose farmland is of unknown ownership, and sows nothing', async () => {
    const world = newWorld();
    farmland(world, 1, 64, 0);
    world.inventory.wheat_seeds = 1;
    vi.mocked(ownerRecordAt).mockImplementation((pos) =>
      pos.y === 63 ? { known: false } : { known: true, owner: null },
    );
    const run = await drive(world, {});
    expect(detailOf(run.last)).toMatchObject({
      sown: 0,
      skipped_owned: 0,
      skipped_unknown: 1,
    });
    expect(world.log.filter((l) => l.startsWith('place:'))).toEqual([]);
  });

  it('sows an empty cell whose air and farmland are both its own', async () => {
    const world = newWorld();
    farmland(world, 1, 64, 0);
    world.inventory.wheat_seeds = 1;
    const run = await drive(world, {});
    expect(detailOf(run.last)).toMatchObject({
      sown: 1,
      skipped_owned: 0,
      skipped_unknown: 0,
    });
    expect(world.log.filter((l) => l.startsWith('place:'))).toHaveLength(1);
  });

  it('harvests the Body own placement even when the record says another player', async () => {
    const world = newWorld();
    crop(world, 1, 64, 0, 'wheat', 7);
    vi.mocked(isOwnPlacement).mockImplementation(() => true);
    vi.mocked(ownerRecordAt).mockImplementation(() => ({ known: true, owner: 'other-player' }));
    const run = await drive(world, { replant: false });
    expect(detailOf(run.last)).toMatchObject({ harvested: 1 });
  });

  it('a failed mine fails the run and counts nothing', async () => {
    const world = newWorld();
    crop(world, 1, 64, 0, 'wheat', 7);
    world.inventory.wheat_seeds = 1;
    world.failMine = true;
    const run = await drive(world, {});
    expect(run.last.status).toBe('failed');
    expect(run.program.checkpoint()).toMatchObject({ harvested: 0, sown: 0 });
    expect(world.log.filter((l) => l.startsWith('place:'))).toEqual([]);
  });

  it('a cancelled mine leaves the cell for the next step', async () => {
    const world = newWorld();
    crop(world, 1, 64, 0, 'wheat', 7);
    world.inventory.wheat_seeds = 1;
    world.cancelNextMine = true;
    const run = await drive(world, {});
    expect(detailOf(run.last)).toMatchObject({ harvested: 1, sown: 1, stopped: 'done' });
    expect(world.log.filter((l) => l === 'mine:wheat')).toHaveLength(1);
  });

  it('stops at max_cells with the limit value', async () => {
    const world = newWorld();
    crop(world, 1, 64, 0, 'wheat', 7);
    crop(world, 2, 64, 0, 'wheat', 7);
    crop(world, 3, 64, 0, 'wheat', 7);
    const run = await drive(world, { max_cells: 2, replant: false });
    expect(detailOf(run.last)).toMatchObject({ harvested: 2, stopped: 'limit' });
  });

  it('a mine that leaves the crop in place counts no harvest', async () => {
    const world = newWorld();
    crop(world, 1, 64, 0, 'wheat', 7);
    world.afterMine = 'keep';
    const run = await drive(world, { replant: false });
    expect(detailOf(run.last)).toMatchObject({ harvested: 0, stopped: 'done' });
  });

  it('a mine that resets the crop age counts the harvest', async () => {
    const world = newWorld();
    crop(world, 1, 64, 0, 'wheat', 7);
    world.afterMine = 'reset';
    const run = await drive(world, { replant: false });
    expect(detailOf(run.last)).toMatchObject({ harvested: 1, stopped: 'done' });
  });

  it('a cell that reads unloaded after the mine counts no harvest', async () => {
    const world = newWorld();
    crop(world, 1, 64, 0, 'wheat', 7);
    world.afterMine = 'unloaded';
    const run = await drive(world, { replant: false });
    expect(detailOf(run.last)).toMatchObject({ harvested: 0, stopped: 'done' });
  });

  it('reads no empty cell when replant is off, so a ripe crop past them is reached', async () => {
    const world = newWorld();
    farmland(world, 1, 64, 0);
    farmland(world, -1, 64, 0);
    crop(world, 5, 64, 0, 'wheat', 7);
    const run = await drive(world, { replant: false, max_cells: 2 });
    expect(detailOf(run.last)).toMatchObject({ harvested: 1, stopped: 'done' });
  });

  it('a failed place fails the run and counts no sow', async () => {
    const world = newWorld();
    farmland(world, 1, 64, 0);
    world.inventory.wheat_seeds = 1;
    world.failPlace = true;
    const run = await drive(world, {});
    expect(run.last.status).toBe('failed');
    expect(run.program.checkpoint()).toMatchObject({ sown: 0 });
  });

  it('resumed at every boundary keeps the owner skip counts', async () => {
    const makeWorld = () => {
      const world = newWorld();
      crop(world, 1, 64, 0, 'wheat', 7);
      crop(world, -1, 64, 0, 'carrots', 7);
      crop(world, 0, 64, 2, 'potatoes', 7);
      crop(world, 0, 64, -2, 'beetroots', 7);
      world.inventory.wheat_seeds = 1;
      world.inventory.beetroot_seeds = 1;
      return world;
    };
    vi.mocked(ownerRecordAt).mockImplementation((pos) => {
      if (pos.x === -1) return { known: true, owner: 'other-player' };
      if (pos.z === 2) return { known: false };
      return { known: true, owner: null };
    });
    const straightWorld = makeWorld();
    const straight = await drive(straightWorld, {});
    expect(detailOf(straight.last)).toMatchObject({
      harvested: 2,
      sown: 2,
      skipped_owned: 1,
      skipped_unknown: 1,
      stopped: 'done',
    });
    for (let boundary = 0; boundary < straight.steps; boundary += 1) {
      const world = makeWorld();
      const cut = await drive(world, {}, boundary);
      expect(cut.last, `interrupted after ${boundary}`).toEqual(straight.last);
      expect(snapshot(world), `interrupted after ${boundary}`).toEqual(snapshot(straightWorld));
    }
  });

  it('resumed at every boundary keeps replant off and the max_cells limit', async () => {
    const makeWorld = () => {
      const world = newWorld();
      crop(world, 1, 64, 0, 'wheat', 7);
      crop(world, 2, 64, 0, 'wheat', 7);
      crop(world, 3, 64, 0, 'wheat', 7);
      world.inventory.wheat_seeds = 3;
      return world;
    };
    const args = { replant: false, max_cells: 2 };
    const straightWorld = makeWorld();
    const straight = await drive(straightWorld, args);
    expect(detailOf(straight.last)).toMatchObject({ harvested: 2, sown: 0, stopped: 'limit' });
    for (let boundary = 0; boundary < straight.steps; boundary += 1) {
      const world = makeWorld();
      const cut = await drive(world, args, boundary);
      expect(cut.last, `interrupted after ${boundary}`).toEqual(straight.last);
      expect(snapshot(world), `interrupted after ${boundary}`).toEqual(snapshot(straightWorld));
    }
  });

  it('reads nothing outside line of sight', async () => {
    const world = newWorld();
    crop(world, 1, 64, 0, 'wheat', 7);
    vi.mocked(canSeeBlock).mockImplementation(() => false);
    const run = await drive(world, {});
    expect(detailOf(run.last)).toMatchObject({ harvested: 0, stopped: 'no_cells' });
    expect(world.log).toEqual([]);
  });

  it('resumed at every step boundary, never harvests or sows twice', async () => {
    const makeWorld = () => {
      const world = newWorld();
      crop(world, 1, 64, 0, 'wheat', 7);
      crop(world, -1, 64, 0, 'wheat', 7);
      crop(world, 0, 64, 2, 'wheat', 3);
      world.inventory.wheat_seeds = 2;
      return world;
    };
    const straightWorld = makeWorld();
    const straight = await drive(straightWorld, {});
    expect(straight.last.status).toBe('completed');
    expect(straight.steps).toBeGreaterThan(1);
    for (let boundary = 0; boundary < straight.steps; boundary += 1) {
      const world = makeWorld();
      const cut = await drive(world, {}, boundary);
      expect(cut.last, `interrupted after ${boundary}`).toEqual(straight.last);
      expect(snapshot(world), `interrupted after ${boundary}`).toEqual(snapshot(straightWorld));
    }
  });

  it('rejects a radius outside 4 to 24 and a checkpoint with an unknown field', async () => {
    const ctx = contextFor(newWorld());
    await expect(new FarmProgram().start({ radius: 3 } as never, ctx)).rejects.toThrow();
    await expect(new FarmProgram().start({ radius: 25 } as never, ctx)).rejects.toThrow();
    await expect(new FarmProgram().start({ max_cells: 33 } as never, ctx)).rejects.toThrow();
    const saved = {
      replant: true,
      max_cells: 16,
      cells: [],
      next: 0,
      harvested: 0,
      sown: 0,
      skipped: 0,
      skipped_owned: 0,
      skipped_unknown: 0,
      extra: 1,
    };
    await expect(new FarmProgram().resume(saved, ctx)).rejects.toThrow();
  });

  it('digs only the targeted cell, never a nearer crop of another player', async () => {
    const world = newWorld();
    world.feet = new Vec3(-2, 64, 0);
    crop(world, 1, 64, 0, 'wheat', 7);
    crop(world, -1, 64, 0, 'wheat', 7);
    vi.mocked(ownerRecordAt).mockImplementation((pos) =>
      pos.x === -1 ? { known: true, owner: 'ag_other_01' } : { known: true, owner: null },
    );
    const run = await drive(world, { radius: 8, replant: false });
    expect(detailOf(run.last)).toMatchObject({ harvested: 1, skipped_owned: 1 });
    expect(world.tiles.get('1,64,0')).toEqual({ name: 'air' });
    expect(world.tiles.get('-1,64,0')).toEqual({ name: 'wheat', age: 7 });
    expect(world.log).toEqual(['mine:wheat']);
  });

  it('a cold owner cache does not skip the first cells as unknown', async () => {
    const world = newWorld();
    crop(world, 1, 64, 0, 'wheat', 7);
    crop(world, -1, 64, 0, 'wheat', 7);
    vi.mocked(prefetchOwners).mockImplementation(async () => {
      warm = true;
    });
    vi.mocked(ownerRecordAt).mockImplementation(() =>
      warm ? { known: true, owner: null } : { known: false },
    );
    const run = await drive(world, { replant: false });
    expect(detailOf(run.last)).toMatchObject({ harvested: 2, skipped_unknown: 0 });
    expect(vi.mocked(prefetchOwners).mock.calls[0]?.[0]).toHaveLength(2);
  });

  it('a cell still unknown after the prefetch is skipped and never dug', async () => {
    const world = newWorld();
    crop(world, 1, 64, 0, 'wheat', 7);
    crop(world, -1, 64, 0, 'wheat', 7);
    vi.mocked(ownerRecordAt).mockImplementation(() => ({ known: false }));
    const run = await drive(world, { replant: false });
    expect(detailOf(run.last)).toMatchObject({ harvested: 0, skipped_unknown: 2 });
    expect(world.log).toEqual([]);
  });

  it('a resume prefetches the owners before its first step', async () => {
    const world = newWorld();
    crop(world, 1, 64, 0, 'wheat', 7);
    crop(world, -1, 64, 0, 'wheat', 7);
    vi.mocked(prefetchOwners).mockImplementation(async () => {
      warm = true;
    });
    vi.mocked(ownerRecordAt).mockImplementation(() =>
      warm ? { known: true, owner: null } : { known: false },
    );
    const ctx = contextFor(world);
    const first = new FarmProgram();
    await first.start({ replant: false } as never, ctx);
    const saved = JSON.parse(JSON.stringify(first.checkpoint()));
    warm = false;
    vi.mocked(prefetchOwners).mockClear();
    const resumed = new FarmProgram();
    await resumed.resume(saved, ctx);
    let last: StepResult = { status: 'running' };
    for (let i = 0; i < 50 && last.status === 'running'; i += 1) {
      last = await resumed.step(ctx);
    }
    expect(vi.mocked(prefetchOwners)).toHaveBeenCalledTimes(1);
    expect(detailOf(last)).toMatchObject({ harvested: 2, skipped_unknown: 0 });
  });
});
