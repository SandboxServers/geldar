import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Block } from './bot-types.ts';
import { setOwnerLookup } from './protected-blocks.ts';
import type { ActionContext } from './registry.ts';
import { EIGHT, unstick } from './unstick.ts';
import { digUp } from './unstick-up.ts';

type Grid = Map<string, string>;
const key = (x: number, y: number, z: number): string => `${x},${y},${z}`;

/** Blocks a bare hand cannot drop: stone needs a pickaxe (the test has none). */
const NEEDS_TOOL = new Set(['stone']);
/** Cells the fake reads as empty-boxed: air, liquids, fire and the underwater plant kelp. */
const EMPTY_BOX = new Set(['air', 'water', 'lava', 'fire', 'kelp']);

/** A block grid: unlisted cells are air; `water`, `lava` and `kelp` are empty-boxed; the rest are solid. */
function blockOf(grid: Grid, cell: Vec3, hardness = 1.5): Block | null {
  const name = grid.get(key(cell.x, cell.y, cell.z)) ?? 'air';
  const boundingBox = EMPTY_BOX.has(name) ? 'empty' : 'block';
  const harvestTools = NEEDS_TOOL.has(name) ? { 270: true } : undefined;
  return {
    name,
    boundingBox,
    diggable: true,
    hardness,
    harvestTools,
    position: cell,
  } as unknown as Block;
}

/**
 * A fake Body. Walking moves 0.3 blocks a tick into open cells. A jump forward onto a solid cell whose
 * head room is open rises one block onto it, as a real hop does. `hardness` is the grid's block hardness
 * (0 makes a dig cost half a second, for the climb-count tests).
 */
function fakeBot(grid: Grid, start: Vec3, hardness = 1.5) {
  const dug: string[] = [];
  let dir = new Vec3(0, 0, 0);
  const controls = new Set<string>();
  const bot = {
    username: 'body_test',
    health: 6.83,
    game: { dimension: 'minecraft:overworld' },
    entity: { position: start, height: 1.62 },
    blockAt: (cell: Vec3) => blockOf(grid, cell, hardness),
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
      const isBox = (cell: Vec3, box: string) => blockOf(grid, cell, hardness)?.boundingBox === box;
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
const WEST = [new Vec3(-1, 0, 0)];

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

/**
 * A 1x1 shaft: the Body's column is open, every other cell within eight blocks is stone, and the floor
 * under the column is stone. The walls are six blocks high, so a climb must dig through them.
 */
function shaftPit(): Grid {
  const grid: Grid = new Map();
  for (let dx = -8; dx <= 8; dx++) {
    for (let dz = -8; dz <= 8; dz++) {
      grid.set(key(BASE.x + dx, BASE.y - 1, BASE.z + dz), 'stone');
      if (dx === 0 && dz === 0) continue;
      for (let dy = 0; dy < 6; dy++) grid.set(key(BASE.x + dx, BASE.y + dy, BASE.z + dz), 'stone');
    }
  }
  return grid;
}

/** A wall top with a stone floor under the start cell and nothing around the wall's top. */
function wallTop(): Grid {
  return new Map([
    [key(BASE.x, BASE.y - 1, BASE.z), 'stone'],
    [key(BASE.x - 1, BASE.y, BASE.z), 'stone'],
    [key(BASE.x - 1, BASE.y + 1, BASE.z), 'stone'],
  ]);
}

const ownedBy = (owner: string | null) => setOwnerLookup(() => ({ known: true, owner }));
/** The failure text of an outcome ('' when it has none). */
const messageOf = (outcome: { status: string; message?: string }): string => outcome.message ?? '';

/** Climbs west from the start cell with the given grid; returns the result, the digs and the Body. */
async function climbWest(grid: Grid, hardness = 1.5) {
  const { bot, dug } = fakeBot(grid, START, hardness);
  const result = await digUp(
    bot as unknown as Bot,
    new AbortController().signal,
    () => bot.entity.position.floored(),
    WEST,
  );
  return { result, dug, bot };
}

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

  it('does not report free while the Body is still in a closed 1x1 shaft (decision 0196 FIX-1)', async () => {
    const { result, dug, bot } = await climbWest(shaftPit(), 0);
    // Every climb digs two cells and hops one block; the 4-climb cap ends the rung with no ledge.
    expect(result.freed).toBe(false);
    expect(result.blocked).toBe('the climb reached 4 blocks with no ledge');
    expect(result.dug).toBe(8);
    expect(dug).toHaveLength(8);
    expect(bot.entity.position.y).toBe(BASE.y + 4);
  });

  it('does not report free on a wall top it cannot step off', async () => {
    const { result, dug } = await climbWest(wallTop());
    expect(dug).toEqual(['stone']);
    expect(result.dug).toBe(1);
    expect(result.freed).toBe(false);
  });

  it('refuses a climb whose wall is magma or cactus (the cell the Body would stand on)', async () => {
    for (const name of ['magma_block', 'cactus']) {
      const grid = zackPit();
      grid.set(key(BASE.x - 1, BASE.y, BASE.z), name);
      const { result, dug } = await climbWest(grid);
      expect(result.freed).toBe(false);
      expect(result.blocked).toContain(name);
      expect(dug).toEqual([]);
    }
  });

  it('does not climb into an underwater plant above the wall (not open air)', async () => {
    const grid = zackPit();
    grid.set(key(BASE.x - 1, BASE.y + 1, BASE.z), 'kelp');
    const { result, dug } = await climbWest(grid);
    expect(result.freed).toBe(false);
    expect(result.blocked).toContain('kelp');
    expect(dug).toEqual([]);
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

  it.each([
    ['feet', 1],
    ['head', 2],
  ])(
    'refuses a climb with fire in the %s cell above the wall (decision 0196)',
    async (_cell, dy) => {
      const grid = zackPit();
      grid.set(key(BASE.x - 1, BASE.y + dy, BASE.z), 'fire');
      const { result, dug } = await climbWest(grid);
      expect(result).toMatchObject({ freed: false, dug: 0 });
      expect(result.blocked).toContain('fire at');
      expect(dug).toEqual([]);
    },
  );

  it('refuses a climb whose wall cell is lava (the cell itself, not a hazard beside it)', async () => {
    const grid = zackPit();
    grid.set(key(BASE.x - 1, BASE.y + 1, BASE.z), 'lava');
    const { result, dug } = await climbWest(grid);
    expect(result.freed).toBe(false);
    expect(result.dug).toBe(0);
    expect(result.blocked).toContain('lava is above the wall');
    expect(dug).toEqual([]);
    expect(grid.get(key(BASE.x - 1, BASE.y + 1, BASE.z))).toBe('lava');
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

describe('unstick upward rung: side, head room, budgets and digs cap (decision 0196)', () => {
  afterEach(() => setOwnerLookup(null));

  /** A stone floor round the start cell and a two-high stone wall on `dir`'s side: a one-block ledge. */
  function ledgePit(dir: Vec3): Grid {
    const grid: Grid = new Map();
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) grid.set(key(BASE.x + dx, BASE.y - 1, BASE.z + dz), 'stone');
    }
    for (const dy of [0, 1]) grid.set(key(BASE.x + dir.x, BASE.y + dy, BASE.z + dir.z), 'stone');
    return grid;
  }

  it.each([
    ['west', new Vec3(-1, 0, 0)],
    ['east', new Vec3(1, 0, 0)],
    ['north', new Vec3(0, 0, -1)],
    ['south', new Vec3(0, 0, 1)],
  ])('climbs the wall on the %s side and stands on its top', async (_side, dir) => {
    const { bot, dug } = fakeBot(ledgePit(dir), START);
    const result = await digUp(
      bot as unknown as Bot,
      new AbortController().signal,
      () => bot.entity.position.floored(),
      [dir],
    );
    expect(result).toEqual({ freed: true, dug: 1, blocked: null });
    expect(dug).toEqual(['stone']);
    expect(bot.entity.position.floored()).toEqual(
      new Vec3(BASE.x + dir.x, BASE.y + 1, BASE.z + dir.z),
    );
  });

  it('refuses a climb whose head cell is solid: the Body cannot stand in a one-high hole', async () => {
    const grid = zackPit();
    grid.set(key(BASE.x, BASE.y + 1, BASE.z), 'stone');
    const { result, dug } = await climbWest(grid);
    expect(dug).toEqual([]);
    expect(result).toMatchObject({ freed: false, dug: 0 });
  });

  it('refuses a climb whose digging alone passes the 25 s budget, before any block is broken', async () => {
    // Hardness 6 makes the one stone cell above the wall cost 30 s of hand digging.
    const { result, dug } = await climbWest(zackPit(), 6);
    expect(dug).toEqual([]);
    expect(result).toMatchObject({ freed: false, dug: 0 });
    expect(result.blocked).toMatch(/budget is 25 s/);
  });

  it('counts the time already spent against the 30 s action limit', async () => {
    // 25 s already spent, then a 7.5 s dig and a 1 s hop: 33.5 s is past the limit.
    const { bot, dug } = fakeBot(zackPit(), START);
    const result = await digUp(
      bot as unknown as Bot,
      new AbortController().signal,
      () => bot.entity.position.floored(),
      WEST,
      Date.now() - 25_000,
    );
    expect(dug).toEqual([]);
    expect(result).toMatchObject({ freed: false, dug: 0 });
    expect(result.blocked).toMatch(/action limit/);
  });

  it('digs a climb that still ends inside the 30 s action limit', async () => {
    // 20 s already spent: 20 + 7.5 + 1 is 28.5 s, inside the limit.
    const { bot, dug } = fakeBot(zackPit(), START);
    const result = await digUp(
      bot as unknown as Bot,
      new AbortController().signal,
      () => bot.entity.position.floored(),
      WEST,
      Date.now() - 20_000,
    );
    expect(dug).toEqual(['stone']);
    expect(result).toEqual({ freed: true, dug: 1, blocked: null });
  });

  it('stops before a climb that would pass the digs left for the call (MAX_DIGS)', async () => {
    // Each climb digs two cells. With 5 digs left, the third climb (2 more) is refused after 4 digs.
    const { bot, dug } = fakeBot(shaftPit(), START, 0);
    const result = await digUp(
      bot as unknown as Bot,
      new AbortController().signal,
      () => bot.entity.position.floored(),
      WEST,
      Date.now(),
      5,
    );
    expect(result).toMatchObject({ freed: false, dug: 4 });
    expect(dug).toHaveLength(4);
    expect(result.blocked).toMatch(/digs and 1 are left/);
    expect(bot.entity.position.y).toBe(BASE.y + 2);
  });
});

describe('unstick upward rung caps: budget, action limit, digs and their boundaries (review 2 FIX-1)', () => {
  beforeEach(() => {
    // Date is frozen, so `Date.now() - ms` is exactly `ms` already spent on the action.
    vi.useFakeTimers({ toFake: ['Date'] });
  });
  afterEach(() => {
    vi.useRealTimers();
    setOwnerLookup(null);
  });

  /** Climbs west in Zack's pit with `ms` already spent and `digsLeft` digs allowed (default: no cap). */
  async function climbAfter(ms: number, grid: Grid, digsLeft?: number) {
    const { bot, dug } = fakeBot(grid, START);
    const result = await digUp(
      bot as unknown as Bot,
      new AbortController().signal,
      () => bot.entity.position.floored(),
      WEST,
      Date.now() - ms,
      digsLeft,
    );
    return { result, dug };
  }

  it('the 25 s budget allows a climb costing exactly 25 s and refuses 26 s before any dig', async () => {
    // Hardness 2.5 is 12.5 s a cell: the first climb's two cells cost exactly 25 s, so it is dug.
    const exact = await climbWest(shaftPit(), 2.5);
    expect(exact.result.dug).toBe(2);
    expect(exact.result.blocked).toMatch(/needs about 50 s/);
    // Hardness 2.6 is 13 s a cell: 26 s is over the budget, so nothing is broken.
    const over = await climbWest(shaftPit(), 2.6);
    expect(over.dug).toEqual([]);
    expect(over.result).toMatchObject({ freed: false, dug: 0 });
    expect(over.result.blocked).toMatch(/budget is 25 s/);
  });

  it('the 30 s limit allows a climb ending at exactly 30 s with the 1 s hop reserve', async () => {
    // 21.5 s spent, a 7.5 s stone dig and the 1 s reserve: exactly 30 s, so the climb runs.
    const { result, dug } = await climbAfter(21_500, zackPit());
    expect(dug).toEqual(['stone']);
    expect(result).toEqual({ freed: true, dug: 1, blocked: null });
  });

  it('the 30 s limit refuses a climb that would end 1 ms past 30 s, reserve included', async () => {
    const { result, dug } = await climbAfter(21_501, zackPit());
    expect(dug).toEqual([]);
    expect(result).toMatchObject({ freed: false, dug: 0 });
    expect(result.blocked).toMatch(/action limit/);
  });

  it('the digs cap allows a climb that uses exactly the digs left', async () => {
    const { result, dug } = await climbAfter(0, zackPit(), 1);
    expect(dug).toEqual(['stone']);
    expect(result).toEqual({ freed: true, dug: 1, blocked: null });
  });

  it('the digs cap refuses a climb one dig over, before any block is broken', async () => {
    const { result, dug } = await climbAfter(0, zackPit(), 0);
    expect(dug).toEqual([]);
    expect(result).toMatchObject({ freed: false, dug: 0 });
    expect(result.blocked).toBe('the next climb needs 1 digs and 0 are left');
  });

  it('the digs cap counts a two-cell climb across the second climb (exact at 2)', async () => {
    const { bot, dug } = fakeBot(shaftPit(), START, 0);
    const result = await digUp(
      bot as unknown as Bot,
      new AbortController().signal,
      () => bot.entity.position.floored(),
      WEST,
      Date.now(),
      2,
    );
    expect(result).toMatchObject({ freed: false, dug: 2 });
    expect(dug).toHaveLength(2);
    expect(result.blocked).toBe('the next climb needs 2 digs and 0 are left');
  });

  it('a climb whose hop rises less than 0.9 blocks is not a climb: the Body did not rise', async () => {
    const { bot, dug } = fakeBot(zackPit(), START);
    let raised = false;
    // The first tick of the hop lifts the Body half a block and no more.
    bot.waitForTicks = async () => {
      if (raised) return;
      raised = true;
      bot.entity.position = bot.entity.position.offset(0, 0.5, 0);
    };
    const result = await digUp(
      bot as unknown as Bot,
      new AbortController().signal,
      () => bot.entity.position.floored(),
      WEST,
    );
    expect(dug).toEqual(['stone']);
    expect(result).toEqual({
      freed: false,
      dug: 1,
      blocked: 'the Body did not rise onto the cleared wall',
    });
  });

  it('an unstick run in the 1x1 shaft spends its six digs and climbs no further', async () => {
    const { bot, dug } = fakeBot(shaftPit(), START, 0.5);
    const outcome = await unstick(ctxOf(bot));
    expect(outcome.status).toBe('failed');
    expect(messageOf(outcome)).toContain('dig_up: the next climb needs 2 digs and 0 are left');
    // The climb's digs count against the six: the last-resort pass must not dig more after it. Eight
    // stones are broken in all (the earlier passes and the two climb cells); none comes after the climb.
    expect(dug).toHaveLength(8);
  });
});

describe('unstick upward rung ownership (decision 0164)', () => {
  afterEach(() => setOwnerLookup(null));

  it("refuses a natural stone wall another player's record names", async () => {
    ownedBy('other-player');
    const grid = zackPit();
    const { result, dug } = await climbWest(grid);
    expect(result.dug).toBe(0);
    expect(dug).toEqual([]);
    expect(grid.get(key(BASE.x - 1, BASE.y + 1, BASE.z))).toBe('stone');
  });

  it('refuses a natural stone wall whose owner is unknown', async () => {
    setOwnerLookup(() => ({ known: false }));
    const grid = zackPit();
    const { result, dug } = await climbWest(grid);
    expect(result.dug).toBe(0);
    expect(dug).toEqual([]);
    expect(grid.get(key(BASE.x - 1, BASE.y + 1, BASE.z))).toBe('stone');
  });

  it("digs a natural stone wall the Body's own record names", async () => {
    ownedBy('body_test');
    const { result, dug } = await climbWest(zackPit());
    expect(result.dug).toBe(1);
    expect(dug).toEqual(['stone']);
  });

  it('digs a natural stone wall with no ownership record', async () => {
    setOwnerLookup(null);
    const { result, dug } = await climbWest(zackPit());
    expect(result.dug).toBe(1);
    expect(dug).toEqual(['stone']);
  });
});
