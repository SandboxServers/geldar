import { describe, expect, it } from 'vitest';
import { createPerception } from '../../src/perception/index.ts';
import { resetBot, withLiveBot } from './fixture.ts';

/** The arena slot for this file and the bot that plays it. Written, not run (no docker in wave 5). */
const SLOT = 4;
const BOT = 'GolemSense';

describe('perception: authorized surroundings against a real server', () => {
  it('shows a chest in view and a placed table, hides a chest behind a wall, lists unlocked recipes', async () => {
    await withLiveBot({ name: BOT, slot: SLOT }, async ({ bot, ctl, arena }) => {
      const restore = await resetBot(bot, ctl);
      try {
        const { x: cx, z: cz } = arena.center;
        const y = Math.floor(bot.entity.position.y);
        const here = bot.entity.position.floored();
        // A chest 4 blocks east in view; a chest 6 blocks west behind a stone wall 3 blocks west.
        await ctl.setblock(here.x + 4, y + 1, here.z, 'chest');
        await ctl.setblock(here.x - 6, y + 1, here.z, 'chest');
        await ctl.fill(
          { x: here.x - 3, y, z: here.z - 1 },
          { x: here.x - 3, y: y + 3, z: here.z + 1 },
          'stone',
        );
        await bot.waitForTicks(10);

        const perception = createPerception(bot);
        const seen = perception.surroundings();
        const state = `bot at ${bot.entity.position}; arena (${cx}, ${cz}); saw ${JSON.stringify(seen)}`;
        expect(
          seen.notable_blocks.some(
            (b) => b.type === 'chest' && b.x === here.x + 4 && b.z === here.z,
          ),
          `the chest in view is missing: ${state}`,
        ).toBe(true);
        expect(
          seen.notable_blocks.some((b) => b.type === 'chest' && b.x === here.x - 6),
          `the chest behind the wall was reported: ${state}`,
        ).toBe(false);

        await ctl.setblock(here.x, y + 1, here.z + 3, 'crafting_table');
        await bot.waitForTicks(10);
        const withTable = perception.surroundings();
        expect(
          withTable.notable_blocks.some((b) => b.type === 'crafting_table' && b.z === here.z + 3),
          `the placed crafting table is missing: ${JSON.stringify(withTable)}`,
        ).toBe(true);

        await ctl.give(BOT, 'oak_log', 4);
        let recipes = perception.unlockedRecipes();
        for (let tick = 0; tick < 160 && !recipes.includes('oak_planks'); tick += 4) {
          await bot.waitForTicks(4);
          recipes = perception.unlockedRecipes();
        }
        expect(
          recipes,
          `oak_planks is not unlocked; the list has ${recipes.length} names`,
        ).toContain('oak_planks');
      } finally {
        await restore();
      }
    });
  });
});
