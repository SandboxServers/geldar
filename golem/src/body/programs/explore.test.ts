import type { Vec3 } from 'vec3';
import { describe, expect, it } from 'vitest';
import type { ProgramCheckpoint, ProgramContext, StepResult } from '../program.ts';
import { reportBlocked } from '../reflexes/blocked-path.ts';
import type { HostileView } from '../view.ts';
import { ProgramError } from './args.ts';
import { ExploreProgram } from './explore.ts';
import { contextFor, type FakeWorld, newWorld } from './programs.fakes.ts';

type Columns = (cx: number, cz: number) => object | null;
type Block = { name: string; boundingBox: 'block' | 'empty' };
type BlockAt = (at: Vec3) => Block | undefined;

const STONE: Block = { name: 'stone', boundingBox: 'block' };
const WATER: Block = { name: 'water', boundingBox: 'empty' };
const AIR: Block = { name: 'air', boundingBox: 'empty' };

const LAVA: Block = { name: 'lava', boundingBox: 'empty' };

/** Stone at the listed heights in every column, water (or `fluid`) at the listed heights, air elsewhere. */
function blocksAt(solid: number[], liquid: number[] = [], fluid: Block = WATER): BlockAt {
  return (at) => {
    if (solid.includes(at.y)) return STONE;
    if (liquid.includes(at.y)) return fluid;
    return AIR;
  };
}

/** Columns loaded exactly at the listed "cx,cz" keys. */
function loaded(keys: string[]): Columns {
  const set = new Set(keys);
  return (cx, cz) => (set.has(`${cx},${cz}`) ? {} : null);
}

const EVERY_COLUMN: Columns = () => ({});
const FOUR_AROUND_ORIGIN = ['0,0', '0,-1', '1,0', '0,1', '-1,0'];

function contextOver(
  columns: Columns,
  world: FakeWorld,
  signal?: AbortSignal,
  blockAt: BlockAt = () => undefined,
): ProgramContext {
  const ctx = contextFor(world, signal);
  Object.assign(ctx.bot, { world: { getColumn: columns }, blockAt });
  return ctx;
}

interface Run {
  last: StepResult;
  steps: number;
  world: FakeWorld;
  checkpoint: ProgramCheckpoint | null;
}

/**
 * Runs explore over the loaded columns, from `start(args)` or from `saved`. When `cut` is set the
 * run is interrupted at that step boundary (0 is right after start) through a JSON round trip.
 */
async function runOver(
  columns: Columns,
  world: FakeWorld,
  args: Record<string, unknown> = {},
  cut: number | null = null,
  saved?: ProgramCheckpoint,
  blockAt?: BlockAt,
): Promise<Run> {
  const ctx = contextOver(columns, world, undefined, blockAt);
  let program = new ExploreProgram();
  if (saved) await program.resume(saved, ctx);
  else await program.start(args, ctx);
  const interrupt = async (): Promise<void> => {
    const copy = JSON.parse(JSON.stringify(program.checkpoint()));
    program = new ExploreProgram();
    await program.resume(copy, ctx);
  };
  if (cut === 0) await interrupt();
  let last: StepResult = { status: 'running' };
  let steps = 0;
  while (last.status === 'running' && steps < 50) {
    last = await program.step(ctx);
    steps += 1;
    if (last.status === 'running' && steps === cut) await interrupt();
  }
  return { last, steps, world, checkpoint: program.checkpoint() };
}

/** A checkpoint at the origin chunk with the given visited chunks and heading. */
function atOrigin(
  visited: ReadonlyArray<readonly [number, number]>,
  heading: 'n' | 'e' | 's' | 'w' | null,
  legs = 6,
): ProgramCheckpoint {
  return {
    legs_done: 0,
    legs,
    leg_blocks: 24,
    avoid_water: true,
    chunks_new: 0,
    visited: visited.map(([x, z]) => [x, z]),
    heading,
  };
}

/** The goto targets the run made, parsed from the fake world's log. */
function gotoTargets(world: FakeWorld): Array<{ x: number; y: number; z: number }> {
  return world.log
    .filter((line) => line.startsWith('goto:'))
    .map((line) => JSON.parse(line.slice('goto:'.length)));
}

describe('ExploreProgram frontier', () => {
  it('only a loaded neighbour is a candidate', async () => {
    const run = await runOver(loaded(['0,0', '1,0']), newWorld(), { legs: 1 });
    expect(gotoTargets(run.world)).toEqual([{ x: 24, y: 64, z: 0 }]);
  });

  it('unloaded terrain is not a target', async () => {
    // North (the first heading with a null heading) is unloaded, so the leg goes south.
    const run = await runOver(loaded(['0,0', '0,1']), newWorld(), { legs: 1 });
    expect(gotoTargets(run.world)).toEqual([{ x: 0, y: 64, z: 24 }]);
  });

  it.each([
    ['n', [[0, 0]], { x: 0, y: 64, z: -24 }],
    ['e', [[0, 0]], { x: 24, y: 64, z: 0 }],
    ['s', [[0, 0]], { x: 0, y: 64, z: 24 }],
    ['w', [[0, 0]], { x: -24, y: 64, z: 0 }],
    [null, [[0, 0]], { x: 0, y: 64, z: -24 }],
    // Heading e: right is s, left is n, back is w.
    [
      'e',
      [
        [0, 0],
        [1, 0],
      ],
      { x: 0, y: 64, z: 24 },
    ],
    [
      'e',
      [
        [0, 0],
        [1, 0],
        [0, 1],
      ],
      { x: 0, y: 64, z: -24 },
    ],
    [
      'e',
      [
        [0, 0],
        [1, 0],
        [0, 1],
        [0, -1],
      ],
      { x: -24, y: 64, z: 0 },
    ],
  ] as const)('heading %s with visited %j goes to %j first', async (heading, visited, target) => {
    const saved = atOrigin([...visited], heading);
    const run = await runOver(EVERY_COLUMN, newWorld(), {}, null, saved);
    expect(gotoTargets(run.world)[0]).toEqual(target);
  });

  it('visited chunk is not the frontier', async () => {
    // North is already visited, so the first leg goes east, not north.
    const saved = atOrigin(
      [
        [0, 0],
        [0, -1],
      ],
      null,
    );
    const run = await runOver(EVERY_COLUMN, newWorld(), {}, null, saved);
    expect(gotoTargets(run.world)[0]).toEqual({ x: 24, y: 64, z: 0 });
  });

  it('no candidate completes no_frontier without a goto', async () => {
    const saved = atOrigin(
      [
        [0, 0],
        [0, -1],
        [1, 0],
        [0, 1],
        [-1, 0],
      ],
      null,
    );
    const run = await runOver(loaded(FOUR_AROUND_ORIGIN), newWorld(), {}, null, saved);
    expect(run.last).toEqual({
      status: 'completed',
      detail: { legs: 0, chunks_new: 0, stopped: 'no_frontier' },
    });
    expect(gotoTargets(run.world)).toEqual([]);
  });

  it('a duplicate arrival chunk adds nothing to visited', async () => {
    // The north leg lands on chunk (0,-2), which is already listed.
    const saved = atOrigin(
      [
        [0, 0],
        [0, -2],
      ],
      null,
      1,
    );
    const run = await runOver(EVERY_COLUMN, newWorld(), {}, null, saved);
    expect(run.checkpoint?.visited).toEqual([
      [0, 0],
      [0, -2],
    ]);
  });
});

describe('ExploreProgram stops and limits', () => {
  it('stops at legs', async () => {
    const run = await runOver(EVERY_COLUMN, newWorld(), { legs: 2 });
    expect(run.last).toEqual({
      status: 'completed',
      detail: { legs: 2, chunks_new: 2, stopped: 'legs' },
    });
    expect(gotoTargets(run.world)).toHaveLength(2);
  });

  it('every goto target is one leg_blocks step from the one before', async () => {
    const run = await runOver(EVERY_COLUMN, newWorld(), { legs: 4, leg_blocks: 16 });
    let from = { x: 0, z: 0 };
    for (const target of gotoTargets(run.world)) {
      expect(Math.abs(target.x - from.x) + Math.abs(target.z - from.z)).toBe(16);
      from = { x: target.x, z: target.z };
    }
    expect(gotoTargets(run.world)).toHaveLength(4);
  });

  it('the defaults are 6 legs of 24 blocks with avoid_water true', async () => {
    const run = await runOver(EVERY_COLUMN, newWorld(), {});
    expect(run.last).toMatchObject({ status: 'completed', detail: { legs: 6, stopped: 'legs' } });
    expect(gotoTargets(run.world)).toHaveLength(6);
    expect(run.checkpoint).toMatchObject({ legs: 6, leg_blocks: 24, avoid_water: true });
  });

  it('a hostile within 8 blocks stops with danger and no goto', async () => {
    const world = newWorld({ hostiles: [{ distance: 3 } as HostileView] });
    const run = await runOver(EVERY_COLUMN, world, { legs: 3 });
    expect(run.last).toEqual({
      status: 'completed',
      detail: { legs: 0, chunks_new: 0, stopped: 'danger' },
    });
    expect(gotoTargets(world)).toEqual([]);
  });

  it('health under 8 stops with danger', async () => {
    const run = await runOver(EVERY_COLUMN, newWorld({ health: 7 }), { legs: 3 });
    expect(run.last).toEqual({
      status: 'completed',
      detail: { legs: 0, chunks_new: 0, stopped: 'danger' },
    });
  });

  it('an aborted signal leaves the step running with no progress', async () => {
    const controller = new AbortController();
    controller.abort();
    const ctx = contextOver(EVERY_COLUMN, newWorld(), controller.signal);
    const program = new ExploreProgram();
    await program.start({ legs: 3 }, ctx);
    const result = await program.step(ctx);
    expect(result).toEqual({ status: 'running' });
    expect(program.checkpoint()?.legs_done).toBe(0);
  });

  it('rejects a leg count over 12 at start', async () => {
    const ctx = contextOver(EVERY_COLUMN, newWorld());
    await expect(new ExploreProgram().start({ legs: 13 }, ctx)).rejects.toThrow();
  });
});

describe('ExploreProgram resume', () => {
  it('a run cut at every boundary ends where the straight run ends', async () => {
    const straight = await runOver(EVERY_COLUMN, newWorld(), { legs: 3 });
    expect(straight.steps).toBeGreaterThan(1);
    for (let boundary = 0; boundary < straight.steps; boundary += 1) {
      const cut = await runOver(EVERY_COLUMN, newWorld(), { legs: 3 }, boundary);
      expect(cut.last, `cut after ${boundary}`).toEqual(straight.last);
      expect(cut.world, `cut after ${boundary}`).toEqual(straight.world);
    }
  });

  it('a checkpoint over 96 chunks stays under 2 KiB', async () => {
    const visited = Array.from({ length: 96 }, (_, i): [number, number] => [
      i % 10,
      Math.floor(i / 10),
    ]);
    const run = await runOver(EVERY_COLUMN, newWorld(), {}, null, atOrigin(visited, 'n'));
    const bytes = new TextEncoder().encode(JSON.stringify(run.checkpoint)).length;
    expect(bytes).toBeLessThan(2048);
  });

  it('rejects an unknown checkpoint field', async () => {
    const ctx = contextOver(EVERY_COLUMN, newWorld());
    const saved = { ...atOrigin([[0, 0]], null), extra: 1 };
    await expect(new ExploreProgram().resume(saved, ctx)).rejects.toThrow();
  });

  it('rejects 97 visited chunks', async () => {
    const ctx = contextOver(EVERY_COLUMN, newWorld());
    const visited = Array.from({ length: 97 }, (_, i): [number, number] => [i, 0]);
    await expect(new ExploreProgram().resume(atOrigin(visited, null), ctx)).rejects.toThrow();
  });

  it('accepts exactly 96 visited chunks', async () => {
    const ctx = contextOver(EVERY_COLUMN, newWorld());
    const visited = Array.from({ length: 96 }, (_, i): [number, number] => [i, 0]);
    await expect(
      new ExploreProgram().resume(atOrigin(visited, null), ctx),
    ).resolves.toBeUndefined();
  });
});

describe('ExploreProgram landing', () => {
  it('the landing is one above the highest solid block', async () => {
    const run = await runOver(
      EVERY_COLUMN,
      newWorld(),
      { legs: 1 },
      null,
      undefined,
      blocksAt([66, 70]),
    );
    expect(gotoTargets(run.world)).toEqual([{ x: 0, y: 71, z: -24 }]);
  });

  it('with no solid block in the scan the landing is the feet floor', async () => {
    const run = await runOver(EVERY_COLUMN, newWorld(), { legs: 1 }, null, undefined, blocksAt([]));
    expect(gotoTargets(run.world)).toEqual([{ x: 0, y: 64, z: -24 }]);
  });

  it('a leg into an unloaded column is pulled back into loaded terrain', async () => {
    // Chunk 3 (x 48) and chunk 2 (x 32 to 47) are unloaded, so the end moves back to x 31 in chunk 1.
    const run = await runOver(loaded(['0,0', '1,0']), newWorld(), { legs: 1, leg_blocks: 48 });
    expect(gotoTargets(run.world)).toEqual([{ x: 31, y: 64, z: 0 }]);
  });

  it('a south leg into an unloaded column is pulled back along z', async () => {
    // z 48 is chunk 3 and z 32 to 47 is chunk 2, both unloaded: the end steps back to z 31 in chunk 1.
    const run = await runOver(loaded(['0,0', '0,1']), newWorld(), { legs: 1, leg_blocks: 48 });
    expect(gotoTargets(run.world)).toEqual([{ x: 0, y: 64, z: 31 }]);
  });

  it('a north leg into an unloaded column is pulled back along z', async () => {
    // z -48 is chunk -3 and z -47 to -17 is chunk -2, both unloaded: the end steps back to z -16.
    const run = await runOver(loaded(['0,0', '0,-1']), newWorld(), { legs: 1, leg_blocks: 48 });
    expect(gotoTargets(run.world)).toEqual([{ x: 0, y: 64, z: -16 }]);
  });

  it('a west leg pulled back from a negative end uses floored chunks', async () => {
    // x -20 is chunk -2 and x -17 is chunk -2 too (floor, not trunc), so the end is x -16 in chunk -1.
    const run = await runOver(loaded(['0,0', '-1,0']), newWorld(), { legs: 1, leg_blocks: 20 });
    expect(gotoTargets(run.world)).toEqual([{ x: -16, y: 64, z: 0 }]);
  });

  it('a fractional position gives integer goto targets', async () => {
    const world = newWorld({ position: { x: 0.5, y: 64.5, z: 0.5 } });
    const run = await runOver(EVERY_COLUMN, world, { legs: 1 });
    expect(run.last.status).toBe('completed');
    expect(gotoTargets(world)).toEqual([{ x: 0, y: 64, z: -24 }]);
  });

  it('a fractional feet height scans from its floor', async () => {
    const world = newWorld({ position: { x: 0.5, y: 64.5, z: 0.5 } });
    await runOver(EVERY_COLUMN, world, { legs: 1 }, null, undefined, blocksAt([66]));
    expect(gotoTargets(world)).toEqual([{ x: 0, y: 67, z: -24 }]);
  });

  it('the landing height follows the column, so an x and z swap fails', async () => {
    // Stone at y 70 over column (0,-24) and at y 60 everywhere else.
    const heights: BlockAt = (at) =>
      at.y === (at.x === 0 && at.z === -24 ? 70 : 60) ? STONE : AIR;
    const north = await runOver(EVERY_COLUMN, newWorld(), { legs: 1 }, null, undefined, heights);
    expect(gotoTargets(north.world)).toEqual([{ x: 0, y: 71, z: -24 }]);
    const east = await runOver(
      EVERY_COLUMN,
      newWorld(),
      {},
      null,
      atOrigin([[0, 0]], 'e', 1),
      heights,
    );
    expect(gotoTargets(east.world)).toEqual([{ x: 24, y: 61, z: 0 }]);
  });

  it('a lava landing is skipped when avoid_water is true', async () => {
    const lava = Array.from({ length: 12 }, (_, i) => 61 + i);
    const run = await runOver(
      EVERY_COLUMN,
      newWorld(),
      { legs: 1 },
      null,
      undefined,
      blocksAt([60], lava, LAVA),
    );
    expect(run.last).toEqual({
      status: 'completed',
      detail: { legs: 0, chunks_new: 0, stopped: 'no_frontier' },
    });
    expect(gotoTargets(run.world)).toEqual([]);
  });

  it('water at the feet floor with no solid block is skipped when avoid_water is true', async () => {
    // Water from y 30 to 80 and no solid block: the feet cell at y 64 is water.
    const sea = Array.from({ length: 51 }, (_, i) => 30 + i);
    const run = await runOver(
      EVERY_COLUMN,
      newWorld(),
      { legs: 1 },
      null,
      undefined,
      blocksAt([], sea),
    );
    expect(run.last).toEqual({
      status: 'completed',
      detail: { legs: 0, chunks_new: 0, stopped: 'no_frontier' },
    });
    expect(gotoTargets(run.world)).toEqual([]);
  });

  it('water at the feet floor with no solid block is a target when avoid_water is false', async () => {
    const sea = Array.from({ length: 51 }, (_, i) => 30 + i);
    const run = await runOver(
      EVERY_COLUMN,
      newWorld(),
      { legs: 1, avoid_water: false },
      null,
      undefined,
      blocksAt([], sea),
    );
    expect(gotoTargets(run.world)).toEqual([{ x: 0, y: 64, z: -24 }]);
  });

  it('a water landing is skipped when avoid_water is true', async () => {
    // A lake over stone at y 60: every candidate lands in water, so nothing is a target.
    const lake = Array.from({ length: 12 }, (_, i) => 61 + i);
    const run = await runOver(
      EVERY_COLUMN,
      newWorld(),
      { legs: 1 },
      null,
      undefined,
      blocksAt([60], lake),
    );
    expect(run.last).toEqual({
      status: 'completed',
      detail: { legs: 0, chunks_new: 0, stopped: 'no_frontier' },
    });
    expect(gotoTargets(run.world)).toEqual([]);
  });

  it('a water landing is a target when avoid_water is false', async () => {
    const lake = Array.from({ length: 12 }, (_, i) => 61 + i);
    const run = await runOver(
      EVERY_COLUMN,
      newWorld(),
      { legs: 1, avoid_water: false },
      null,
      undefined,
      blocksAt([60], lake),
    );
    expect(gotoTargets(run.world)).toEqual([{ x: 0, y: 61, z: -24 }]);
  });

  it('a water candidate is passed over for the next dry one', async () => {
    // Water stands only north of the origin, so north (first with a null heading) is skipped for east.
    const northWater: BlockAt = (at) => {
      if (at.y === 60) return STONE;
      return at.z < 0 && at.y > 60 ? WATER : AIR;
    };
    const run = await runOver(EVERY_COLUMN, newWorld(), { legs: 1 }, null, undefined, northWater);
    expect(gotoTargets(run.world)).toEqual([{ x: 24, y: 61, z: 0 }]);
  });
});

describe('ExploreProgram limits in detail', () => {
  it('the oldest visited chunk drops when the 97th arrives', async () => {
    const visited = Array.from({ length: 96 }, (_, i): [number, number] => [i + 1, 0]);
    const run = await runOver(EVERY_COLUMN, newWorld(), {}, null, atOrigin(visited, null, 1));
    const list = (run.checkpoint?.visited ?? []) as Array<[number, number]>;
    expect(list).toHaveLength(96);
    expect(list[0]).toEqual([2, 0]);
    expect(list.at(-1)).toEqual([0, -2]);
  });

  it('the heading carries from one leg into the next', async () => {
    // North and the origin are visited, so the first leg goes east; the second goes east again.
    const saved = atOrigin(
      [
        [0, 0],
        [0, -1],
      ],
      null,
      2,
    );
    const run = await runOver(EVERY_COLUMN, newWorld(), {}, null, saved);
    expect(gotoTargets(run.world)).toEqual([
      { x: 24, y: 64, z: 0 },
      { x: 48, y: 64, z: 0 },
    ]);
  });

  it('health 8 is not danger', async () => {
    const run = await runOver(EVERY_COLUMN, newWorld({ health: 8 }), { legs: 1 });
    expect(gotoTargets(run.world)).toHaveLength(1);
  });

  it('a hostile 8 blocks away is danger', async () => {
    const world = newWorld({ hostiles: [{ distance: 8 } as HostileView] });
    const run = await runOver(EVERY_COLUMN, world, { legs: 3 });
    expect(run.last).toEqual({
      status: 'completed',
      detail: { legs: 0, chunks_new: 0, stopped: 'danger' },
    });
    expect(gotoTargets(world)).toEqual([]);
  });

  it('a hostile 9 blocks away is not danger', async () => {
    const world = newWorld({ hostiles: [{ distance: 9 } as HostileView] });
    const run = await runOver(EVERY_COLUMN, world, { legs: 1 });
    expect(gotoTargets(world)).toHaveLength(1);
    expect(run.last.status).toBe('completed');
  });

  it('a failed goto fails the step and counts no leg', async () => {
    const run = await runOver(EVERY_COLUMN, newWorld({ failing: { goto: 'timeout' } }), {
      legs: 2,
    });
    expect(run.last).toMatchObject({
      status: 'failed',
      message: expect.stringContaining('timeout'),
    });
    expect(run.checkpoint?.legs_done).toBe(0);
  });

  it('a blocked goto with no report fails the step', async () => {
    const run = await runOver(EVERY_COLUMN, newWorld({ failing: { goto: 'blocked' } }), {
      legs: 2,
    });
    expect(run.last).toMatchObject({
      status: 'failed',
      message: expect.stringContaining('blocked'),
    });
  });

  it('a blocked goto with a live report keeps the step running', async () => {
    const world = newWorld({ failing: { goto: 'blocked' } });
    const ctx = contextOver(EVERY_COLUMN, world);
    const program = new ExploreProgram();
    await program.start({ legs: 1 }, ctx);
    reportBlocked(ctx.view, {} as never);
    expect(await program.step(ctx)).toEqual({ status: 'running' });
    expect(program.checkpoint()?.legs_done).toBe(0);
  });
});

describe('ExploreProgram arguments', () => {
  it.each([
    [{ legs: 0 }],
    [{ legs: 13 }],
    [{ leg_blocks: 7 }],
    [{ leg_blocks: 49 }],
    [{ avoid_water: 'yes' }],
    [{ extra: 1 }],
    [null],
  ])('rejects %j at start', async (args) => {
    const ctx = contextOver(EVERY_COLUMN, newWorld());
    const error = await new ExploreProgram().start(args as never, ctx).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProgramError);
    expect((error as ProgramError).reason).toBe('invalid_args');
  });

  it.each([
    [{ legs: 1 }],
    [{ legs: 12 }],
    [{ leg_blocks: 8 }],
    [{ leg_blocks: 48 }],
    [{ avoid_water: false }],
  ])('accepts %j at start', async (args) => {
    const ctx = contextOver(EVERY_COLUMN, newWorld());
    await expect(new ExploreProgram().start(args, ctx)).resolves.toBeUndefined();
  });
});

describe('ExploreProgram chunks', () => {
  it('a negative position keeps chunk (-1,-1) and its frontier', async () => {
    // Chunk -1 is -1 / 16 floored, so the start is (-1,-1); the north leg ends at z -25, chunk -2.
    const world = newWorld({ position: { x: -1, y: 64, z: -1 } });
    const run = await runOver(EVERY_COLUMN, world, { legs: 1 });
    expect(run.checkpoint?.visited).toEqual([
      [-1, -1],
      [-1, -2],
    ]);
    expect(gotoTargets(world)).toEqual([{ x: -1, y: 64, z: -25 }]);
  });
});
