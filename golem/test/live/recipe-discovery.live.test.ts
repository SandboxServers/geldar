import { randomBytes } from 'node:crypto';
import { validateActionRecord } from '@geldar/contract';
import type { Bot } from 'mineflayer';
import { describe, expect, it } from 'vitest';
import { hasUnlockedDisplay } from '../../src/actions/craft-table.ts';
import { createRegistry } from '../../src/actions/index.ts';
import { type ActionRun, runAction } from '../../src/actions/registry.ts';
import type { TestControl } from '../../src/test-control.ts';
import { resetBot, withLiveBot } from './fixture.ts';
import { recordFor } from './record.ts';

/** Reads how many of an item the bot carries. `clear <name> <item> 0` counts and removes nothing. */
async function carried(ctl: TestControl, name: string, item: string): Promise<number> {
  const reply = await ctl.command(`clear ${name} ${item} 0`);
  const match = /Found (\d+) matching item/.exec(reply);
  return match ? Number(match[1]) : 0;
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

/** What the bot and the server say about its recipes, for a failure message. */
async function state(
  bot: Bot,
  ctl: TestControl,
  count: () => number,
  items: string[],
): Promise<string> {
  const held: string[] = [];
  for (const item of items) held.push(`${item} x${await carried(ctl, bot.username, item)}`);
  return `unlocked recipes ${count()}; holds ${held.join(', ')}; ${bot.entity.position.floored()}`;
}

/** Waits up to about 6 s for an item's crafting display to be unlocked, logging the count. */
async function unlockedAfter(
  bot: Bot,
  item: string,
  count: () => number,
  step: string,
): Promise<boolean> {
  const found = bot.registry.itemsByName[item];
  if (!found) throw new Error(`${item} is not an item in the 26.1 registry`);
  const target = { id: found.id, name: item };
  for (let tick = 0; tick < 120 && !hasUnlockedDisplay(bot, target); tick += 4) {
    await bot.waitForTicks(4);
  }
  console.log(
    `recipe-discovery: after ${step}, ${count()} recipes unlocked; ${item} display known: ${hasUnlockedDisplay(bot, target)}`,
  );
  return hasUnlockedDisplay(bot, target);
}

/** Runs one craft through the registry, the way the Body does, and checks its record shape. */
async function craft(bot: Bot, item: string, count: number): Promise<ActionRun> {
  const args = { item, count };
  const run = await runAction(createRegistry(), bot, { do: 'craft', ...args });
  expect(validateActionRecord(recordFor('craft', args, run)).ok).toBe(true);
  return run;
}

/**
 * Recipe discovery (decision 0048): a fresh bot with its recipe state reset, and no plugin grant, unlocks
 * recipes only by playing. The bot name has never joined this world; `resetBot` with `recipes: true`
 * revokes the recipe advancements and takes the recipes, which vanilla unlocking needs (recipe unlock
 * diagnosis). Slot 2 is shared with the other craft files; the files run one after another.
 */
describe('recipe discovery through play', () => {
  it('unlocks planks, a table, sticks and a wooden pickaxe from logs alone', async () => {
    const name = `GolemDisc${randomBytes(3).toString('hex').slice(0, 5)}`;
    await withLiveBot({ name, slot: 2 }, async ({ bot, ctl, arena }) => {
      const recipes = countRecipes(bot);
      const cx = arena.center.x;
      const cy = arena.center.y;
      const cz = arena.center.z;
      await ctl.command(`kill @e[type=item,x=${cx},y=200,z=${cz},distance=..40]`);
      await ctl.clear(name);
      const restore = await resetBot(bot, ctl, { recipes: true });
      try {
        await bot.waitForTicks(20);
        console.log(`recipe-discovery: after reset, ${recipes()} recipes unlocked`);
        const items = ['oak_log', 'oak_planks', 'crafting_table', 'stick', 'wooden_pickaxe'];
        const here = () => state(bot, ctl, recipes, items);

        // Picking up logs unlocks the planks recipe.
        await ctl.give(name, 'oak_log', 3);
        expect(
          await unlockedAfter(bot, 'oak_planks', recipes, 'picking up logs'),
          `oak_planks was not unlocked by holding logs: ${await here()}`,
        ).toBe(true);
        const planks = await craft(bot, 'oak_planks', 12);
        expect(
          planks.state,
          `craft oak_planks ${JSON.stringify(planks.result)}: ${await here()}`,
        ).toBe('completed');
        expect(await carried(ctl, name, 'oak_planks')).toBe(12);

        // Holding planks unlocks the table and the sticks.
        expect(
          await unlockedAfter(bot, 'crafting_table', recipes, 'holding planks'),
          `crafting_table was not unlocked by holding planks: ${await here()}`,
        ).toBe(true);
        const table = await craft(bot, 'crafting_table', 1);
        expect(
          table.state,
          `craft crafting_table ${JSON.stringify(table.result)}: ${await here()}`,
        ).toBe('completed');
        const sticks = await craft(bot, 'stick', 4);
        expect(sticks.state, `craft stick ${JSON.stringify(sticks.result)}: ${await here()}`).toBe(
          'completed',
        );
        expect(await carried(ctl, name, 'stick')).toBe(4);

        // A placed table and sticks unlock the wooden pickaxe.
        const placed = await runAction(createRegistry(), bot, {
          do: 'place',
          block: 'crafting_table',
          at: { x: cx + 1, y: cy, z: cz },
        });
        expect(
          placed.state,
          `place crafting_table ${JSON.stringify(placed.result)}: ${await here()}`,
        ).toBe('completed');
        expect(
          await unlockedAfter(bot, 'wooden_pickaxe', recipes, 'holding sticks and planks'),
          `wooden_pickaxe was not unlocked by holding sticks and planks: ${await here()}`,
        ).toBe(true);
        const pickaxe = await craft(bot, 'wooden_pickaxe', 1);
        expect(
          pickaxe.state,
          `craft wooden_pickaxe ${JSON.stringify(pickaxe.result)}: ${await here()}`,
        ).toBe('completed');
        expect(await carried(ctl, name, 'wooden_pickaxe')).toBe(1);
        console.log(`recipe-discovery: finished with ${recipes()} recipes unlocked`);
      } finally {
        await restore();
      }
    });
  }, 240_000);

  it('fails a craft of a locked recipe with not_possible and unlocked false', async () => {
    const name = `GolemLock${randomBytes(3).toString('hex').slice(0, 5)}`;
    await withLiveBot({ name, slot: 2 }, async ({ bot, ctl, arena }) => {
      const recipes = countRecipes(bot);
      const cx = arena.center.x;
      const cy = arena.center.y;
      const cz = arena.center.z;
      await ctl.command(`kill @e[type=item,x=${cx},y=200,z=${cz},distance=..40]`);
      await ctl.clear(name);
      const restore = await resetBot(bot, ctl, { recipes: true });
      try {
        await ctl.setblock(cx + 2, cy, cz, 'crafting_table');
        await ctl.give(name, 'stick', 2);
        await bot.waitForTicks(40);
        // No cobblestone has been held, so stone_pickaxe is still locked.
        const run = await craft(bot, 'stone_pickaxe', 1);
        const seen = await state(bot, ctl, recipes, ['stick', 'cobblestone', 'stone_pickaxe']);
        expect(run.state, `craft stone_pickaxe ${JSON.stringify(run.result)}: ${seen}`).toBe(
          'failed',
        );
        expect(run.result, seen).toMatchObject({ status: 'failed', reason: 'not_possible' });
        expect(run.result.detail, seen).toMatchObject({ unlocked: false });
        expect(await carried(ctl, name, 'stone_pickaxe')).toBe(0);
      } finally {
        await restore();
      }
    });
  }, 180_000);
});
