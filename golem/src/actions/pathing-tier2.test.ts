import minecraftData from 'minecraft-data';
import pathfinderPkg from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';
import { describe, expect, it, vi } from 'vitest';

import { applyDigRules, DigTally, digAllowed, MAX_DIG_TICKS } from './goto-dig.ts';
import { moveNear, TIER_TWO_BUDGET_MS } from './pathing.ts';
import { NO_PATH_TEXT } from './soft-dig.ts';

const { Movements } = pathfinderPkg;
const registry = minecraftData('1.21.4');

/** A world block as `bot.blockAt` returns it, from a name and the cells it is placed on. */
const cell = (name: string) => ({
  name,
  type: registry.blocksByName[name]?.id,
  boundingBox: name === 'air' || name === 'water' ? 'empty' : 'block',
  position: new Vec3(0, 0, 0),
});

/** A flat world of air: `solid` maps `x,y,z` to a block name; every other cell is air. */
function world(solid: Record<string, string>) {
  return (pos: Vec3) => {
    const name = solid[`${pos.x},${pos.y},${pos.z}`] ?? 'air';
    return { ...cell(name), position: pos };
  };
}

/** Movement facts for `digAllowed`: the cells around a block come from the same world. */
function movesOver(blockAt: (pos: Vec3) => ReturnType<typeof cell>) {
  return {
    getBlock: (pos: { x: number; y: number; z: number }, dx: number, dy: number, dz: number) => {
      const w = blockAt(new Vec3(pos.x + dx, pos.y + dy, pos.z + dz));
      return { liquid: w.name === 'water' || w.name === 'lava', canFall: w.name === 'sand' };
    },
    getNumEntitiesAt: () => 0,
  };
}

/**
 * A body standing at (0.5, 65, 0.5) above the block column x=0, z=0. Negative tests add solid
 * ground under the bot (`GROUND`), so the drop rule never refuses and only the rule under test can.
 */
function bodyOver(solid: Record<string, string>, extra: Record<string, unknown> = {}) {
  return {
    registry,
    username: 'self',
    entity: { position: new Vec3(0.5, 65, 0.5) },
    blockAt: world(solid),
    ...extra,
  } as never as Parameters<typeof digAllowed>[0];
}

/** Solid ground three cells under the dug column, so a floor dig drops nothing. */
const GROUND = { '0,63,0': 'stone', '0,62,0': 'stone', '0,61,0': 'stone' };

/** Checks `digAllowed` for the block at (0,64,0) named `name` on `solid`. */
function allowed(solid: Record<string, string>, name: string, extra: Record<string, unknown> = {}) {
  const bot = bodyOver(solid, extra);
  const block = { name, type: 1, position: new Vec3(0, 64, 0) };
  return digAllowed(bot, movesOver(world(solid)) as never, block);
}

describe('tier 2 movement settings (0164)', () => {
  it('digs at cost 4, towers with scaffolding, places at 2 and drops up to 3', () => {
    const bot = { registry, version: '1.21.4', blockAt: world({}), entity: {} } as never;
    const m = new Movements(bot) as unknown as Record<string, unknown>;
    applyDigRules(m, bot);
    expect(m.canDig).toBe(true);
    expect(m.digCost).toBe(4);
    expect(m.placeCost).toBe(2);
    expect(m.allow1by1towers).toBe(true);
    expect(m.maxDropDown).toBe(3);
    expect(m.liquidCost).toBe(3);
    expect(typeof m.safeToBreak).toBe('function');
    const ids = (m.scafoldingBlocks as number[]).slice().sort((a, b) => a - b);
    const want = ['dirt', 'cobblestone'].map((n) => registry.itemsByName[n]?.id);
    for (const id of want) expect(ids).toContain(id);
  });
});

describe('tier 2 dig safety (0164)', () => {
  it('lets a body dig a stone wall in a pit: only stone around', () => {
    const solid = { '0,64,0': 'stone', '0,65,1': 'stone', '1,64,0': 'stone', ...GROUND };
    expect(allowed(solid, 'stone')).toBe(true);
  });

  it('never digs built material by type: oak planks on the ground are refused', () => {
    expect(allowed({ '0,64,0': 'oak_planks', ...GROUND }, 'oak_planks')).toBe(false);
  });

  it('refuses the iron block, the smithing table and the piston standing alone', () => {
    for (const name of ['iron_block', 'smithing_table', 'piston']) {
      expect(allowed({ '0,64,0': name, ...GROUND }, name)).toBe(false);
    }
  });

  it('does not protect natural badlands terracotta or smooth basalt standing alone', () => {
    expect(allowed({ '0,64,0': 'white_terracotta', ...GROUND }, 'white_terracotta')).toBe(true);
    expect(allowed({ '0,64,0': 'smooth_basalt', ...GROUND }, 'smooth_basalt')).toBe(true);
  });

  it('protects a dirt block beside cobblestone (natural block in a built wall)', () => {
    const solid = { '0,64,0': 'dirt', '1,64,0': 'cobblestone', ...GROUND };
    expect(allowed(solid, 'dirt')).toBe(false);
  });

  it('refuses dirt with sand above it (a falling block would drop in)', () => {
    expect(allowed({ '0,64,0': 'dirt', '0,65,0': 'sand', ...GROUND }, 'dirt')).toBe(false);
  });

  it('refuses dirt with red sand or an anvil above it', () => {
    for (const name of ['red_sand', 'anvil']) {
      expect(allowed({ '0,64,0': 'dirt', '0,66,0': name, ...GROUND }, 'dirt')).toBe(false);
    }
  });

  it('refuses a block with liquid beside it', () => {
    expect(allowed({ '0,64,0': 'stone', '1,64,0': 'water', ...GROUND }, 'stone')).toBe(false);
  });

  it('refuses block entities and glass by name, on the ground', () => {
    for (const name of ['chest', 'oak_sign', 'glass', 'oak_door', 'furnace']) {
      expect(allowed({ '0,64,0': name, ...GROUND }, name)).toBe(false);
    }
  });

  it('refuses the floor under the bot when the drop is four blocks', () => {
    expect(allowed({ '0,64,0': 'stone', '0,60,0': 'stone' }, 'stone')).toBe(false);
  });

  it('allows the floor under the bot when the drop is three blocks', () => {
    expect(allowed({ '0,64,0': 'stone', '0,61,0': 'stone' }, 'stone')).toBe(true);
  });

  it('refuses a dig below the health gate', () => {
    expect(allowed({ '0,64,0': 'stone', ...GROUND }, 'stone', { health: 5 })).toBe(false);
    expect(allowed({ '0,64,0': 'stone', ...GROUND }, 'stone', { health: 20 })).toBe(true);
  });

  it('times the dig with the best tool the bot carries, not the held one', () => {
    const timed = (tool: unknown) => (tool === null ? 7500 : 1000);
    const block = (digTime: (tool: unknown) => number) => ({
      name: 'stone',
      type: 1,
      position: new Vec3(0, 64, 0),
      digTime,
    });
    const solid = { '0,64,0': 'stone', ...GROUND };
    const withPickaxe = bodyOver(solid, { pathfinder: { bestHarvestTool: () => ({ type: 9 }) } });
    expect(digAllowed(withPickaxe, movesOver(world(solid)) as never, block(timed))).toBe(true);
    const bare = bodyOver(solid);
    expect(digAllowed(bare, movesOver(world(solid)) as never, block(timed))).toBe(false);
  });

  it('skips a dig that takes longer than 3 s, and allows one at the limit', () => {
    const solid = { '0,64,0': 'stone', ...GROUND };
    const at = (ms: number) => ({
      name: 'stone',
      type: 1,
      position: new Vec3(0, 64, 0),
      digTime: () => ms,
    });
    const slow = bodyOver(solid);
    expect(digAllowed(slow, movesOver(world(solid)) as never, at((MAX_DIG_TICKS + 1) * 50))).toBe(
      false,
    );
    expect(digAllowed(slow, movesOver(world(solid)) as never, at(MAX_DIG_TICKS * 50))).toBe(true);
  });
});

/** A rejection as the library's pathfinder makes it, by error name. */
const rejectWith = (name: string) => () => Promise.reject(Object.assign(new Error(name), { name }));
const noPath = rejectWith('NoPath');
const timedOut = rejectWith('Timeout');

/**
 * A body with no pathfinder until `loadPlugin` (as the real plugin loads), whose `goto` answers
 * `first` then `second`. `setMovements` keeps `pathfinder.movements` current, as the library does.
 */
function pathBot(first: () => Promise<unknown>, second: () => Promise<unknown>) {
  const entity = { position: new Vec3(0.5, 65, 0.5), velocity: new Vec3(0, 0, 0) };
  const goto = vi.fn().mockImplementationOnce(first).mockImplementationOnce(second);
  const setMovements = vi.fn();
  const placeBlock = vi.fn(async () => undefined);
  const pathfinder: Record<string, unknown> = {
    goto,
    stop: vi.fn(),
    setGoal: vi.fn(),
    setMovements,
    isMining: () => false,
    goal: undefined,
  };
  setMovements.mockImplementation((m: unknown) => {
    pathfinder.movements = m;
  });
  const bot: Record<string, unknown> = {
    registry,
    version: '1.21.4',
    username: 'self',
    entity,
    time: { age: 0 },
    blockAt: world({}),
    placeBlock,
    on: vi.fn(),
    loadPlugin: vi.fn(() => {
      bot.pathfinder = pathfinder;
    }),
  };
  return { bot, entity, goto, setMovements, placeBlock, pathfinder };
}

/** A walk that arrives at `at` (the library's resolve after a real walk). */
const walkTo = (entity: { position: Vec3 }, at: Vec3) => () => {
  entity.position = at;
  return Promise.resolve();
};

const SIGNAL = new AbortController().signal;
const TARGET = { x: 4, y: 70, z: 4 };
const TARGET_VEC = new Vec3(4, 70, 4);

describe('goto tier 2 fallback (0164)', () => {
  it('switches to digging movements only after tier 1 finds no path', async () => {
    const { bot, goto, setMovements, entity } = pathBot(noPath, () => Promise.resolve());
    goto.mockImplementation(walkTo(entity, TARGET_VEC));
    const result = await moveNear(bot as never, TARGET, 1, { signal: SIGNAL, timeScale: 1 });
    expect(result.ok).toBe(true);
    expect(goto).toHaveBeenCalledTimes(2);
    const digging = setMovements.mock.calls.at(-1)?.[0] as { canDig: boolean } | undefined;
    expect(digging?.canDig).toBe(true);
  });

  it('enters tier 2 when tier 1 resolves an empty route without moving (a sealed pit)', async () => {
    const { bot, goto, setMovements, entity } = pathBot(
      () => Promise.resolve(),
      () => Promise.resolve(),
    );
    goto.mockImplementation(walkTo(entity, TARGET_VEC));
    const result = await moveNear(bot as never, TARGET, 1, { signal: SIGNAL, timeScale: 1 });
    expect(result.ok).toBe(true);
    expect(goto).toHaveBeenCalledTimes(2);
    const digging = setMovements.mock.calls.at(-1)?.[0] as { canDig: boolean } | undefined;
    expect(digging?.canDig).toBe(true);
  });

  it('never starts tier 2 when tier 1 walks to the goal', async () => {
    const { bot, goto, setMovements, entity } = pathBot(
      () => Promise.resolve(),
      () => Promise.resolve(),
    );
    goto.mockReset();
    goto.mockImplementation(walkTo(entity, TARGET_VEC));
    const result = await moveNear(bot as never, TARGET, 1, { signal: SIGNAL, timeScale: 1 });
    expect(result.ok).toBe(true);
    expect(goto).toHaveBeenCalledTimes(1);
    expect(setMovements).toHaveBeenCalledTimes(1);
  });

  it('never starts tier 2 for a reflex walk (digTier false)', async () => {
    const { bot, goto, setMovements } = pathBot(noPath, noPath);
    const result = await moveNear(bot as never, TARGET, 1, {
      signal: SIGNAL,
      timeScale: 1,
      digTier: false,
    });
    expect(result).toMatchObject({ ok: false, reason: 'blocked', message: NO_PATH_TEXT });
    expect(goto).toHaveBeenCalledTimes(1);
    expect(setMovements).toHaveBeenCalledTimes(1);
  });

  it('ends blocked with the fixed text when tier 2 also finds no path', async () => {
    const { bot, goto, setMovements } = pathBot(noPath, noPath);
    goto.mockImplementation(noPath);
    const result = await moveNear(bot as never, TARGET, 1, { signal: SIGNAL, timeScale: 1 });
    expect(result).toMatchObject({ ok: false, reason: 'blocked', message: NO_PATH_TEXT });
    // Setup, tier 2, then the plain movements put back for the next walk.
    // (The library defaults canDig to true, so tier 1 is told apart by its towers: off.)
    const last = setMovements.mock.calls.at(-1)?.[0] as { allow1by1towers: boolean } | undefined;
    expect(last?.allow1by1towers).toBe(false);
  });

  it('keeps the partial route when tier 2 times out, and caps tier 2 search time', async () => {
    let searchBudget = 0;
    const { bot, goto, pathfinder } = pathBot(noPath, () => {
      searchBudget = pathfinder.thinkTimeout as number;
      return timedOut();
    });
    goto.mockImplementationOnce(() => Promise.resolve());
    pathfinder.getPathTo = () => ({ status: 'partial', path: [{ x: 2, y: 65, z: 2 }] });
    const result = await moveNear(bot as never, TARGET, 1, { signal: SIGNAL, timeScale: 1 });
    expect(result).toMatchObject({ ok: true, partial: true });
    expect(searchBudget).toBe(TIER_TWO_BUDGET_MS);
    expect(goto).toHaveBeenCalledTimes(3);
  });

  it('puts the original placeBlock back when a tier-2 walk is cancelled', async () => {
    const controller = new AbortController();
    const { bot, goto } = pathBot(noPath, () => new Promise<void>(() => undefined));
    const original = bot.placeBlock;
    goto.mockImplementation(() => new Promise<void>(() => undefined));
    const pending = moveNear(bot as never, TARGET, 1, { signal: controller.signal, timeScale: 1 });
    await vi.waitFor(() => expect(goto).toHaveBeenCalledTimes(2));
    controller.abort();
    expect((await pending).ok).toBe(false);
    expect(bot.placeBlock).toBe(original);
  });

  it('puts the plain movements back for the next walk after a tier-2 walk', async () => {
    const { bot, goto, setMovements, entity } = pathBot(noPath, () => Promise.resolve());
    await moveNear(bot as never, TARGET, 1, { signal: SIGNAL, timeScale: 1 });
    expect(setMovements.mock.calls.at(-1)?.[0]).toMatchObject({ allow1by1towers: true });
    goto.mockImplementation(walkTo(entity, TARGET_VEC));
    await moveNear(bot as never, TARGET, 1, { signal: SIGNAL, timeScale: 1 });
    expect(setMovements.mock.calls.at(-1)?.[0]).toMatchObject({ allow1by1towers: false });
  });
});

/** A fake bot with a dig and a placement, as the library defines them (properties). */
interface TallyBot {
  dig: (...args: unknown[]) => Promise<unknown>;
  placeBlock: (...args: unknown[]) => Promise<unknown>;
  heldItem: { name: string } | null;
}
const tallyBot = (): TallyBot => ({
  dig: async () => undefined,
  placeBlock: async () => undefined,
  heldItem: null,
});

describe('goto completion text for tier 2 (0164)', () => {
  it('says what was dug and placed in words, with no digits', () => {
    const tally = new DigTally();
    expect(tally.note()).toBeUndefined();
    tally.dug = 2;
    tally.placed = ['dirt', 'dirt'];
    const text = tally.note() ?? '';
    expect(text).toBe('dug through two blocks and placed two dirt blocks to climb');
    expect(text).not.toMatch(/\d/);
  });

  it('names the placed block type and uses singular for one', () => {
    const tally = new DigTally();
    tally.dug = 1;
    tally.placed = ['cobbled deepslate'];
    expect(tally.note()).toBe(
      'dug through one block and placed one cobbled deepslate block to climb',
    );
  });

  it('counts digs through bot.dig and names each placed type', async () => {
    const bot = tallyBot();
    const dig = bot.dig;
    const tally = new DigTally();
    tally.start(bot as never);
    for (let i = 0; i < 3; i++) await bot.dig();
    bot.heldItem = { name: 'dirt' };
    await bot.placeBlock();
    await bot.placeBlock();
    bot.heldItem = { name: 'cobblestone' };
    await bot.placeBlock();
    tally.stop();
    expect(tally.note()).toBe(
      'dug through three blocks and placed two dirt blocks and one cobblestone block to climb',
    );
    expect(bot.dig).toBe(dig);
  });

  it('does not count a dig that fails, and stops counting after stop', async () => {
    const bot = tallyBot();
    bot.dig = async () => {
      throw new Error('aborted');
    };
    const tally = new DigTally();
    tally.start(bot as never);
    await expect(bot.dig()).rejects.toThrow('aborted');
    tally.stop();
    expect(tally.dug).toBe(0);
  });

  it('leaves a newer wrapper alone when an older tally stops first', async () => {
    const bot = tallyBot();
    const first = new DigTally();
    const second = new DigTally();
    first.start(bot as never);
    second.start(bot as never);
    first.stop();
    second.stop();
    await bot.placeBlock();
    expect(first.placed).toEqual([]);
    expect(second.placed).toEqual([]);
  });

  it('puts back the original dig and placeBlock when the first of two overlapping walks stops first', () => {
    const bot = tallyBot();
    const { dig, placeBlock } = bot;
    const first = new DigTally();
    const second = new DigTally();
    first.start(bot as never);
    second.start(bot as never);
    first.stop();
    second.stop();
    expect(bot.dig).toBe(dig);
    expect(bot.placeBlock).toBe(placeBlock);
  });

  it('puts back the original dig and placeBlock when a nested walk stops before the outer one', () => {
    const bot = tallyBot();
    const { dig, placeBlock } = bot;
    const outer = new DigTally();
    const inner = new DigTally();
    outer.start(bot as never);
    inner.start(bot as never);
    inner.stop();
    outer.stop();
    expect(bot.dig).toBe(dig);
    expect(bot.placeBlock).toBe(placeBlock);
  });

  it('keeps counting digs for the walk still running after the other one stops', async () => {
    const bot = tallyBot();
    const first = new DigTally();
    const second = new DigTally();
    first.start(bot as never);
    second.start(bot as never);
    first.stop();
    await bot.dig();
    second.stop();
    expect(first.dug).toBe(0);
    expect(second.dug).toBe(1);
  });
});

describe('a stalled tier-1 walk recovers into tier 2 (0164)', () => {
  it('starts digging movements on the first stall recovery, after the stall ticks', async () => {
    vi.useFakeTimers();
    try {
      const { bot, goto, setMovements } = pathBot(
        () => new Promise(() => undefined),
        () => new Promise(() => undefined),
      );
      goto.mockImplementation(() => new Promise(() => undefined));
      const controller = new AbortController();
      const move = moveNear(bot as never, TARGET, 1, {
        signal: controller.signal,
        timeScale: 1,
        stallTicks: 600,
        diag: { log: () => undefined, now: () => Date.now() },
      });
      const before = setMovements.mock.calls.some(
        ([m]) => (m as { digCost?: number }).digCost === 4,
      );
      // The bot stands still for 10 watchdog steps of 10 ticks: past the 60-tick recovery.
      for (let i = 0; i < 12; i++) {
        (bot as unknown as { time: { age: number } }).time.age += 10;
        await vi.advanceTimersByTimeAsync(500);
      }
      const digging = setMovements.mock.calls.some(
        ([m]) => (m as { digCost?: number }).digCost === 4,
      );
      controller.abort();
      await move;
      expect(before).toBe(false);
      expect(digging).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
