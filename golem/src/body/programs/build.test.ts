import { describe, expect, it } from 'vitest';
import { blueprintCells } from '../../actions/build/blueprints.ts';
import { completed, failed } from '../../actions/outcome.ts';
import { ActionRegistry, runAction } from '../../actions/registry.ts';
import { fakeBot } from '../body.fakes.ts';
import type { ProgramContext, StepResult } from '../program.ts';
import { MemorySink } from '../records.ts';
import { BuildProgram, partsOf } from './build.ts';

interface BuildWorld {
  position: { x: number; y: number; z: number };
  inventory: Record<string, number>;
  placed: Map<string, string>;
  log: string[];
  /** Refusals left per cell key: `blocked` while the count is above zero. */
  refusals: Map<string, number>;
  /** Timeouts left per cell key: `timeout` while the count is above zero. */
  timeouts: Map<string, number>;
  /** What the view says about enclosure; absent when the view does not say. */
  enclosed?: boolean;
  /** Whether a door the build placed stands open (decision 0163). */
  doorOpen?: boolean;
}

const key = (p: { x: number; y: number; z: number }): string => `${p.x},${p.y},${p.z}`;

function makeWorld(count: number): BuildWorld {
  return {
    position: { x: 10, y: 64, z: 10 },
    inventory: { cobblestone: count },
    placed: new Map(),
    log: [],
    refusals: new Map(),
    timeouts: new Map(),
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
      const timeouts = world.timeouts.get(k) ?? 0;
      if (timeouts > 0) {
        world.timeouts.set(k, timeouts - 1);
        return failed('timeout', 'the path search ran out of time');
      }
      const refusals = world.refusals.get(k) ?? 0;
      if (refusals > 0) {
        world.refusals.set(k, refusals - 1);
        return failed('blocked', 'the server refused');
      }
      if (world.placed.has(k)) return failed('blocked', 'target is occupied');
      if ((world.inventory[action.block] ?? 0) < 1) return failed('missing_materials', 'none');
      world.inventory[action.block] = (world.inventory[action.block] ?? 0) - 1;
      world.placed.set(k, action.block);
      if (action.block.endsWith('_door')) {
        // A placed door fills both halves.
        const at = action.at as { x: number; y: number; z: number };
        world.placed.set(key({ ...at, y: at.y + 1 }), action.block);
      }
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
      if (!name) return null;
      if (!name.endsWith('_door')) return { name, boundingBox: 'block' };
      return {
        name,
        boundingBox: 'block',
        getProperties: () => ({ open: world.doorOpen === true }),
      };
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
      enclosed: world.enclosed,
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
  it('counts 25, 15 and 3 blocks, lowest layer first', () => {
    for (const [name, count] of [
      ['shelter', 25],
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

describe('build part names', () => {
  const shelter = blueprintCells('shelter');
  const wall = blueprintCells('wall');
  const pillar = blueprintCells('pillar');

  it('names a corner cell as on both of its walls', () => {
    expect(partsOf({ dx: -1, dy: 0, dz: -1 }, shelter)).toEqual(['north wall', 'west wall']);
    expect(partsOf({ dx: 1, dy: 1, dz: 1 }, shelter)).toEqual(['south wall', 'east wall']);
  });

  it('names the top layer of a shelter as the roof, its edges included', () => {
    expect(partsOf({ dx: -1, dy: 2, dz: -1 }, shelter)).toEqual(['roof']);
    expect(partsOf({ dx: 0, dy: 2, dz: 0 }, shelter)).toEqual(['roof']);
  });

  it('names the wall blueprint by its outer side, and its ends as walls too', () => {
    expect(partsOf({ dx: 0, dy: 2, dz: 1 }, wall)).toEqual(['south wall']);
    expect(partsOf({ dx: 2, dy: 0, dz: 1 }, wall)).toEqual(['south wall', 'east wall']);
  });

  it('names a pillar top as the roof and the rest as the centre column', () => {
    expect(partsOf({ dx: 0, dy: 2, dz: 0 }, pillar)).toEqual(['roof']);
    expect(partsOf({ dx: 0, dy: 0, dz: 0 }, pillar)).toEqual(['centre column']);
  });

  it('names a cell below the layer the body stood in as the floor', () => {
    expect(partsOf({ dx: 0, dy: -1, dz: 0 }, shelter)).toEqual(['floor']);
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
      detail: { message: 'Built shelter: 25 placed, 0 already solid, of 25.' },
    });
    const ys = world.log.filter((l) => l.startsWith('place:')).map((l) => Number(l.split(',')[1]));
    expect(ys).toEqual([...ys].sort((a, b) => a - b));
    expect(ys[0]).toBe(64);
    expect(ys.at(-1)).toBe(66);
    expect(world.log[0]).toBe('place:9,64,9');
    expect(world.inventory.cobblestone).toBe(5);
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
        'Built shelter: 20 placed, 0 already solid, of 25. Out of cobblestone: 5 more needed.',
    });
    world.inventory.cobblestone = 5;
    const saved = JSON.parse(JSON.stringify(program.checkpoint()));
    const again = new BuildProgram();
    await again.resume(saved, ctx);
    expect((await run(again, ctx)).status).toBe('completed');
    expect(world.placed.size).toBe(25);
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
    expect(world.log.filter((l) => l.startsWith('place:'))).toHaveLength(25);
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
      detail: { message: `Built shelter: ${open} placed, ${filled.length} already solid, of 25.` },
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
      detail: { message: 'Built shelter: 25 placed, 0 already solid, of 25.' },
    });
    const attempts = placesIn(world);
    expect(attempts.filter((k) => k === cellKey(2))).toHaveLength(2);
    // The refused cell is tried again only after the cells after it.
    expect(attempts.at(-1)).toBe(cellKey(2));
    expect(world.placed.size).toBe(25);
  });

  it('defers a cell whose placement timed out and retries it after the last cell', async () => {
    const world = makeWorld(30);
    world.timeouts.set(cellKey(2), 1);
    const ctx = context(world);
    const program = new BuildProgram();
    await program.start(SHELTER, ctx);
    const last = await run(program, ctx);
    expect(last).toEqual({
      status: 'completed',
      detail: { message: 'Built shelter: 25 placed, 0 already solid, of 25.' },
    });
    const attempts = placesIn(world);
    expect(attempts.filter((k) => k === cellKey(2))).toHaveLength(2);
    expect(attempts.at(-1)).toBe(cellKey(2));
    expect(world.placed.size).toBe(25);
  });

  it('fails only after every other cell is attempted, and names the parts it could not place', async () => {
    const world = makeWorld(30);
    // The corner at (1, 0, -1): on the north wall and the east wall. (Cell index 4 is now the doorway.)
    const corner = key({ x: 11, y: 64, z: 9 });
    world.refusals.set(corner, Number.POSITIVE_INFINITY);
    const ctx = context(world);
    const program = new BuildProgram();
    await program.start(SHELTER, ctx);
    const last = await run(program, ctx);
    expect(last).toEqual({
      status: 'failed',
      message:
        'not_possible: Built shelter: 24 placed, 0 already solid, of 25. The north wall and the east wall could not be placed; first failure: blocked: the server refused.',
    });
    expect(world.placed.size).toBe(24);
    const attempts = placesIn(world);
    expect(attempts.filter((k) => k === corner)).toHaveLength(2);
    expect(attempts.slice(-1)).toEqual([corner]);
  });

  it('names the roof and the north wall when cells there could not be placed', async () => {
    const world = makeWorld(30);
    world.refusals.set(key({ x: 10, y: 64, z: 9 }), Number.POSITIVE_INFINITY);
    world.refusals.set(key({ x: 9, y: 66, z: 9 }), Number.POSITIVE_INFINITY);
    const ctx = context(world);
    const program = new BuildProgram();
    await program.start(SHELTER, ctx);
    expect(await run(program, ctx)).toEqual({
      status: 'failed',
      message:
        'not_possible: Built shelter: 23 placed, 0 already solid, of 25. The roof and the north wall could not be placed; first failure: blocked: the server refused.',
    });
  });

  it('says the door is open when the only gap in the shelter is an open door', async () => {
    const world = makeWorld(30);
    world.inventory.oak_door = 1;
    world.doorOpen = true;
    world.enclosed = false;
    const ctx = context(world);
    const program = new BuildProgram();
    await program.start(SHELTER, ctx);
    // The held door goes in the doorway; open, it closes no side (decision 0163).
    expect(await run(program, ctx)).toEqual({
      status: 'completed',
      detail: {
        message:
          'Built shelter: 24 placed, 1 already solid, of 25. Not enclosed: the door is open.',
      },
    });
  });

  it('places a held oak door in the doorway, and never places the upper half', async () => {
    const world = makeWorld(30);
    world.inventory.oak_door = 1;
    const ctx = context(world);
    const program = new BuildProgram();
    await program.start(SHELTER, ctx);
    expect(await run(program, ctx)).toEqual({
      status: 'completed',
      detail: { message: 'Built shelter: 24 placed, 1 already solid, of 25.' },
    });
    const lower = key({ x: 10, y: 64, z: 11 });
    expect(world.placed.get(lower)).toBe('oak_door');
    expect(placesIn(world)).toContain(lower);
    expect(placesIn(world)).not.toContain(key({ x: 10, y: 65, z: 11 }));
    expect(world.inventory.oak_door).toBe(0);
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
      detail: { message: 'Built shelter: 25 placed, 0 already solid, of 25.' },
    });
  });

  it('restarts an old 23-cell shelter checkpoint from cell 0, counting built cells as solid', async () => {
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
      detail: { message: 'Built shelter: 20 placed, 5 already solid, of 25.' },
    });
    expect(placesIn(world)).toHaveLength(20);
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
