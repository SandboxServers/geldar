import { randomBytes } from 'node:crypto';
import { validateActionRecord } from '@geldar/contract';
import type { Bot } from 'mineflayer';
import { describe, expect, it } from 'vitest';
import { hasUnlockedDisplay, type TableTarget } from '../../src/actions/craft-table.ts';
import { createRegistry } from '../../src/actions/index.ts';
import { type ActionRun, runAction } from '../../src/actions/registry.ts';
import type { TestControl } from '../../src/test-control.ts';
import { withLiveBot } from './fixture.ts';
import { recordFor } from './record.ts';

/** Reads how many of an item the bot carries. `clear <name> <item> 0` counts and removes nothing. */
async function carried(ctl: TestControl, name: string, item: string): Promise<number> {
  const reply = await ctl.command(`clear ${name} ${item} 0`);
  const match = /Found (\d+) matching item/.exec(reply);
  return match ? Number(match[1]) : 0;
}

/** The craft target for an item name, from the 26.1 registry. */
function targetOf(bot: Bot, name: string): TableTarget {
  const item = bot.registry.itemsByName[name];
  if (!item) throw new Error(`${name} is not an item in the 26.1 registry`);
  return { id: item.id, name };
}

/** Waits up to about 8 s for the join-time recipe grant to unlock an item's crafting display. */
async function waitUnlocked(bot: Bot, name: string): Promise<boolean> {
  const target = targetOf(bot, name);
  for (let tick = 0; tick < 160; tick += 4) {
    if (hasUnlockedDisplay(bot, target)) return true;
    await bot.waitForTicks(4);
  }
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
 * The Geldar-Core recipe grant, proved live (decision 0032): the plugin discovers every recipe when
 * the player joins, so a table craft works with NO RCON `recipe give`. The bot gets a name that
 * has never joined this world (the server keeps the recipe book per player), so the only possible
 * source of the book is the plugin. Slot 2 is shared with craft.live.test.ts; the files run one
 * after another.
 */
describe('recipe grant by Geldar-Core', () => {
  it('crafts a crafting_table and then a stone_pickaxe with no recipe give', async () => {
    const name = `GolemGrant${randomBytes(3).toString('hex').slice(0, 5)}`;
    await withLiveBot({ name, slot: 2 }, async ({ bot, ctl, arena }) => {
      const cx = arena.center.x;
      const cy = arena.center.y;
      const cz = arena.center.z;
      await ctl.command(`kill @e[type=item,x=${cx},y=200,z=${cz},distance=..40]`);
      await ctl.clear(name);
      await ctl.give(name, 'oak_planks', 4);
      expect(
        await waitUnlocked(bot, 'crafting_table'),
        'the plugin recipe grant did not unlock crafting_table after join',
      ).toBe(true);
      await bot.waitForTicks(10);

      const table = await craft(bot, 'crafting_table', 1);
      expect(table.state).toBe('completed');
      expect(await carried(ctl, name, 'crafting_table')).toBe(1);

      // The pickaxe needs a table in reach and its ingredients; giving items does not unlock a recipe.
      await ctl.setblock(cx + 2, cy, cz, 'crafting_table');
      await ctl.give(name, 'cobblestone', 3);
      await ctl.give(name, 'stick', 2);
      expect(
        await waitUnlocked(bot, 'stone_pickaxe'),
        'the plugin recipe grant did not unlock stone_pickaxe after join',
      ).toBe(true);
      const pickaxe = await craft(bot, 'stone_pickaxe', 1);
      expect(pickaxe.result).toMatchObject({ status: 'completed' });
      expect(pickaxe.result.detail).toMatchObject({ item: 'stone_pickaxe', used_table: true });
      expect(await carried(ctl, name, 'stone_pickaxe')).toBe(1);
      expect(bot.currentWindow).toBeNull();
    });
  }, 180_000);
});
