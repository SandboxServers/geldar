import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ledgeCells } from '../body/ledge.fakes.ts';
import type { Block } from './bot-types.ts';
import { setOwnerLookup } from './protected-blocks.ts';
import type { ActionContext } from './registry.ts';
import {
  digDown,
  digStair,
  EIGHT,
  lastResortDig,
  planMoves,
  unstick,
  unstickAction,
} from './unstick.ts';
import { ACTION_LIMIT_S } from './unstick-up.ts';

// The dig_descend gate reads noSafeExit from the Body's view. A case sets it; undefined keeps the real read.
const noSafe = vi.hoisted(() => ({ value: undefined as boolean | null | undefined }));
vi.mock('../body/view.ts', async (importOriginal) => {
  const real = await importOriginal<typeof import('../body/view.ts')>();
  return {
    ...real,
    noSafeExit: (...args: Parameters<typeof real.noSafeExit>) =>
      noSafe.value === undefined ? real.noSafeExit(...args) : noSafe.value,
  };
});

type Grid = Map<string, string>;
const key = (x: number, y: number, z: number): string => `${x},${y},${z}`;

/** Blocks a bare hand cannot drop: stone needs a pickaxe. */
const NEEDS_TOOL = new Set(['stone']);
/** Blocks no hand breaks (hardness -1). `void_rock` is not on the refused-name list: only its hardness refuses it. */
const UNBREAKABLE = new Set(['bedrock', 'void_rock']);
/** Hardness of the blocks the budget tests need heavier than stone (1.5); obsidian is 50 in the game. */
const HARD: Record<string, number> = { obsidian: 50 };

/**
 * A block grid: unlisted cells are air (empty), `water` is empty-boxed, the rest are solid. `bedrock` has
 * hardness -1 (no hand breaks it); `stone` lists a harvest tool (a bare hand digs it and drops nothing).
 */
function blockOf(grid: Grid, cell: Vec3): Block | null {
  const name = grid.get(key(cell.x, cell.y, cell.z)) ?? 'air';
  if (name === 'unloaded') return null;
  const boundingBox = name === 'air' || name === 'water' ? 'empty' : 'block';
  const hardness = UNBREAKABLE.has(name) ? -1 : (HARD[name] ?? 1.5);
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
    game: { dimension: 'minecraft:the_nether' },
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

/** The island with a ring of `ring(dir)` at head and feet level on all eight sides: the bot is boxed in. */
function boxedIn(ring: (dir: Vec3) => string): Grid {
  const grid = island();
  for (const dir of EIGHT) {
    grid.set(key(dir.x, 63, dir.z), 'stone');
    for (const y of [64, 65]) grid.set(key(dir.x, y, dir.z), ring(dir));
  }
  return grid;
}

const ownedBy = (owner: string | null) => setOwnerLookup(() => ({ known: true, owner }));

const EAST = new Vec3(1, 0, 0);
/** A stone stair east: the head, feet and below cells of column 1, and a stone landing under them. */
const stairGrid = (): Grid =>
  new Map([
    [key(0, 63, 0), 'stone'],
    [key(1, 65, 0), 'stone'],
    [key(1, 64, 0), 'stone'],
    [key(1, 63, 0), 'stone'],
    [key(1, 62, 0), 'stone'],
  ]);
/** A stone floor under the feet with stone under it: a plain dig-down. */
const floorGrid = (): Grid =>
  new Map([
    [key(0, 63, 0), 'stone'],
    [key(0, 62, 0), 'stone'],
  ]);

/**
 * Runs one dig step with `elapsedMs` of the call already gone (the call started at 0 on a frozen clock),
 * holding a pickaxe when `pick` is set. Returns what the step returned and the blocks it dug.
 */
async function stepAt(
  elapsedMs: number,
  grid: Grid,
  pick: boolean,
  step: (ctx: ActionContext, started: number) => Promise<boolean>,
): Promise<{ ok: boolean; dug: string[] }> {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(elapsedMs);
  ownedBy(null);
  const { bot, dug } = fakeBot(grid);
  if (pick) {
    Object.assign(bot, {
      pathfinder: { stop() {}, setGoal() {}, bestHarvestTool: () => ({ type: 270 }) },
      equip: async () => {},
    });
  }
  const ok = await step(ctxOf(bot), 0);
  return { ok, dug };
}

describe('decision 0210: every dig step is gated by the call budget, with the tool the Body digs with', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('a stair step at 24 s into the call is refused: its three stones (22.5 s by hand) are over the 5 s left', async () => {
    const { ok, dug } = await stepAt(24_000, stairGrid(), false, (ctx, started) =>
      digStair(ctx.bot, ctx.signal, feet, EAST, false, started),
    );
    expect(ok).toBe(false);
    expect(dug).toEqual([]);
  });

  it('the fourth stair step at 9 s digs with a pickaxe: its stones cost 4.5 s, not 22.5 s', async () => {
    const { ok, dug } = await stepAt(9_000, stairGrid(), true, (ctx, started) =>
      digStair(ctx.bot, ctx.signal, feet, EAST, false, started),
    );
    expect(ok).toBe(true);
    expect(dug).toEqual(['stone', 'stone', 'stone']);
  });

  it('the same stair step at 9 s is refused bare-handed: 22.5 s of hand time is over the 20 s left', async () => {
    const { ok, dug } = await stepAt(9_000, stairGrid(), false, (ctx, started) =>
      digStair(ctx.bot, ctx.signal, feet, EAST, false, started),
    );
    expect(ok).toBe(false);
    expect(dug).toEqual([]);
  });

  it('a stone dig-down at 24 s fits with a pickaxe (1.5 s) and is refused bare-handed (7.5 s)', async () => {
    const digIt = (ctx: ActionContext, started: number) =>
      digDown(ctx.bot, ctx.signal, feet, false, false, started);
    const held = await stepAt(24_000, floorGrid(), true, digIt);
    expect(held).toEqual({ ok: true, dug: ['stone'] });
    const bare = await stepAt(24_000, floorGrid(), false, digIt);
    expect(bare).toEqual({ ok: false, dug: [] });
  });

  it('a stone dig-down digs at exactly the time left (7.5 s at 21.5 s in) and is refused 1 ms later', async () => {
    const digIt = (ctx: ActionContext, started: number) =>
      digDown(ctx.bot, ctx.signal, feet, false, false, started);
    const exact = await stepAt(21_500, floorGrid(), false, digIt);
    expect(exact).toEqual({ ok: true, dug: ['stone'] });
    const late = await stepAt(21_501, floorGrid(), false, digIt);
    expect(late).toEqual({ ok: false, dug: [] });
  });

  it('refuses one block over the 25 s budget at the start of a call: obsidian is 250 s by hand', async () => {
    const grid: Grid = new Map([
      [key(0, 63, 0), 'obsidian'],
      [key(0, 62, 0), 'stone'],
    ]);
    const { ok, dug } = await stepAt(0, grid, false, (ctx, started) =>
      digDown(ctx.bot, ctx.signal, feet, false, false, started),
    );
    expect(ok).toBe(false);
    expect(dug).toEqual([]);
  });

  it('an elevated dig-down at 24 s is refused: the stone it digs is over the time left', async () => {
    const grid: Grid = new Map([
      [key(0, 63, 0), 'stone'],
      [key(0, 61, 0), 'stone'],
    ]);
    const { ok, dug } = await stepAt(24_000, grid, false, (ctx, started) =>
      digDown(ctx.bot, ctx.signal, feet, true, false, started),
    );
    expect(ok).toBe(false);
    expect(dug).toEqual([]);
  });

  it('the last-resort pass refuses a stair and a dig-down at 24 s', async () => {
    const stair = await stepAt(24_000, stairGrid(), false, (ctx, started) =>
      lastResortDig(ctx, () => feet, 0, started),
    );
    expect(stair).toEqual({ ok: false, dug: [] });
    const down = await stepAt(24_000, floorGrid(), false, (ctx, started) =>
      lastResortDig(ctx, () => feet, 0, started),
    );
    expect(down).toEqual({ ok: false, dug: [] });
  });

  it('the action timeout is the call limit in ms, so the two cannot drift apart', () => {
    expect(unstickAction.timeoutMs).toBe(ACTION_LIMIT_S * 1000);
  });
});

/** Zack's pillar (diag 2026-11-14): stone W and S, air N and E; the N floor is 3 blocks down, the E column is open. */
function zackGrid(): Grid {
  return new Map([
    [key(0, 63, 0), 'stone'],
    [key(-1, 63, 0), 'stone'],
    [key(-1, 64, 0), 'stone'],
    [key(-1, 65, 0), 'stone'],
    [key(0, 63, 1), 'stone'],
    [key(0, 64, 1), 'stone'],
    [key(0, 65, 1), 'stone'],
    [key(0, 60, -1), 'stone'],
  ]);
}

describe('unstick at low health and the hand dig (owner ruling 2026-11-14, decision 0183)', () => {
  afterEach(() => setOwnerLookup(null));

  it('takes a three-block drop at health 6.8 and digs nothing', async () => {
    const { bot, dug } = fakeBot(zackGrid(), 6.83);
    const outcome = await unstick(ctxOf(bot));
    expect(outcome).toMatchObject({ status: 'completed', detail: { method: 'drop' } });
    expect(dug).toEqual([]);
  });

  it('hand-digs out of a stone-walled pocket rather than take a four-block drop at health 6.8', async () => {
    const grid = boxedIn(() => 'stone');
    for (const dir of EIGHT) grid.set(key(dir.x, 62, dir.z), 'stone');
    for (let y = 60; y <= 65; y++) grid.delete(key(0, y, -1));
    grid.set(key(0, 59, -1), 'stone');
    const { bot, dug } = fakeBot(grid, 6.83);
    const outcome = await unstick(ctxOf(bot));
    expect(outcome).toMatchObject({ status: 'completed', detail: { method: 'stair_dig' } });
    expect(dug).toContain('stone');
  });

  it('lands in water from a one-block fall at health 7 and completes', async () => {
    const grid = island();
    grid.set(key(1, 62, 0), 'water');
    const { bot } = fakeBot(grid, 7);
    expect(await unstick(ctxOf(bot))).toMatchObject({
      status: 'completed',
      detail: { method: 'drop' },
    });
  });

  it('does not drop into water with lava under it', () => {
    const grid = island();
    grid.set(key(1, 62, 0), 'water');
    grid.set(key(1, 61, 0), 'lava');
    expect(planMoves((c) => blockOf(grid, c), feet, 20)).toEqual([]);
  });

  it('does not drop onto lava from a two-block fall at full health', async () => {
    const grid = island();
    grid.set(key(1, 61, 0), 'lava');
    expect(planMoves((c) => blockOf(grid, c), feet, 20)).toEqual([]);
    const { bot, dug } = fakeBot(grid);
    expect(await unstick(ctxOf(bot))).toMatchObject({ status: 'failed', reason: 'blocked' });
    expect(dug).toEqual([]);
  });

  it('does not dig stone owned by another player', async () => {
    ownedBy('Zack');
    const { bot, dug } = fakeBot(boxedIn(() => 'stone'));
    expect(await unstick(ctxOf(bot))).toMatchObject({ status: 'failed' });
    expect(dug).toEqual([]);
  });

  it('digs the hand-harvestable dirt before stone when both would work', async () => {
    const grid = boxedIn(() => 'stone');
    for (const y of [63, 64, 65]) grid.set(key(-1, y, 0), 'dirt');
    const { bot, dug } = fakeBot(grid);
    expect(await unstick(ctxOf(bot))).toMatchObject({
      status: 'completed',
      detail: { method: 'dig_sideways' },
    });
    expect(dug).toEqual(['dirt', 'dirt']);
  });
});

/** The stone pocket of the stair-dig test above: a three-block stair step is the first hand dig. */
function stonePocket(): Grid {
  const grid = boxedIn(() => 'stone');
  for (const dir of EIGHT) grid.set(key(dir.x, 62, dir.z), 'stone');
  for (let y = 60; y <= 65; y++) grid.delete(key(0, y, -1));
  grid.set(key(0, 59, -1), 'stone');
  return grid;
}

describe('unstick hand digs: abort, refusals and hardness (review 345, decision 0183)', () => {
  afterEach(() => setOwnerLookup(null));

  it('stops a hand dig on abort: no later cell, and no pathfinder call after the abort', async () => {
    const { bot, dug } = fakeBot(stonePocket(), 6.83);
    const pathfinder = { stop: vi.fn(), setGoal: vi.fn() };
    const controller = new AbortController();
    // A real dig waits until stopDigging, then completes: the block breaks before the stop lands. A dig
    // started after the abort fails at once, so a mutated unstick cannot hang the test.
    let endDig: () => void = () => undefined;
    Object.assign(bot, { pathfinder, stopDigging: () => endDig() });
    bot.dig = async (block: Block) => {
      dug.push(block.name);
      if (controller.signal.aborted) throw new Error('Digging aborted');
      await new Promise<void>((resolve) => {
        endDig = resolve;
      });
    };
    const running = unstick(ctxOf(bot, controller.signal));
    await vi.waitFor(() => expect(dug).toHaveLength(1));
    const stops = pathfinder.stop.mock.calls.length;
    const goals = pathfinder.setGoal.mock.calls.length;
    controller.abort();
    const outcome = await running;
    expect(outcome.status).toBe('cancelled');
    expect(dug).toEqual(['stone']);
    expect(pathfinder.stop).toHaveBeenCalledTimes(stops);
    expect(pathfinder.setGoal).toHaveBeenCalledTimes(goals);
  });

  it('does not hand-dig a stone cell with a liquid on a face (water above the ring)', async () => {
    const grid = boxedIn(() => 'stone');
    for (const dir of EIGHT) grid.set(key(dir.x, 66, dir.z), 'water');
    const { bot, dug } = fakeBot(grid);
    expect(await unstick(ctxOf(bot))).toMatchObject({ status: 'failed' });
    expect(dug).toEqual([]);
  });

  it('never hand-digs a block with hardness -1, though its name is not bedrock', async () => {
    const { bot, dug } = fakeBot(boxedIn(() => 'void_rock'));
    expect(await unstick(ctxOf(bot))).toMatchObject({ status: 'failed' });
    expect(dug).toEqual([]);
  });
});

describe('unstick last rung: the dig_descend gate (decision 0333)', () => {
  afterEach(() => {
    noSafe.value = undefined;
  });

  it('a high_ledge run starts dig_descend after the other rungs fail, though a safe move reads open', async () => {
    noSafe.value = false;
    const { bot } = fakeBot(island());
    const outcome = await unstick({ ...ctxOf(bot), highLedge: true });
    expect(JSON.stringify(outcome)).toContain('dig_descend');
  });

  it('an ordinary run with a safe move open does not start dig_descend', async () => {
    noSafe.value = false;
    const { bot, dug } = fakeBot(island());
    const outcome = await unstick(ctxOf(bot));
    expect(JSON.stringify(outcome)).not.toContain('dig_descend');
    expect(dug).toEqual([]);
  });

  it('an ordinary run whose exit is unknown (noSafeExit null) does not start dig_descend', async () => {
    noSafe.value = null;
    const { bot, dug } = fakeBot(island());
    const outcome = await unstick(ctxOf(bot));
    expect(JSON.stringify(outcome)).not.toContain('dig_descend');
    expect(dug).toEqual([]);
  });

  it('an ordinary run on a real 6 block ledge at health 18.5 reaches dig_descend (noSafeExit read from the terrain)', async () => {
    // Unbreakable walls and floor: the earlier rungs cannot dig a way off, so the run reaches the last rung.
    noSafe.value = undefined;
    const grid: Grid = new Map([...ledgeCells(6)].map((cell) => [cell, 'bedrock'] as const));
    const { bot } = fakeBot(grid, 18.5);
    const outcome = await unstick(ctxOf(bot));
    expect(JSON.stringify(outcome)).toContain('dig_descend');
  });

  it('an ordinary dead end (noSafeExit true, no other rung applies) starts dig_descend', async () => {
    noSafe.value = true;
    const { bot } = fakeBot(island());
    const outcome = await unstick(ctxOf(bot));
    expect(JSON.stringify(outcome)).toContain('dig_descend');
  });

  it('a rung that completes first leaves dig_descend unrun, even on a dead end', async () => {
    noSafe.value = true;
    const grid = island();
    grid.set(key(0, 63, 0), 'oak_leaves');
    grid.set(key(0, 61, 0), 'dirt');
    const { bot, dug } = fakeBot(grid);
    expect(await unstick(ctxOf(bot))).toMatchObject({
      status: 'completed',
      detail: { method: 'dig_down' },
    });
    expect(dug).toEqual(['oak_leaves']);
  });

  it('an ordinary run with a way out keeps its failure text: no dig_descend note', async () => {
    noSafe.value = false;
    const { bot } = fakeBot(island());
    expect(await unstick(ctxOf(bot))).toMatchObject({
      status: 'failed',
      reason: 'blocked',
      message: expect.stringMatching(
        /^unstick: no way out found; tried walk, dig_down, stair_dig, dig_sideways, dig_up, dig_unowned; \d+ s of the \d+ s limit used$/,
      ),
    });
  });
});
