import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { describe, expect, it } from 'vitest';
import type { Block } from './bot-types.ts';
import type { ActionContext } from './registry.ts';
import { dropAllowed, EIGHT, MAX_DROP, planMoves, scanDrop, unstick } from './unstick.ts';

type Grid = Map<string, string>;
const key = (x: number, y: number, z: number): string => `${x},${y},${z}`;

/** A block grid: unlisted cells are air (empty), `water` is empty-boxed, the rest are solid. */
function blockOf(grid: Grid, cell: Vec3): Block | null {
  const name = grid.get(key(cell.x, cell.y, cell.z)) ?? 'air';
  if (name === 'unloaded') return null;
  const boundingBox = name === 'air' || name === 'water' ? 'empty' : 'block';
  return { name, boundingBox, diggable: true, position: cell } as unknown as Block;
}

/** The island: one block under the feet at y 63 and nothing else, so every side is a deep drop. */
function island(): Grid {
  return new Map([[key(0, 63, 0), 'stone']]);
}

function fakeBot(grid: Grid, health = 20) {
  const dug: string[] = [];
  const controls: string[] = [];
  let dir = new Vec3(0, 0, 0);
  const bot = {
    health,
    entity: { position: new Vec3(0.5, 64, 0.5), height: 1.62 },
    blockAt: (cell: Vec3) => blockOf(grid, cell),
    async lookAt(target: Vec3) {
      dir = new Vec3(
        target.x - bot.entity.position.x,
        0,
        target.z - bot.entity.position.z,
      ).normalize();
    },
    setControlState(name: string, on: boolean) {
      controls.push(`${name}:${on}`);
    },
    async waitForTicks() {
      if (controls.findLast((c) => c.startsWith('forward:')) !== 'forward:true') return;
      const next = bot.entity.position.plus(dir.scaled(0.3));
      const feet = next.floored();
      const free = [feet, feet.offset(0, 1, 0)].every(
        (cell) => blockOf(grid, cell)?.boundingBox === 'empty',
      );
      if (free) bot.entity.position = next;
    },
    async dig(block: Block) {
      dug.push(block.name);
      grid.delete(key(block.position.x, block.position.y, block.position.z));
    },
    placeBlock() {
      throw new Error('unstick must place no blocks');
    },
  };
  return { bot, dug };
}

function ctxOf(bot: unknown, signal = new AbortController().signal): ActionContext {
  return { bot: bot as Bot, signal, timeScale: 1 };
}

const feet = new Vec3(0, 64, 0);

describe('scanDrop and dropAllowed', () => {
  it('counts the fall and names the landing', () => {
    const grid: Grid = new Map([[key(0, 60, 0), 'stone']]);
    const at = (x: number, y: number) => scanDrop((c) => blockOf(grid, c), new Vec3(x, y, 0));
    expect(at(0, 63)).toEqual({ blocks: 3, lands: 'solid' });
    expect(at(0, 60)).toEqual({ blocks: 0, lands: 'solid' });
    grid.set(key(0, 60, 0), 'lava');
    expect(at(0, 63).lands).toBe('unsafe');
    grid.set(key(0, 60, 0), 'water');
    expect(at(0, 63).lands).toBe('water');
    expect(at(5, 63).lands).toBe('unsafe');
    grid.set(key(5, 63, 0), 'unloaded');
    expect(at(5, 63).lands).toBe('unsafe');
  });

  it('never drops at low health, however short the fall', () => {
    expect(dropAllowed(11, { blocks: 1, lands: 'solid' })).toBe(false);
    expect(dropAllowed(4, { blocks: 0, lands: 'water' })).toBe(false);
    expect(dropAllowed(12, { blocks: 1, lands: 'solid' })).toBe(true);
    expect(dropAllowed(20, { blocks: MAX_DROP, lands: 'solid' })).toBe(true);
    expect(dropAllowed(20, { blocks: MAX_DROP + 1, lands: 'solid' })).toBe(false);
    expect(dropAllowed(20, { blocks: 2, lands: 'unsafe' })).toBe(false);
  });
});

describe('planMoves', () => {
  it('offers nothing on an island over a deep drop', () => {
    expect(planMoves((c) => blockOf(island(), c), feet, 20)).toEqual([]);
  });

  it.each(EIGHT.map((dir) => [`${dir.x} ${dir.z}`, dir] as const))(
    'finds the level walk toward %s on its axis and sign only',
    (_name, dir) => {
      const grid = island();
      grid.set(key(dir.x, 63, dir.z), 'dirt');
      const moves = planMoves((c) => blockOf(grid, c), feet, 20);
      expect(moves).toEqual([{ dir, jump: false, drop: 0 }]);
    },
  );

  it('steps up one block with a jump and refuses a two block wall', () => {
    const grid = island();
    grid.set(key(1, 64, 0), 'dirt');
    grid.set(key(-1, 64, 0), 'dirt');
    grid.set(key(-1, 65, 0), 'dirt');
    const moves = planMoves((c) => blockOf(grid, c), feet, 20);
    expect(moves.map((m) => [m.dir.x, m.jump])).toEqual([[1, true]]);
  });

  it('walks off a survivable ledge only with the health for it', () => {
    const grid = island();
    grid.set(key(1, 60, 0), 'dirt');
    expect(planMoves((c) => blockOf(grid, c), feet, 20)).toEqual([
      { dir: EIGHT[0], jump: false, drop: 3 },
    ]);
    expect(planMoves((c) => blockOf(grid, c), feet, 10)).toEqual([]);
  });

  it('never walks into lava', () => {
    const grid = island();
    grid.set(key(1, 62, 0), 'lava');
    expect(planMoves((c) => blockOf(grid, c), feet, 20)).toEqual([]);
  });
});

describe('unstick action', () => {
  it('walks off a one block step and completes', async () => {
    const grid = island();
    for (let x = 1; x <= 3; x++) grid.set(key(x, 63, 0), 'dirt');
    const { bot } = fakeBot(grid);
    const outcome = await unstick(ctxOf(bot));
    expect(outcome).toMatchObject({ status: 'completed', detail: { method: 'step' } });
  });

  it('digs sideways through leaves, with bare hands and no blocks placed', async () => {
    const grid = island();
    grid.set(key(1, 64, 0), 'oak_leaves');
    grid.set(key(1, 65, 0), 'oak_leaves');
    grid.set(key(1, 63, 0), 'dirt');
    grid.set(key(2, 63, 0), 'dirt');
    const { bot, dug } = fakeBot(grid);
    const outcome = await unstick(ctxOf(bot));
    expect(outcome).toMatchObject({ status: 'completed', detail: { method: 'dig_sideways' } });
    expect(dug).toEqual(['oak_leaves', 'oak_leaves']);
  });

  it('digs down through a soft floor when the fall is survivable', async () => {
    const grid = island();
    grid.set(key(0, 63, 0), 'oak_leaves');
    grid.set(key(0, 61, 0), 'dirt');
    const { bot, dug } = fakeBot(grid);
    expect(await unstick(ctxOf(bot))).toMatchObject({ detail: { method: 'dig_down' } });
    expect(dug).toEqual(['oak_leaves']);
  });

  it('does not dig down at low health, over lava, or through hard blocks', async () => {
    const soft = island();
    soft.set(key(0, 63, 0), 'oak_leaves');
    soft.set(key(0, 61, 0), 'dirt');
    const low = fakeBot(soft, 8);
    expect(await unstick(ctxOf(low.bot))).toMatchObject({ status: 'failed', reason: 'blocked' });
    expect(low.dug).toEqual([]);

    const lava = island();
    lava.set(key(0, 63, 0), 'oak_leaves');
    lava.set(key(0, 62, 0), 'lava');
    const burning = fakeBot(lava);
    expect(await unstick(ctxOf(burning.bot))).toMatchObject({ status: 'failed' });
    expect(burning.dug).toEqual([]);

    const hard = island();
    hard.set(key(0, 62, 0), 'stone');
    const stone = fakeBot(hard);
    expect(await unstick(ctxOf(stone.bot))).toMatchObject({ status: 'failed' });
    expect(stone.dug).toEqual([]);
  });

  it('ends cancelled when the signal is already aborted', async () => {
    const grid = island();
    grid.set(key(1, 63, 0), 'dirt');
    const controller = new AbortController();
    controller.abort();
    const { bot } = fakeBot(grid);
    expect(await unstick(ctxOf(bot, controller.signal))).toMatchObject({ status: 'cancelled' });
  });
});
