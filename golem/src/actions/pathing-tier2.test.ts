import minecraftData from 'minecraft-data';
import pathfinderPkg from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';
import { describe, expect, it, vi } from 'vitest';

import { applyDigRules, DigTally, digAllowed, MAX_DIG_TICKS } from './goto-dig.ts';
import { moveNear } from './pathing.ts';
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

/** A body standing at (0.5, 65, 0.5) above the block column x=0, z=0. */
function bodyOver(solid: Record<string, string>, digTime?: (b: unknown) => number) {
  const blockAt = world(solid);
  return {
    registry,
    username: 'self',
    entity: { position: new Vec3(0.5, 65, 0.5) },
    blockAt,
    digTime,
  } as never as Parameters<typeof digAllowed>[0];
}

/** A stone wall block at (0,64,0) in the open: the basic tier-2 dig. */
const STONE_AT = { '0,64,0': 'stone' };

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
    const ids = (m.scafoldingBlocks as number[]).slice().sort((a, b) => a - b);
    const want = ['dirt', 'cobblestone'].map((n) => registry.itemsByName[n]?.id);
    for (const id of want) expect(ids).toContain(id);
  });
});

describe('tier 2 dig safety (0164)', () => {
  it('lets a body dig a stone wall in a pit: only stone around', () => {
    const solid = { ...STONE_AT, '0,65,1': 'stone', '1,64,0': 'stone', '0,63,0': 'stone' };
    const bot = bodyOver(solid);
    expect(
      digAllowed(bot, movesOver(world(solid)) as never, {
        name: 'stone',
        type: 1,
        position: new Vec3(0, 64, 0),
      }),
    ).toBe(true);
  });

  it('never digs built material by type: oak planks are never in the dig set', () => {
    const solid = { '0,64,0': 'oak_planks' };
    const bot = bodyOver(solid);
    const block = { name: 'oak_planks', type: 1, position: new Vec3(0, 64, 0) };
    expect(digAllowed(bot, movesOver(world(solid)) as never, block)).toBe(false);
  });

  it('protects a dirt block beside cobblestone (natural block in a built wall)', () => {
    const solid = { '0,64,0': 'dirt', '1,64,0': 'cobblestone' };
    const bot = bodyOver(solid);
    const block = { name: 'dirt', type: 1, position: new Vec3(0, 64, 0) };
    expect(digAllowed(bot, movesOver(world(solid)) as never, block)).toBe(false);
  });

  it('refuses dirt with sand above it (a falling block would drop in)', () => {
    const solid = { '0,64,0': 'dirt', '0,65,0': 'sand' };
    const bot = bodyOver(solid);
    const block = { name: 'dirt', type: 1, position: new Vec3(0, 64, 0) };
    expect(digAllowed(bot, movesOver(world(solid)) as never, block)).toBe(false);
  });

  it('refuses a block with liquid beside it', () => {
    const solid = { ...STONE_AT, '1,64,0': 'water' };
    const bot = bodyOver(solid);
    expect(
      digAllowed(bot, movesOver(world(solid)) as never, {
        name: 'stone',
        type: 1,
        position: new Vec3(0, 64, 0),
      }),
    ).toBe(false);
  });

  it('refuses block entities and glass by name', () => {
    for (const name of ['chest', 'oak_sign', 'glass', 'oak_door', 'furnace']) {
      const solid = { '0,64,0': name };
      const bot = bodyOver(solid);
      expect(
        digAllowed(bot, movesOver(world(solid)) as never, {
          name,
          type: 1,
          position: new Vec3(0, 64, 0),
        }),
      ).toBe(false);
    }
  });

  it('refuses the floor under the bot when the drop is past three blocks', () => {
    const solid = { ...STONE_AT };
    const bot = bodyOver(solid);
    expect(
      digAllowed(bot, movesOver(world(solid)) as never, {
        name: 'stone',
        type: 1,
        position: new Vec3(0, 64, 0),
      }),
    ).toBe(false);
  });

  it('allows the floor under the bot when the drop is two blocks', () => {
    const solid = { ...STONE_AT, '0,61,0': 'stone' };
    const bot = bodyOver(solid);
    expect(
      digAllowed(bot, movesOver(world(solid)) as never, {
        name: 'stone',
        type: 1,
        position: new Vec3(0, 64, 0),
      }),
    ).toBe(true);
  });

  it('skips a dig that takes longer than 3 s with the held tool, and allows one at the limit', () => {
    const solid = { ...STONE_AT, '0,63,0': 'stone' };
    const block = { name: 'stone', type: 1, position: new Vec3(0, 64, 0) };
    const slow = bodyOver(solid, () => (MAX_DIG_TICKS + 1) * 50);
    expect(digAllowed(slow, movesOver(world(solid)) as never, block)).toBe(false);
    const limit = bodyOver(solid, () => MAX_DIG_TICKS * 50);
    expect(digAllowed(limit, movesOver(world(solid)) as never, block)).toBe(true);
  });
});

/** A body whose pathfinder fails the first walk with `NoPath`, then answers from `second`. */
function pathBot(second: () => Promise<void>) {
  const goto = vi
    .fn()
    .mockImplementationOnce(() =>
      Promise.reject(Object.assign(new Error('no path'), { name: 'NoPath' })),
    )
    .mockImplementationOnce(second);
  const setMovements = vi.fn();
  const placeBlock = vi.fn(async () => undefined);
  const bot = {
    registry,
    version: '1.21.4',
    username: 'self',
    entity: { position: new Vec3(0.5, 65, 0.5), velocity: new Vec3(0, 0, 0) },
    time: { age: 0 },
    blockAt: world({}),
    placeBlock,
    on: vi.fn(),
    pathfinder: {
      goto,
      stop: vi.fn(),
      setGoal: vi.fn(),
      setMovements,
      isMining: () => false,
      goal: undefined,
    },
  };
  return { bot, goto, setMovements, placeBlock };
}

const SIGNAL = new AbortController().signal;
const TARGET = { x: 4, y: 70, z: 4 };

describe('goto tier 2 fallback (0164)', () => {
  it('switches to digging movements only after tier 1 finds no path', async () => {
    const { bot, goto, setMovements } = pathBot(() => Promise.resolve());
    const result = await moveNear(bot as never, TARGET, 1, { signal: SIGNAL, timeScale: 1 });
    expect(result.ok).toBe(true);
    expect(goto).toHaveBeenCalledTimes(2);
    expect(setMovements).toHaveBeenCalledTimes(1);
    expect((setMovements.mock.calls[0]?.[0] as { canDig: boolean } | undefined)?.canDig).toBe(true);
  });

  it('never starts tier 2 when tier 1 walks', async () => {
    const { bot, goto, setMovements } = pathBot(() => Promise.resolve());
    goto.mockReset();
    goto.mockImplementation(() => Promise.resolve());
    const result = await moveNear(bot as never, TARGET, 1, { signal: SIGNAL, timeScale: 1 });
    expect(result.ok).toBe(true);
    expect(setMovements).not.toHaveBeenCalled();
  });

  it('ends blocked with the fixed text when tier 2 also finds no path', async () => {
    const noPath = () => Promise.reject(Object.assign(new Error('no path'), { name: 'NoPath' }));
    const { bot, goto, setMovements } = pathBot(noPath);
    goto.mockImplementation(noPath);
    const result = await moveNear(bot as never, TARGET, 1, { signal: SIGNAL, timeScale: 1 });
    expect(result).toMatchObject({ ok: false, reason: 'blocked', message: NO_PATH_TEXT });
    expect(setMovements).toHaveBeenCalledTimes(1);
  });

  it('puts the original placeBlock back when a tier-2 walk is cancelled', async () => {
    const controller = new AbortController();
    const { bot, goto } = pathBot(() => new Promise<void>(() => undefined));
    const original = bot.placeBlock;
    goto.mockImplementation(() => new Promise<void>(() => undefined));
    const pending = moveNear(bot as never, TARGET, 1, { signal: controller.signal, timeScale: 1 });
    await vi.waitFor(() => expect(goto).toHaveBeenCalledTimes(2));
    controller.abort();
    expect((await pending).ok).toBe(false);
    expect(bot.placeBlock).toBe(original);
  });
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
});
