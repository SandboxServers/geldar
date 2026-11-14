import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Block } from './bot-types.ts';
import { digAllowed } from './goto-dig.ts';
import { setOwnerLookup } from './protected-blocks.ts';
import type { ActionContext } from './registry.ts';
import { DEFAULT_DIAG_SINK } from './stall-diag.ts';
import { dropAllowed, EIGHT, MAX_DROP, planMoves, scanDrop, unstick } from './unstick.ts';

type Grid = Map<string, string>;
const key = (x: number, y: number, z: number): string => `${x},${y},${z}`;

/** Blocks a bare hand cannot drop: stone needs a pickaxe. */
const NEEDS_TOOL = new Set(['stone']);

/**
 * A block grid: unlisted cells are air (empty), `water` is empty-boxed, the rest are solid. `bedrock` has
 * hardness -1 (no hand breaks it); `stone` lists a harvest tool (a bare hand digs it and drops nothing).
 */
function blockOf(grid: Grid, cell: Vec3): Block | null {
  const name = grid.get(key(cell.x, cell.y, cell.z)) ?? 'air';
  if (name === 'unloaded') return null;
  const boundingBox = name === 'air' || name === 'water' ? 'empty' : 'block';
  const hardness = name === 'bedrock' ? -1 : 1.5;
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
const breachLines = (log: { mock: { calls: unknown[][] } }): string[] =>
  log.mock.calls.map((call) => String(call[0])).filter((line) => line.includes('unstick_breach'));

describe('unstick last resort (owner ruling 2026-11-13)', () => {
  afterEach(() => setOwnerLookup(null));

  it('digs a known-unowned planks wall and logs the breach', async () => {
    ownedBy(null);
    const { bot, dug } = fakeBot(boxedIn(() => 'oak_planks'));
    const log = vi.spyOn(DEFAULT_DIAG_SINK, 'log');
    const outcome = await unstick(ctxOf(bot));
    expect(dug).toContain('oak_planks');
    expect(outcome.status).toBe('completed');
    expect(outcome.status === 'completed' && outcome.detail.method).toBe('dig_unowned');
    const lines = breachLines(log);
    expect(lines).toHaveLength(dug.length);
    // The sideways dig takes the head cell (y 65) first, then the feet cell (y 64).
    expect(lines.map((line) => JSON.parse(line))).toContainEqual(
      expect.objectContaining({
        event: 'unstick_breach',
        block: 'oak_planks',
        x: 1,
        z: 0,
        dimension: 'minecraft:the_nether',
      }),
    );
    log.mockRestore();
  });

  it('does not dig planks whose ownership is unknown (the query failed)', async () => {
    setOwnerLookup(() => ({ known: false }));
    const { bot, dug } = fakeBot(boxedIn(() => 'oak_planks'));
    const log = vi.spyOn(DEFAULT_DIAG_SINK, 'log');
    const outcome = await unstick(ctxOf(bot));
    expect(dug).toEqual([]);
    expect(outcome.status).toBe('failed');
    expect(outcome.status === 'failed' && outcome.message).toContain('no way out');
    expect(breachLines(log)).toEqual([]);
    log.mockRestore();
  });

  it('does not dig planks owned by another player', async () => {
    ownedBy('Zack');
    const { bot, dug } = fakeBot(boxedIn(() => 'oak_planks'));
    const outcome = await unstick(ctxOf(bot));
    expect(dug).toEqual([]);
    expect(outcome.status).toBe('failed');
  });

  it('digs planks the bot placed itself (its own record)', async () => {
    ownedBy('Ranger');
    const { bot, dug } = fakeBot(boxedIn(() => 'oak_planks'));
    (bot as unknown as { username: string }).username = 'Ranger';
    const outcome = await unstick(ctxOf(bot));
    expect(dug).toContain('oak_planks');
    expect(outcome.status).toBe('completed');
  });

  it('goto-dig still refuses the same planks, however the ownership reads', () => {
    ownedBy(null);
    const { bot } = fakeBot(boxedIn(() => 'oak_planks'));
    const planks = { name: 'oak_planks', position: new Vec3(1, 64, 0) } as never;
    expect(digAllowed(bot as unknown as Bot, {} as never, planks)).toBe(false);
  });

  it('never digs a door, even in the last-resort pass', async () => {
    ownedBy(null);
    const ring = (dir: Vec3) => (dir.x === 0 || dir.z === 0 ? 'oak_door' : 'oak_planks');
    const { bot, dug } = fakeBot(boxedIn(ring));
    const outcome = await unstick(ctxOf(bot));
    expect(dug.filter((name) => name === 'oak_door')).toEqual([]);
    expect(outcome.status).toBe('failed');
  });
});

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

  it('never drops at low health when the fall does damage', () => {
    expect(dropAllowed(11, { blocks: 4, lands: 'solid' })).toBe(false);
    expect(dropAllowed(4, { blocks: 0, lands: 'water' })).toBe(true);
    expect(dropAllowed(12, { blocks: 4, lands: 'solid' })).toBe(true);
    expect(dropAllowed(20, { blocks: MAX_DROP, lands: 'solid' })).toBe(true);
    expect(dropAllowed(20, { blocks: MAX_DROP + 1, lands: 'solid' })).toBe(false);
    expect(dropAllowed(20, { blocks: 2, lands: 'unsafe' })).toBe(false);
  });

  it('takes a fall of three blocks or less onto solid ground, and a fall into water, at any health', () => {
    expect(dropAllowed(6.83, { blocks: 3, lands: 'solid' })).toBe(true);
    expect(dropAllowed(1, { blocks: 3, lands: 'solid' })).toBe(true);
    expect(dropAllowed(1, { blocks: 4, lands: 'solid' })).toBe(false);
    expect(dropAllowed(6.83, { blocks: 3, lands: 'unsafe' })).toBe(false);
    expect(dropAllowed(6.83, { blocks: 2, lands: 'unsafe' })).toBe(false);
    expect(dropAllowed(7, { blocks: 1, lands: 'water' })).toBe(true);
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
    grid.set(key(1, 59, 0), 'dirt');
    expect(planMoves((c) => blockOf(grid, c), feet, 20)).toEqual([
      { dir: EIGHT[0], jump: false, drop: 4 },
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

  it("refuses to dig someone else's work on the way out: dirt beside built planks stays", async () => {
    // The dirt under the feet touches planks below it (built, not this bot's): a dig-down would dig it.
    const grid = island();
    grid.set(key(0, 63, 0), 'dirt');
    grid.set(key(0, 62, 0), 'oak_planks');
    grid.set(key(0, 61, 0), 'dirt');
    const { bot, dug } = fakeBot(grid);
    expect(await unstick(ctxOf(bot))).toMatchObject({ status: 'failed', reason: 'blocked' });
    expect(dug).toEqual([]);
  });

  it('does not dig down at low health, over lava, or through bedrock', async () => {
    const soft = island();
    soft.set(key(0, 63, 0), 'oak_leaves');
    soft.set(key(0, 59, 0), 'dirt');
    // Health 2: a fall of 4 blocks is not survivable (the controlled dig-down rule, C1-13).
    const low = fakeBot(soft, 2);
    expect(await unstick(ctxOf(low.bot))).toMatchObject({ status: 'failed', reason: 'blocked' });
    expect(low.dug).toEqual([]);

    const lava = island();
    lava.set(key(0, 63, 0), 'oak_leaves');
    lava.set(key(0, 62, 0), 'lava');
    const burning = fakeBot(lava);
    expect(await unstick(ctxOf(burning.bot))).toMatchObject({ status: 'failed' });
    expect(burning.dug).toEqual([]);

    // Owner ruling 2026-11-14 (decision 0183): a hand digs any breakable block, so stone under the feet is
    // dug; bedrock (hardness -1) is never dug.
    const bedrock = island();
    bedrock.set(key(0, 63, 0), 'bedrock');
    const floor = fakeBot(bedrock);
    expect(await unstick(ctxOf(floor.bot))).toMatchObject({ status: 'failed' });
    expect(floor.dug).toEqual([]);
  });

  it('names every step it tried in the no_way_out diag line', async () => {
    const { bot } = fakeBot(island());
    const sink = vi.spyOn(DEFAULT_DIAG_SINK, 'log').mockImplementation(() => undefined);
    try {
      expect(await unstick(ctxOf(bot))).toMatchObject({ status: 'failed' });
      const lines = sink.mock.calls.map(([text]) => JSON.parse(text) as Record<string, unknown>);
      expect(lines.find((l) => l.reason === 'no_way_out')).toMatchObject({
        tried: ['walk', 'dig_down', 'stair_dig', 'dig_sideways', 'dig_unowned'],
        health: 20,
        drops: expect.arrayContaining([{ dir: [1, 0], blocks: 7, lands: 'unsafe' }]),
      });
    } finally {
      sink.mockRestore();
    }
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
