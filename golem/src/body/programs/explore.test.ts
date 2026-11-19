import { describe, expect, it } from 'vitest';
import type { ProgramCheckpoint, ProgramContext, StepResult } from '../program.ts';
import type { HostileView } from '../view.ts';
import { ExploreProgram } from './explore.ts';
import { contextFor, type FakeWorld, newWorld } from './programs.fakes.ts';

type Columns = (cx: number, cz: number) => object | null;

/** Columns loaded exactly at the listed "cx,cz" keys. */
function loaded(keys: string[]): Columns {
  const set = new Set(keys);
  return (cx, cz) => (set.has(`${cx},${cz}`) ? {} : null);
}

const EVERY_COLUMN: Columns = () => ({});
const FOUR_AROUND_ORIGIN = ['0,0', '0,-1', '1,0', '0,1', '-1,0'];

function contextOver(columns: Columns, world: FakeWorld, signal?: AbortSignal): ProgramContext {
  const ctx = contextFor(world, signal);
  Object.assign(ctx.bot, { world: { getColumn: columns } });
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
): Promise<Run> {
  const ctx = contextOver(columns, world);
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
