import { describe, expect, it } from 'vitest';
import { blueprintCells } from '../../actions/build/blueprints.ts';
import { completed, failed } from '../../actions/outcome.ts';
import { ActionRegistry, runAction } from '../../actions/registry.ts';
import { fakeBot } from '../body.fakes.ts';
import type { ProgramContext, StepResult } from '../program.ts';
import { MemorySink } from '../records.ts';
import { BuildProgram } from './build.ts';

interface BuildWorld {
  position: { x: number; y: number; z: number };
  inventory: Record<string, number>;
  placed: Map<string, string>;
  log: string[];
  /** Refusals left per cell key: `blocked` while the count is above zero. */
  refusals: Map<string, number>;
}

const key = (p: { x: number; y: number; z: number }): string => `${p.x},${p.y},${p.z}`;

function makeWorld(count: number): BuildWorld {
  return {
    position: { x: 10, y: 64, z: 10 },
    inventory: { cobblestone: count },
    placed: new Map(),
    log: [],
    refusals: new Map(),
  };
}

/** The key of a shelter cell, given the body starts at (10, 64, 10). */
function cellKey(index: number): string {
  const cell = blueprintCells('shelter')[index];
  if (!cell) throw new Error(`no shelter cell ${index}`);
  return key({ x: 10 + cell.dx, y: 64 + cell.dy, z: 10 + cell.dz });
}

/** A context whose place and goto handlers change a block map instead of a server. */
function context(world: BuildWorld, signal = new AbortController().signal): ProgramContext {
  const registry = new ActionRegistry();
  registry.register({
    kind: 'place',
    timeoutMs: 1000,
    run: async (_ctx, action) => {
      const k = key(action.at as never);
      world.log.push(`place:${k}`);
      const refusals = world.refusals.get(k) ?? 0;
      if (refusals > 0) {
        world.refusals.set(k, refusals - 1);
        return failed('blocked', 'the server refused');
      }
      if (world.placed.has(k)) return failed('blocked', 'target is occupied');
      if ((world.inventory[action.block] ?? 0) < 1) return failed('missing_materials', 'none');
      world.inventory[action.block] = (world.inventory[action.block] ?? 0) - 1;
      world.placed.set(k, action.block);
      return completed();
    },
  });
  registry.register({
    kind: 'goto',
    timeoutMs: 1000,
    run: async (_ctx, action) => {
      world.log.push(`goto:${key(action.target as never)}`);
      world.position = action.target as { x: number; y: number; z: number };
      return completed();
    },
  });
  const bot = fakeBot();
  Object.assign(bot, {
    blockAt: (p: { x: number; y: number; z: number }) => {
      const name = world.placed.get(key(p));
      return name ? { name } : null;
    },
  });
  return {
    bot,
    view: {
      tick: 0,
      health: 20,
      hunger: 20,
      get position() {
        return { ...world.position };
      },
      inventoryCount: (item: string) => world.inventory[item] ?? 0,
    } as never,
    registry,
    sink: new MemorySink(),
    lifeId: 'life-1',
    bodyGeneration: 1,
    timeScale: 1,
    runAction: (action, stepSignal) => runAction(registry, bot, action, { signal: stepSignal }),
    signal,
  };
}

async function run(program: BuildProgram, ctx: ProgramContext): Promise<StepResult> {
  let last: StepResult = { status: 'running' };
  for (let i = 0; i < 100 && last.status === 'running'; i++) last = await program.step(ctx);
  return last;
}

const placesIn = (world: BuildWorld): string[] =>
  world.log.filter((l) => l.startsWith('place:')).map((l) => l.slice('place:'.length));

const SHELTER = { blueprint: 'shelter', block: 'cobblestone' };

describe('build blueprints', () => {
  it('counts 23, 15 and 3 blocks, lowest layer first', () => {
    for (const [name, count] of [
      ['shelter', 23],
      ['wall', 15],
      ['pillar', 3],
    ] as const) {
      const cells = blueprintCells(name);
      expect(cells).toHaveLength(count);
      expect(cells.map((c) => c.dy)).toEqual([...cells.map((c) => c.dy)].sort((a, b) => a - b));
    }
    expect(new Set(blueprintCells('shelter').map((c) => c.dy))).toEqual(new Set([0, 1, 2]));
  });
});

describe('build program', () => {
  it('places every cell, lowest layer first, relative to the start cell', async () => {
    const world = makeWorld(30);
    const ctx = context(world);
    const program = new BuildProgram();
    await program.start(SHELTER, ctx);
    const last = await run(program, ctx);
    expect(last).toEqual({
      status: 'completed',
      detail: { message: 'Built shelter: 23 placed, 0 already solid, of 23.' },
    });
    const ys = world.log.filter((l) => l.startsWith('place:')).map((l) => Number(l.split(',')[1]));
    expect(ys).toEqual([...ys].sort((a, b) => a - b));
    expect(ys[0]).toBe(64);
    expect(ys.at(-1)).toBe(66);
    expect(world.log[0]).toBe('place:9,64,9');
    expect(world.inventory.cobblestone).toBe(7);
  });

  it('stops with the missing count when the blocks run out, and resumes after a refill', async () => {
    const world = makeWorld(20);
    const ctx = context(world);
    const program = new BuildProgram();
    await program.start(SHELTER, ctx);
    const last = await run(program, ctx);
    expect(last).toEqual({
      status: 'wake',
      reason: 'precondition_failed',
      message:
        'Built shelter: 20 placed, 0 already solid, of 23. Out of cobblestone: 3 more needed.',
    });
    world.inventory.cobblestone = 3;
    const saved = JSON.parse(JSON.stringify(program.checkpoint()));
    const again = new BuildProgram();
    await again.resume(saved, ctx);
    expect((await run(again, ctx)).status).toBe('completed');
    expect(world.placed.size).toBe(23);
  });

  it('does not place again a cell that already holds the block after a restart', async () => {
    const world = makeWorld(30);
    const ctx = context(world);
    const program = new BuildProgram();
    await program.start(SHELTER, ctx);
    await program.step(ctx);
    const placedBefore = world.placed.size;
    const saved = JSON.parse(JSON.stringify(program.checkpoint()));
    saved.next = 0; // the checkpoint is older than the world
    const again = new BuildProgram();
    await again.resume(saved, ctx);
    await run(again, ctx);
    expect(world.log.filter((l) => l.startsWith('place:'))).toHaveLength(23);
    expect(placedBefore).toBe(3);
  });

  it('steps aside when the next cell is the body own cell', async () => {
    const world = makeWorld(5);
    const ctx = context(world);
    const program = new BuildProgram();
    await program.start({ blueprint: 'pillar', block: 'cobblestone' }, ctx);
    const last = await run(program, ctx);
    expect(last.status).toBe('completed');
    expect(world.log[0]).toBe('goto:11,64,10');
    expect(world.log.filter((l) => l.startsWith('place:'))).toEqual([
      'place:10,64,10',
      'place:10,65,10',
      'place:10,66,10',
    ]);
  });

  it('leaves the state unchanged when aborted before a placement', async () => {
    const world = makeWorld(30);
    const controller = new AbortController();
    const ctx = context(world, controller.signal);
    const program = new BuildProgram();
    await program.start(SHELTER, ctx);
    controller.abort();
    expect(await program.step(ctx)).toEqual({ status: 'running' });
    expect(program.checkpoint()).toMatchObject({ next: 0 });
    expect(world.placed.size).toBe(0);
  });

  it('refuses unknown blueprints and extra arguments', async () => {
    const ctx = context(makeWorld(1));
    await expect(
      new BuildProgram().start({ blueprint: 'castle', block: 'dirt' }, ctx),
    ).rejects.toMatchObject({ reason: 'invalid_args' });
    await expect(new BuildProgram().start({ ...SHELTER, extra: 1 }, ctx)).rejects.toMatchObject({
      reason: 'invalid_args',
    });
  });

  it('counts cells that already hold stone as done and places only the open cells', async () => {
    const world = makeWorld(30);
    const cells = blueprintCells('shelter');
    const filled = cells.flatMap((_c, i) => (i < 17 ? [cellKey(i)] : []));
    for (const k of filled) world.placed.set(k, 'stone');
    const ctx = context(world);
    const program = new BuildProgram();
    await program.start(SHELTER, ctx);
    const last = await run(program, ctx);
    const open = cells.length - filled.length;
    expect(last).toEqual({
      status: 'completed',
      detail: { message: `Built shelter: ${open} placed, ${filled.length} already solid, of 23.` },
    });
    expect(placesIn(world)).toEqual(cells.slice(17).map((_c, i) => cellKey(i + 17)));
  });

  it('retries a cell refused as blocked after the last cell, then completes', async () => {
    const world = makeWorld(30);
    world.refusals.set(cellKey(2), 1);
    const ctx = context(world);
    const program = new BuildProgram();
    await program.start(SHELTER, ctx);
    const last = await run(program, ctx);
    expect(last).toEqual({
      status: 'completed',
      detail: { message: 'Built shelter: 23 placed, 0 already solid, of 23.' },
    });
    const attempts = placesIn(world);
    expect(attempts.filter((k) => k === cellKey(2))).toHaveLength(2);
    // The refused cell is tried again only after the cells after it.
    expect(attempts.at(-1)).toBe(cellKey(2));
    expect(world.placed.size).toBe(23);
  });

  it('fails only after every other cell is attempted, and names the count', async () => {
    const world = makeWorld(30);
    world.refusals.set(cellKey(4), Number.POSITIVE_INFINITY);
    const ctx = context(world);
    const program = new BuildProgram();
    await program.start(SHELTER, ctx);
    const last = await run(program, ctx);
    expect(last).toEqual({
      status: 'failed',
      message:
        'Built shelter: 22 placed, 0 already solid, of 23. 1 cells could not be placed; first failure: blocked: the server refused.',
    });
    expect(world.placed.size).toBe(22);
    const attempts = placesIn(world);
    expect(attempts.filter((k) => k === cellKey(4))).toHaveLength(2);
    expect(attempts.slice(-1)).toEqual([cellKey(4)]);
  });

  it('keeps a deferred cell across a checkpoint and retries it after a resume', async () => {
    const world = makeWorld(30);
    world.refusals.set(cellKey(1), 1);
    const ctx = context(world);
    const program = new BuildProgram();
    await program.start(SHELTER, ctx);
    await program.step(ctx);
    expect(program.checkpoint()).toMatchObject({ deferred: [1] });
    const saved = JSON.parse(JSON.stringify(program.checkpoint()));
    const again = new BuildProgram();
    await again.resume(saved, ctx);
    expect(await run(again, ctx)).toEqual({
      status: 'completed',
      detail: { message: 'Built shelter: 23 placed, 0 already solid, of 23.' },
    });
  });

  it('resumes from an old-format checkpoint without the new fields', async () => {
    const world = makeWorld(30);
    for (let i = 0; i < 5; i++) world.placed.set(cellKey(i), 'cobblestone');
    const ctx = context(world);
    const program = new BuildProgram();
    const old = {
      blueprint: 'shelter',
      block: 'cobblestone',
      origin: { x: 10, y: 64, z: 10 },
      next: 5,
    };
    await program.resume(old, ctx);
    expect(await run(program, ctx)).toEqual({
      status: 'completed',
      detail: { message: 'Built shelter: 23 placed, 0 already solid, of 23.' },
    });
    expect(placesIn(world)).toHaveLength(18);
  });

  it('rejects a checkpoint whose deferred list names a cell the blueprint lacks', async () => {
    const ctx = context(makeWorld(1));
    const bad = {
      blueprint: 'pillar',
      block: 'cobblestone',
      origin: { x: 10, y: 64, z: 10 },
      next: 3,
      deferred: [7],
    };
    await expect(new BuildProgram().resume(bad, ctx)).rejects.toMatchObject({
      reason: 'invalid_args',
    });
  });
});
