import type { Bot } from 'mineflayer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Block } from './bot-types.ts';
import { craftAction, diagnoseCraft } from './craft.ts';
import { bookYield, craftFromBook, hasUnlockedDisplay } from './craft-table.ts';
import { cancelled, failed } from './outcome.ts';
import { moveNear } from './pathing.ts';

// The moves are the pathfinder's; a fake bot has none, so the tests only check the arguments.
vi.mock('./pathing.ts', () => ({ moveNear: vi.fn() }));
// The recipe-book path talks to the protocol client, which a fake bot does not have. Its own tests
// cover it. By default no display is unlocked, so a 2x2 craft falls back to bot.craft.
vi.mock('./craft-table.ts', () => ({
  craftFromBook: vi.fn(async () => null),
  hasUnlockedDisplay: vi.fn(() => false),
  bookYield: vi.fn(() => 1),
}));

const DEFS = [
  { id: 1, name: 'wooden_pickaxe' },
  { id: 5, name: 'oak_planks' },
  { id: 6, name: 'oak_log' },
  { id: 7, name: 'stick' },
  { id: 10, name: 'cobblestone' },
  { id: 12, name: 'blackstone' },
  { id: 20, name: 'bedrock' },
];

interface FakeRecipe {
  result: { id: number; count: number };
  delta: { id: number; count: number; metadata: number | null }[];
  requiresTable: boolean;
}

/** A recipe that takes `inputs` (id to count) and gives `count` of `result`. */
function recipe(
  result: number,
  count: number,
  inputs: Record<number, number>,
  requiresTable = false,
): FakeRecipe {
  const delta = Object.entries(inputs).map(([id, n]) => ({
    id: Number(id),
    count: -n,
    metadata: null,
  }));
  return { result: { id: result, count }, delta, requiresTable };
}

/**
 * A fake bot with the craft surface: `recipesFor` and `recipesAll` filter the given recipes the
 * way Mineflayer does, `craft` moves items between the counts, and the window is a plain flag.
 */
function fakeBot(opts: {
  recipes: FakeRecipe[];
  inventory?: Record<number, number>;
  table?: Block;
}) {
  const counts = new Map(Object.entries(opts.inventory ?? {}).map(([id, n]) => [Number(id), n]));
  const state = { currentWindow: null as object | null };
  const have = (id: number): number => counts.get(id) ?? 0;
  const feasible = (r: FakeRecipe, min: number): boolean => {
    const times = Math.ceil(min / r.result.count);
    return r.delta.every((d) => d.count >= 0 || have(d.id) + d.count * times >= 0);
  };
  const craft = vi.fn(async (r: FakeRecipe) => {
    for (const d of r.delta) counts.set(d.id, have(d.id) + d.count);
    counts.set(r.result.id, have(r.result.id) + r.result.count);
  });
  const closeWindow = vi.fn(async (_window: object) => {
    state.currentWindow = null;
  });
  const bot = {
    registry: {
      items: Object.fromEntries(DEFS.map((d) => [d.id, d])),
      itemsByName: Object.fromEntries(DEFS.map((d) => [d.name, d])),
      blocksByName: { crafting_table: { id: 58 } },
    },
    inventory: { count: (id: number) => have(id) },
    findBlock: vi.fn(() => opts.table ?? null),
    recipesFor: (id: number, _meta: unknown, min: number | null, station: unknown) =>
      opts.recipes.filter(
        (r) => r.result.id === id && (!r.requiresTable || station) && feasible(r, min ?? 1),
      ),
    recipesAll: (id: number, _meta: unknown, station: unknown) =>
      opts.recipes.filter((r) => r.result.id === id && (!r.requiresTable || station)),
    craft,
    get currentWindow() {
      return state.currentWindow;
    },
    closeWindow,
    waitForTicks: vi.fn(async () => {}),
  };
  // `give` adds items as the server would, late: the inventory moves outside the craft's own clicks.
  const give = (id: number, n: number): void => {
    counts.set(id, have(id) + n);
  };
  return { bot: bot as unknown as Bot, state, craft, closeWindow, give };
}

/** A table block at a fixed spot. Only `position` is read. */
const TABLE = { position: { x: 1, y: 200, z: 3 } } as unknown as Block;

/** Runs the handler with a fresh signal. timeScale 0.01 keeps the bounded inventory wait short. */
function run(bot: Bot, item: string, count: number, signal = new AbortController().signal) {
  return craftAction.run({ bot, signal, timeScale: 0.01 }, { do: 'craft', item, count });
}

beforeEach(() => {
  vi.mocked(moveNear).mockReset();
  vi.mocked(moveNear).mockResolvedValue({ ok: true, distance: 1 });
});

describe('craftAction', () => {
  it('crafts oak_planks 5 as two crafts of four, and reports the eight it made', async () => {
    const planks = recipe(5, 4, { 6: 1 });
    const fake = fakeBot({ recipes: [planks], inventory: { 6: 2 } });
    const out = await run(fake.bot, 'oak_planks', 5);
    expect(fake.craft).toHaveBeenCalledTimes(2);
    expect(out).toEqual({
      status: 'completed',
      detail: { item: 'oak_planks', crafted: 8, used_table: false },
    });
  });

  it('walks to the table and hands a table recipe to the table path, not bot.craft', async () => {
    const pickaxe = recipe(1, 1, { 10: 3, 7: 2 }, true);
    const fake = fakeBot({
      recipes: [pickaxe],
      inventory: { 10: 3, 7: 2 },
      table: TABLE,
    });
    vi.mocked(craftFromBook).mockImplementationOnce(async () => {
      await fake.craft(pickaxe);
      return null;
    });
    const out = await run(fake.bot, 'wooden_pickaxe', 1);
    expect(moveNear).toHaveBeenCalledWith(fake.bot, TABLE.position, 3, expect.anything());
    expect(craftFromBook).toHaveBeenCalledWith(
      expect.anything(),
      { id: 1, name: 'wooden_pickaxe' },
      1,
      TABLE,
    );
    expect(fake.craft).toHaveBeenCalledTimes(1);
    expect(out).toMatchObject({
      status: 'completed',
      detail: { item: 'wooden_pickaxe', crafted: 1, used_table: true },
    });
  });

  it('crafts a 2x2 recipe through the recipe book at window 0 when its display is unlocked', async () => {
    const planks = recipe(5, 4, { 6: 1 });
    const fake = fakeBot({ recipes: [planks], inventory: { 6: 1 } });
    vi.mocked(hasUnlockedDisplay).mockReturnValueOnce(true);
    vi.mocked(bookYield).mockReturnValueOnce(4);
    vi.mocked(craftFromBook).mockImplementationOnce(async () => {
      fake.give(5, 4);
      return null;
    });
    const out = await run(fake.bot, 'oak_planks', 4);
    expect(craftFromBook).toHaveBeenCalledWith(
      expect.anything(),
      { id: 5, name: 'oak_planks' },
      1,
      null,
    );
    expect(fake.craft).not.toHaveBeenCalled();
    expect(out).toMatchObject({ status: 'completed', detail: { used_table: false, crafted: 4 } });
  });

  it('sizes the book crafts by the display yield, and completes only when the count asked is made', async () => {
    // The recipe says 4 per craft, the display makes 2: two crafts of 2 make the 4 asked.
    const planks = recipe(5, 4, { 6: 1 });
    const fake = fakeBot({ recipes: [planks], inventory: { 6: 2 } });
    vi.mocked(hasUnlockedDisplay).mockReturnValueOnce(true);
    vi.mocked(bookYield).mockReturnValueOnce(2);
    vi.mocked(craftFromBook).mockImplementationOnce(async () => {
      fake.give(5, 4);
      return null;
    });
    const out = await run(fake.bot, 'oak_planks', 4);
    expect(craftFromBook).toHaveBeenCalledWith(expect.anything(), expect.anything(), 2, null);
    expect(out).toMatchObject({ status: 'completed', detail: { crafted: 4 } });
  });

  it('fails internal, not completed, when a book craft makes less than the count asked', async () => {
    // A stick from planks is 4 per craft, but a bamboo display makes 1: four crafts are needed.
    const sticks = recipe(7, 4, { 5: 2 });
    const fake = fakeBot({ recipes: [sticks], inventory: { 5: 2 } });
    vi.mocked(hasUnlockedDisplay).mockReturnValueOnce(true);
    vi.mocked(bookYield).mockReturnValueOnce(1);
    vi.mocked(craftFromBook).mockImplementationOnce(async () => {
      // One craft of the four ran, and made its 1.
      fake.give(7, 1);
      return null;
    });
    const out = await run(fake.bot, 'stick', 4);
    expect(craftFromBook).toHaveBeenCalledWith(expect.anything(), expect.anything(), 4, null);
    expect(out).toMatchObject({
      status: 'failed',
      reason: 'internal',
      detail: { item: 'stick', crafted: 1 },
    });
  });

  it('keeps the crafted count when a recipe-book craft is cancelled', async () => {
    const planks = recipe(5, 4, { 6: 1 });
    const fake = fakeBot({ recipes: [planks], inventory: { 6: 2 } });
    vi.mocked(hasUnlockedDisplay).mockReturnValueOnce(true);
    vi.mocked(craftFromBook).mockImplementationOnce(async () => {
      fake.give(5, 4);
      return cancelled();
    });
    const out = await run(fake.bot, 'oak_planks', 8);
    expect(out).toMatchObject({ status: 'cancelled', detail: { item: 'oak_planks', crafted: 4 } });
  });

  it('keeps the crafted count when a recipe-book craft times out', async () => {
    const planks = recipe(5, 4, { 6: 1 });
    const fake = fakeBot({ recipes: [planks], inventory: { 6: 2 } });
    vi.mocked(hasUnlockedDisplay).mockReturnValueOnce(true);
    vi.mocked(craftFromBook).mockImplementationOnce(async () => {
      fake.give(5, 4);
      return failed('timeout', 'the crafting table did not produce oak_planks');
    });
    const out = await run(fake.bot, 'oak_planks', 8);
    expect(out).toMatchObject({ status: 'failed', reason: 'timeout', detail: { crafted: 4 } });
  });

  it('prefers the cobblestone variant when two variants tie, whatever their index', async () => {
    const blackstone = recipe(1, 1, { 12: 3, 7: 2 });
    const cobble = recipe(1, 1, { 10: 3, 7: 2 });
    const fake = fakeBot({
      recipes: [blackstone, cobble],
      inventory: { 10: 3, 12: 3, 7: 2 },
    });
    await run(fake.bot, 'wooden_pickaxe', 1);
    expect(fake.craft.mock.calls[0]?.[0]).toBe(cobble);
  });

  it('gives invalid_args for an item the registry does not know', async () => {
    const fake = fakeBot({ recipes: [] });
    const out = await run(fake.bot, 'not_an_item', 1);
    expect(out).toMatchObject({ status: 'failed', reason: 'invalid_args' });
    expect(fake.craft).not.toHaveBeenCalled();
  });

  it('reports the shortfall times the craft count when the inventory is short', async () => {
    // Four per craft, so five needs two crafts: six cobblestone against one held, five short.
    const planks = recipe(5, 4, { 10: 3 });
    const fake = fakeBot({ recipes: [planks], inventory: { 10: 1 } });
    const out = await run(fake.bot, 'oak_planks', 5);
    expect(fake.craft).not.toHaveBeenCalled();
    expect(out).toMatchObject({
      status: 'failed',
      reason: 'missing_materials',
      detail: { missing: { cobblestone: 5 } },
    });
  });

  it('stops the loop on abort and closes the window it left open', async () => {
    const log = recipe(5, 1, { 6: 1 });
    const fake = fakeBot({ recipes: [log], inventory: { 6: 3 } });
    const controller = new AbortController();
    const window = { type: 'minecraft:crafting' };
    fake.craft.mockImplementationOnce(async () => {
      fake.state.currentWindow = window;
      controller.abort();
    });
    const out = await run(fake.bot, 'oak_planks', 3, controller.signal);
    expect(fake.craft).toHaveBeenCalledTimes(1);
    expect(fake.closeWindow).toHaveBeenCalledWith(window);
    expect(fake.state.currentWindow).toBeNull();
    expect(out.status).toBe('cancelled');
  });

  it('fails internal, not completed, when the server gave back nothing', async () => {
    const planks = recipe(5, 4, { 6: 1 });
    const fake = fakeBot({ recipes: [planks], inventory: { 6: 2 } });
    fake.craft.mockImplementationOnce(async () => undefined);
    const out = await run(fake.bot, 'oak_planks', 4);
    expect(out).toMatchObject({
      status: 'failed',
      reason: 'internal',
      detail: { item: 'oak_planks', crafted: 0 },
    });
  });

  it('closes a window left open after a completed craft too', async () => {
    const log = recipe(5, 4, { 6: 1 });
    const fake = fakeBot({ recipes: [log], inventory: { 6: 1 } });
    fake.craft.mockImplementationOnce(async () => {
      fake.state.currentWindow = {};
    });
    await run(fake.bot, 'oak_planks', 4);
    expect(fake.closeWindow).toHaveBeenCalledTimes(1);
  });

  it('reports completed once the product reaches the inventory, even when it arrives late', async () => {
    const stick = recipe(7, 4, { 5: 2 }, true);
    const fake = fakeBot({ recipes: [stick], inventory: { 5: 2 }, table: TABLE });
    // The server's correction lands 12 ticks after the craft: past a fixed settle of a few ticks.
    let ticks = 0;
    vi.mocked(fake.bot.waitForTicks).mockImplementation(async () => {
      ticks += 1;
      if (ticks === 12) fake.give(7, 4);
    });
    const out = await run(fake.bot, 'stick', 4);
    expect(out).toMatchObject({ status: 'completed', detail: { item: 'stick', crafted: 4 } });
  });

  it('fails internal once the bounded wait runs out with no product in the inventory', async () => {
    const stick = recipe(7, 4, { 5: 2 }, true);
    const fake = fakeBot({ recipes: [stick], inventory: { 5: 2 }, table: TABLE });
    const out = await run(fake.bot, 'stick', 4);
    expect(out).toMatchObject({ status: 'failed', reason: 'internal', detail: { crafted: 0 } });
  });

  it('keeps the completed outcome when closing the window fails', async () => {
    const log = recipe(5, 4, { 6: 1 });
    const fake = fakeBot({ recipes: [log], inventory: { 6: 1 } });
    fake.state.currentWindow = {};
    fake.closeWindow.mockRejectedValueOnce(new Error('connection gone'));
    const out = await run(fake.bot, 'oak_planks', 4);
    expect(out).toMatchObject({ status: 'completed', detail: { crafted: 4 } });
  });
});

describe('diagnoseCraft', () => {
  const item = { id: 1, name: 'wooden_pickaxe' };

  it('says not_possible when no recipe exists at all', () => {
    const bot = { recipesAll: () => [] } as unknown as Bot;
    expect(diagnoseCraft(bot, { id: 20, name: 'bedrock' }, null, 1)).toMatchObject({
      status: 'failed',
      reason: 'not_possible',
    });
  });

  it('says missing_station for a table-only recipe with no table in reach', () => {
    // Falsy station (no table): none; truthy station (a table): the table recipe.
    const bot = {
      recipesAll: (_id: number, _m: unknown, station: unknown) =>
        station ? [recipe(1, 1, {})] : [],
      inventory: { count: () => 0 },
      registry: { items: {} },
    } as unknown as Bot;
    expect(diagnoseCraft(bot, item, null, 1)).toMatchObject({
      status: 'failed',
      reason: 'missing_station',
    });
  });

  it('says missing_materials, not missing_station, when a table is in reach', () => {
    const bot = {
      recipesAll: (_id: number, _m: unknown, station: unknown) =>
        station ? [recipe(1, 1, { 10: 3 }, true)] : [],
      inventory: { count: () => 0 },
      registry: { items: { 10: { id: 10, name: 'cobblestone' } } },
    } as unknown as Bot;
    expect(diagnoseCraft(bot, item, TABLE, 1)).toMatchObject({
      status: 'failed',
      reason: 'missing_materials',
      detail: { missing: { cobblestone: 3 } },
    });
  });
});
