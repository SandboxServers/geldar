import { validateActionRecord } from '@geldar/contract';
import type { Bot } from 'mineflayer';
import { describe, expect, it } from 'vitest';
import { hasUnlockedDisplay, type TableTarget } from '../../src/actions/craft-table.ts';
import { createRegistry } from '../../src/actions/index.ts';
import { type ActionRun, runAction } from '../../src/actions/registry.ts';
import type { TestControl } from '../../src/test-control.ts';
import { unlockAllRecipes, withLiveBot } from './fixture.ts';
import { recordFor } from './record.ts';

/** Reads how many of an item the bot carries. `clear <name> <item> 0` counts and removes nothing. */
async function carried(ctl: TestControl, name: string, item: string): Promise<number> {
  const reply = await ctl.command(`clear ${name} ${item} 0`);
  const match = /Found (\d+) matching item/.exec(reply);
  return match ? Number(match[1]) : 0;
}

/**
 * Waits up to about 4 s for the server's recipe_book_add to unlock an item's crafting display, and
 * reports whether it did.
 */
async function waitUnlocked(bot: Bot, name: string): Promise<boolean> {
  const target = targetOf(bot, name);
  for (let tick = 0; tick < 80; tick += 4) {
    if (hasUnlockedDisplay(bot, target)) return true;
    await bot.waitForTicks(4);
  }
  return hasUnlockedDisplay(bot, target);
}

/** Counts the recipes the server has unlocked for the bot since this call, from its recipe book packets. */
function countRecipes(bot: Bot): () => number {
  const known = new Set<number>();
  const client = bot._client as unknown as {
    on(event: string, fn: (packet: unknown) => void): void;
  };
  client.on('recipe_book_add', (packet) => {
    const { replace, entries } = packet as {
      replace: boolean;
      entries: { recipe: { displayId?: number } }[];
    };
    if (replace) known.clear();
    for (const { recipe } of entries) {
      if (typeof recipe.displayId === 'number') known.add(recipe.displayId);
    }
  });
  client.on('recipe_book_remove', (packet) => {
    for (const id of (packet as { recipeIds?: number[] }).recipeIds ?? []) known.delete(id);
  });
  return () => known.size;
}

/**
 * Sets up "this one recipe is not in the book while its ingredients are held". The ingredients come
 * first because vanilla unlocks a recipe as soon as they are held; only then is that recipe taken.
 * Asserts the precondition, naming the unlocked count and the held items on failure.
 */
async function lockRecipeAfterGive(
  bot: Bot,
  ctl: TestControl,
  recipes: () => number,
  gives: [item: string, count: number][],
  recipe: string,
): Promise<void> {
  for (const [item, count] of gives) await ctl.give('GolemCraft', item, count);
  await bot.waitForTicks(40);
  await ctl.recipeTakeOne('GolemCraft', recipe);
  await bot.waitForTicks(20);
  const held: string[] = [];
  for (const [item] of gives) held.push(`${item} x${await carried(ctl, 'GolemCraft', item)}`);
  expect(
    hasUnlockedDisplay(bot, targetOf(bot, recipe)),
    `${recipe} still in the book after recipe take: ${recipes()} recipes unlocked; holds ${held.join(', ')}`,
  ).toBe(false);
}

/** The craft target for an item name, from the 26.1 registry. */
function targetOf(bot: Bot, name: string): TableTarget {
  const item = bot.registry.itemsByName[name];
  if (!item) throw new Error(`${name} is not an item in the 26.1 registry`);
  return { id: item.id, name };
}

/** Clears item entities left by an earlier case in the arena (they are not blocks). */
async function clearDrops(ctl: TestControl, cx: number, cz: number): Promise<void> {
  await ctl.command(`kill @e[type=item,x=${cx},y=200,z=${cz},distance=..40]`);
}

/** Runs one craft through the registry, the way the Body does, and checks its record shape. */
async function craft(bot: Bot, item: string, count: number): Promise<ActionRun> {
  const args = { item, count };
  const run = await runAction(createRegistry(), bot, { do: 'craft', ...args });
  expect(validateActionRecord(recordFor('craft', args, run)).ok).toBe(true);
  return run;
}

/**
 * Pathing and crafting on 26.1 in slot 2 (GolemCraft). Each case gives exactly what it needs and
 * confirms the inventory through RCON, not through the bot's own model.
 */
describe('craft on 26.1', () => {
  it('crafts oak_planks 8 from two logs', async () => {
    await withLiveBot({ name: 'GolemCraft', slot: 2 }, async ({ bot, ctl, arena }) => {
      await clearDrops(ctl, arena.center.x, arena.center.z);
      await ctl.clear('GolemCraft');
      await ctl.give('GolemCraft', 'oak_log', 2);
      await unlockAllRecipes(ctl, 'GolemCraft');
      expect(
        await waitUnlocked(bot, 'oak_planks'),
        'recipe_book_add for oak_planks did not arrive after recipe give',
      ).toBe(true);
      await bot.waitForTicks(10);
      const run = await craft(bot, 'oak_planks', 8);
      expect(run.result).toMatchObject({ status: 'completed' });
      expect(run.state).toBe('completed');
      expect(run.result.detail).toMatchObject({ item: 'oak_planks', used_table: false });
      expect(Number(run.result.detail.crafted)).toBeGreaterThanOrEqual(8);
      expect(await carried(ctl, 'GolemCraft', 'oak_planks')).toBeGreaterThanOrEqual(8);
      expect(bot.currentWindow).toBeNull();
    });
  }, 180_000);

  it('crafts stick 4 from two planks', async () => {
    await withLiveBot({ name: 'GolemCraft', slot: 2 }, async ({ bot, ctl, arena }) => {
      await clearDrops(ctl, arena.center.x, arena.center.z);
      await ctl.clear('GolemCraft');
      await ctl.give('GolemCraft', 'oak_planks', 2);
      await unlockAllRecipes(ctl, 'GolemCraft');
      expect(
        await waitUnlocked(bot, 'stick'),
        'recipe_book_add for stick did not arrive after recipe give',
      ).toBe(true);
      await bot.waitForTicks(10);
      const run = await craft(bot, 'stick', 4);
      expect(run.state).toBe('completed');
      expect(await carried(ctl, 'GolemCraft', 'stick')).toBe(4);
    });
  }, 180_000);

  it('crafts a crafting_table without a table in reach', async () => {
    await withLiveBot({ name: 'GolemCraft', slot: 2 }, async ({ bot, ctl, arena }) => {
      await clearDrops(ctl, arena.center.x, arena.center.z);
      await ctl.clear('GolemCraft');
      await ctl.give('GolemCraft', 'oak_planks', 4);
      await unlockAllRecipes(ctl, 'GolemCraft');
      expect(
        await waitUnlocked(bot, 'crafting_table'),
        'recipe_book_add for crafting_table did not arrive after recipe give',
      ).toBe(true);
      await bot.waitForTicks(10);
      const run = await craft(bot, 'crafting_table', 1);
      expect(run.state).toBe('completed');
      expect(await carried(ctl, 'GolemCraft', 'crafting_table')).toBe(1);
    });
  }, 180_000);

  it('falls back to bot.craft for planks once the recipe book has no planks display', async () => {
    await withLiveBot({ name: 'GolemCraft', slot: 2 }, async ({ bot, ctl, arena }) => {
      await clearDrops(ctl, arena.center.x, arena.center.z);
      await ctl.clear('GolemCraft');
      // Holding logs unlocks planks in vanilla, so take just that recipe after the give.
      const recipes = countRecipes(bot);
      await lockRecipeAfterGive(bot, ctl, recipes, [['oak_log', 2]], 'oak_planks');
      const run = await craft(bot, 'oak_planks', 4);
      expect(run.state).toBe('completed');
      expect(run.result.detail).toMatchObject({ item: 'oak_planks', used_table: false });
      expect(await carried(ctl, 'GolemCraft', 'oak_planks')).toBeGreaterThanOrEqual(4);
      expect(bot.currentWindow).toBeNull();
    });
  }, 180_000);

  it('says missing_station for a wooden_pickaxe with no table anywhere near', async () => {
    await withLiveBot({ name: 'GolemCraft', slot: 2 }, async ({ bot, ctl, arena }) => {
      await clearDrops(ctl, arena.center.x, arena.center.z);
      await ctl.clear('GolemCraft');
      await ctl.give('GolemCraft', 'oak_planks', 3);
      await ctl.give('GolemCraft', 'stick', 2);
      await bot.waitForTicks(10);
      const run = await craft(bot, 'wooden_pickaxe', 1);
      expect(run.state).toBe('failed');
      expect(run.result).toMatchObject({ status: 'failed', reason: 'missing_station' });
      expect(await carried(ctl, 'GolemCraft', 'wooden_pickaxe')).toBe(0);
      expect(await carried(ctl, 'GolemCraft', 'oak_planks')).toBe(3);
    });
  }, 180_000);

  it('walks to a table 20 blocks away and crafts with it', async () => {
    await withLiveBot({ name: 'GolemCraft', slot: 2 }, async ({ bot, ctl, arena }) => {
      const cx = arena.center.x;
      const cy = arena.center.y;
      const cz = arena.center.z;
      await clearDrops(ctl, cx, cz);
      await ctl.clear('GolemCraft');
      await ctl.give('GolemCraft', 'oak_planks', 3);
      await ctl.give('GolemCraft', 'stick', 2);
      // The table is 20 blocks east of the bot, so the walk alone takes longer than 60 ticks.
      await ctl.setblock(cx + 10, cy, cz, 'crafting_table');
      await ctl.tp('GolemCraft', cx - 10, cy + 1, cz);
      await unlockAllRecipes(ctl, 'GolemCraft');
      await bot.waitForTicks(10);
      const run = await craft(bot, 'wooden_pickaxe', 1);
      expect(run.state).toBe('completed');
      expect(run.result.detail).toMatchObject({ used_table: true });
      expect(typeof run.result.world_ticks).toBe('number');
      expect(await carried(ctl, 'GolemCraft', 'wooden_pickaxe')).toBe(1);
      expect(bot.currentWindow).toBeNull();
    });
  }, 180_000);

  it('says missing_materials with 3 cobblestone short for a stone_pickaxe at a table', async () => {
    await withLiveBot({ name: 'GolemCraft', slot: 2 }, async ({ bot, ctl, arena }) => {
      const cx = arena.center.x;
      const cy = arena.center.y;
      const cz = arena.center.z;
      await clearDrops(ctl, cx, cz);
      await ctl.clear('GolemCraft');
      await ctl.setblock(cx + 2, cy, cz, 'crafting_table');
      await unlockAllRecipes(ctl, 'GolemCraft');
      await bot.waitForTicks(10);
      const run = await craft(bot, 'stone_pickaxe', 1);
      expect(run.state).toBe('failed');
      expect(run.result).toMatchObject({ status: 'failed', reason: 'missing_materials' });
      expect(run.result.detail).toMatchObject({ missing: { cobblestone: 3 } });
    });
  }, 180_000);

  it('says missing_station for a stone_pickaxe with no table', async () => {
    await withLiveBot({ name: 'GolemCraft', slot: 2 }, async ({ bot, ctl, arena }) => {
      await clearDrops(ctl, arena.center.x, arena.center.z);
      await ctl.clear('GolemCraft');
      await bot.waitForTicks(10);
      const run = await craft(bot, 'stone_pickaxe', 1);
      expect(run.state).toBe('failed');
      expect(run.result).toMatchObject({ status: 'failed', reason: 'missing_station' });
    });
  }, 180_000);

  it('says not_possible for bedrock', async () => {
    await withLiveBot({ name: 'GolemCraft', slot: 2 }, async ({ bot, ctl, arena }) => {
      await clearDrops(ctl, arena.center.x, arena.center.z);
      await ctl.clear('GolemCraft');
      await bot.waitForTicks(10);
      const run = await craft(bot, 'bedrock', 1);
      expect(run.state).toBe('failed');
      expect(run.result).toMatchObject({ status: 'failed', reason: 'not_possible' });
    });
  }, 180_000);

  it('crafts a white_bed from wool and planks at a table in reach', async () => {
    await withLiveBot({ name: 'GolemCraft', slot: 2 }, async ({ bot, ctl, arena }) => {
      const cx = arena.center.x;
      const cy = arena.center.y;
      const cz = arena.center.z;
      await clearDrops(ctl, cx, cz);
      await ctl.clear('GolemCraft');
      await ctl.give('GolemCraft', 'white_wool', 3);
      await ctl.give('GolemCraft', 'oak_planks', 3);
      await ctl.setblock(cx + 2, cy, cz, 'crafting_table');
      await unlockAllRecipes(ctl, 'GolemCraft');
      await bot.waitForTicks(10);
      const run = await craft(bot, 'white_bed', 1);
      expect(run.state).toBe('completed');
      expect(await carried(ctl, 'GolemCraft', 'white_bed')).toBe(1);
      expect(bot.currentWindow).toBeNull();
    });
  }, 180_000);

  // These cases are about the locked outcome and the table craft, not discovery (that is
  // recipe-discovery.live.test.ts): they reset and unlock the recipe book through RCON, and the Body never does.
  it('does not craft wooden_pickaxe from its ingredients while the recipe is not in the book', async () => {
    await withLiveBot({ name: 'GolemCraft', slot: 2 }, async ({ bot, ctl, arena }) => {
      const cx = arena.center.x;
      const cy = arena.center.y;
      const cz = arena.center.z;
      await clearDrops(ctl, cx, cz);
      await ctl.clear('GolemCraft');
      const recipes = countRecipes(bot);
      await ctl.setblock(cx + 2, cy, cz, 'crafting_table');
      // Holding the ingredients unlocks the recipe in vanilla, so take just that recipe after the give.
      await lockRecipeAfterGive(
        bot,
        ctl,
        recipes,
        [
          ['oak_planks', 3],
          ['stick', 2],
        ],
        'wooden_pickaxe',
      );
      const run = await craft(bot, 'wooden_pickaxe', 1);
      expect(run.state).toBe('failed');
      expect(run.result).toMatchObject({ status: 'failed', reason: 'not_possible' });
      expect(run.result.detail).toMatchObject({ unlocked: false });
      expect(await carried(ctl, 'GolemCraft', 'wooden_pickaxe')).toBe(0);
      expect(await carried(ctl, 'GolemCraft', 'oak_planks')).toBe(3);
    });
  }, 180_000);

  it('crafts wooden_pickaxe at a table once the shard grants the recipe book', async () => {
    await withLiveBot({ name: 'GolemCraft', slot: 2 }, async ({ bot, ctl, arena }) => {
      const cx = arena.center.x;
      const cy = arena.center.y;
      const cz = arena.center.z;
      await clearDrops(ctl, cx, cz);
      await ctl.clear('GolemCraft');
      await ctl.setblock(cx + 2, cy, cz, 'crafting_table');
      await ctl.give('GolemCraft', 'oak_planks', 3);
      await ctl.give('GolemCraft', 'stick', 2);
      await unlockAllRecipes(ctl, 'GolemCraft');
      expect(
        await waitUnlocked(bot, 'wooden_pickaxe'),
        'recipe_book_add for wooden_pickaxe did not arrive after recipe give',
      ).toBe(true);
      const run = await craft(bot, 'wooden_pickaxe', 1);
      expect(run.result).toMatchObject({ status: 'completed' });
      expect(run.result.detail).toMatchObject({ used_table: true });
      expect(await carried(ctl, 'GolemCraft', 'wooden_pickaxe')).toBe(1);
      expect(bot.currentWindow).toBeNull();
    });
  }, 180_000);
});
