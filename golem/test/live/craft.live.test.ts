import { validateActionRecord } from '@geldar/contract';
import type { Bot } from 'mineflayer';
import { describe, expect, it } from 'vitest';
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

/**
 * Unlocks every recipe for the bot so a table craft can find its recipe display. Test setup only:
 * the Body never uses RCON, and a real bot unlocks recipes by holding the ingredients.
 */
async function unlockRecipes(ctl: TestControl, name: string): Promise<void> {
  await ctl.command(`recipe give ${name} *`);
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
      await bot.waitForTicks(10);
      const run = await craft(bot, 'oak_planks', 8);
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
      await bot.waitForTicks(10);
      const run = await craft(bot, 'crafting_table', 1);
      expect(run.state).toBe('completed');
      expect(await carried(ctl, 'GolemCraft', 'crafting_table')).toBe(1);
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
      await unlockRecipes(ctl, 'GolemCraft');
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
      await unlockRecipes(ctl, 'GolemCraft');
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
      await unlockRecipes(ctl, 'GolemCraft');
      await bot.waitForTicks(10);
      const run = await craft(bot, 'white_bed', 1);
      expect(run.state).toBe('completed');
      expect(await carried(ctl, 'GolemCraft', 'white_bed')).toBe(1);
      expect(bot.currentWindow).toBeNull();
    });
  }, 180_000);
});
