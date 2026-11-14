import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { afterEach, describe, expect, it } from 'vitest';
import type { Block } from './bot-types.ts';
import { setOwnerLookup } from './protected-blocks.ts';
import type { ActionContext } from './registry.ts';
import { EIGHT, unstick } from './unstick.ts';
import { digUp } from './unstick-up.ts';

type Grid = Map<string, string>;
const key = (x: number, y: number, z: number): string => `${x},${y},${z}`;

/** Blocks a bare hand cannot drop: stone needs a pickaxe (the test has none). */
const NEEDS_TOOL = new Set(['stone']);

/** A block grid: unlisted cells are air; `water` and `lava` are empty-boxed; the rest are solid. */
function blockOf(grid: Grid, cell: Vec3): Block | null {
  const name = grid.get(key(cell.x, cell.y, cell.z)) ?? 'air';
  const boundingBox = name === 'air' || name === 'water' || name === 'lava' ? 'empty' : 'block';
  const harvestTools = NEEDS_TOOL.has(name) ? { 270: true } : undefined;
  return {
    name,
    boundingBox,
    diggable: true,
    hardness: 1.5,
    harvestTools,
    position: cell,
  } as unknown as Block;
}

/**
 * A fake Body. Walking moves 0.3 blocks a tick into open cells. A jump forward onto a solid cell whose
 * head room is open rises one block onto it, as a real hop does.
 */
function fakeBot(grid: Grid, start: Vec3) {
  const dug: string[] = [];
  let dir = new Vec3(0, 0, 0);
  const controls = new Set<string>();
  const bot = {
    health: 6.83,
    game: { dimension: 'minecraft:overworld' },
    entity: { position: start, height: 1.62 },
    blockAt: (cell: Vec3) => blockOf(grid, cell),
    async lookAt(target: Vec3) {
      dir = new Vec3(
        target.x - bot.entity.position.x,
        0,
        target.z - bot.entity.position.z,
      ).normalize();
    },
    setControlState(name: string, on: boolean) {
      if (on) controls.add(name);
      else controls.delete(name);
    },
    async waitForTicks() {
      if (!controls.has('forward')) return;
      const here = bot.entity.position.floored();
      const step = new Vec3(Math.round(dir.x), 0, Math.round(dir.z));
      const next = here.plus(step);
      const isBox = (cell: Vec3, box: string) => blockOf(grid, cell)?.boundingBox === box;
      if (
        controls.has('jump') &&
        isBox(next, 'block') &&
        isBox(next.offset(0, 1, 0), 'empty') &&
        isBox(next.offset(0, 2, 0), 'empty')
      ) {
        bot.entity.position = new Vec3(next.x + 0.5, next.y + 1, next.z + 0.5);
        return;
      }
      // The Body is 0.6 wide: its leading edge must reach open cells, so it stops 0.3 short of a wall.
      const ahead = bot.entity.position.plus(dir.scaled(0.3));
      const edge = ahead.plus(dir.scaled(0.3)).floored();
      const clear = (cell: Vec3) => isBox(cell, 'empty') && isBox(cell.offset(0, 1, 0), 'empty');
      if (clear(ahead.floored()) && clear(edge)) bot.entity.position = ahead;
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

/** Zack's cell (decision 0196 fixture): feet (-265.5, 35, 196.5), so the feet cell is (-266, 35, 196). */
const BASE = { x: -266, y: 35, z: 196 };
const START = new Vec3(BASE.x + 0.5, BASE.y, BASE.z + 0.5);

/**
 * The pit around Zack's cell: a stone floor one block under the feet, a stone wall two blocks high to the
 * west and to the south (each two blocks thick to the west), a stone ledge at the top of the west wall to
 * the north, and nothing (a drop of 4+ blocks) to the north and east. `wall` is the wall's block name and
 * `above` a block set on the cell above each wall cell the climb digs (a hazard test).
 */
function zackPit(wall = 'stone', above: string | null = null): Grid {
  const grid: Grid = new Map();
  const put = (dx: number, dy: number, dz: number, name: string): void => {
    grid.set(key(BASE.x + dx, BASE.y + dy, BASE.z + dz), name);
  };
  for (const dx of [-3, -2, -1, 0]) for (const dz of [0, 1, 2, 3]) put(dx, -1, dz, 'stone');
  for (const dy of [0, 1]) {
    put(-1, dy, 0, wall);
    put(-2, dy, 0, wall);
    put(0, dy, 1, wall);
    put(0, dy, 2, wall);
    put(-1, dy, 1, wall);
    put(-1, dy, 2, wall);
  }
  if (above !== null) {
    // Every climb beside the Body (west, south-west, south) digs a cell with `above` over it.
    put(-1, 2, 0, above);
    put(-1, 2, 1, above);
    put(0, 2, 1, above);
  }
  return grid;
}

const ownedBy = (owner: string | null) => setOwnerLookup(() => ({ known: true, owner }));
/** The failure text of an outcome ('' when it has none). */
const messageOf = (outcome: { status: string; message?: string }): string => outcome.message ?? '';

describe('unstick upward hand-dig rung (decision 0196)', () => {
  afterEach(() => setOwnerLookup(null));

  it('digs up through the pit wall and ends free on a ledge the Body can step off', async () => {
    const grid = zackPit();
    const { bot, dug } = fakeBot(grid, START);
    const outcome = await unstick(ctxOf(bot));
    expect(outcome.status).toBe('completed');
    expect(outcome.detail.method).toBe('dig_up');
    expect(dug).toContain('stone');
    expect(outcome.detail.dug).toBe(1);
    expect(bot.entity.position.y).toBeGreaterThanOrEqual(BASE.y + 1);
  });

  it("does not dig another player's block above the Body", async () => {
    ownedBy('other-player');
    const grid = zackPit('oak_planks');
    const { bot, dug } = fakeBot(grid, START);
    const outcome = await unstick(ctxOf(bot));
    expect(outcome.status).toBe('failed');
    expect(dug).toEqual([]);
    expect(messageOf(outcome)).toContain("someone else's work");
    expect(grid.get(key(BASE.x - 1, BASE.y + 1, BASE.z))).toBe('oak_planks');
  });

  it('refuses a climb with lava above the cell it digs', async () => {
    const grid = zackPit('stone', 'lava');
    const { bot } = fakeBot(grid, START);
    const outcome = await unstick(ctxOf(bot));
    expect(outcome.status).toBe('failed');
    expect(messageOf(outcome)).toContain('lava');
    expect(grid.get(key(BASE.x - 1, BASE.y + 1, BASE.z))).toBe('stone');
  });

  it('refuses a climb with gravel above the cell it digs (falling-block rule)', async () => {
    const grid = zackPit('stone', 'gravel');
    const { bot } = fakeBot(grid, START);
    const outcome = await unstick(ctxOf(bot));
    expect(outcome.status).toBe('failed');
    expect(messageOf(outcome)).toContain('gravel');
    expect(grid.get(key(BASE.x - 1, BASE.y + 1, BASE.z))).toBe('stone');
  });

  it('refuses a climb whose wall cell is lava (the cell itself, not a hazard beside it)', async () => {
    const grid = zackPit();
    grid.set(key(BASE.x - 1, BASE.y + 1, BASE.z), 'lava');
    const { bot, dug } = fakeBot(grid, START);
    const result = await digUp(
      bot as unknown as Bot,
      new AbortController().signal,
      () => bot.entity.position.floored(),
      [new Vec3(-1, 0, 0)],
    );
    expect(result.freed).toBe(false);
    expect(result.dug).toBe(0);
    expect(result.blocked).toContain('lava is above the wall');
    expect(dug).toEqual([]);
    expect(grid.get(key(BASE.x - 1, BASE.y + 1, BASE.z))).toBe('lava');
  });

  it('does not report free on a wall top it cannot step off', async () => {
    const grid: Grid = new Map([
      [key(BASE.x - 1, BASE.y, BASE.z), 'stone'],
      [key(BASE.x - 1, BASE.y + 1, BASE.z), 'stone'],
    ]);
    const { bot, dug } = fakeBot(grid, START);
    const result = await digUp(
      bot as unknown as Bot,
      new AbortController().signal,
      () => bot.entity.position.floored(),
      [new Vec3(-1, 0, 0)],
    );
    expect(dug).toEqual(['stone']);
    expect(result.dug).toBe(1);
    expect(result.freed).toBe(false);
  });

  it('stops digging when the signal aborts after the first dig', async () => {
    const grid = zackPit();
    const { bot, dug } = fakeBot(grid, START);
    const ac = new AbortController();
    const dig = bot.dig;
    bot.dig = async (block: Block) => {
      await dig(block);
      ac.abort();
    };
    const result = await digUp(
      bot as unknown as Bot,
      ac.signal,
      () => bot.entity.position.floored(),
      EIGHT,
    );
    expect(result.freed).toBe(false);
    expect(result.blocked).toBeNull();
    expect(result.dug).toBe(1);
    expect(dug).toHaveLength(1);
  });

  it('does nothing when the signal is already aborted', async () => {
    const { bot, dug } = fakeBot(zackPit(), START);
    const ac = new AbortController();
    ac.abort();
    const result = await digUp(
      bot as unknown as Bot,
      ac.signal,
      () => bot.entity.position.floored(),
      EIGHT,
    );
    expect(result).toEqual({ freed: false, dug: 0, blocked: null });
    expect(dug).toEqual([]);
  });
});
