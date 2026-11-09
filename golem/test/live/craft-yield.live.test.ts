import { randomBytes } from 'node:crypto';
import { validateActionRecord } from '@geldar/contract';
import type { Bot } from 'mineflayer';
import { describe, expect, it } from 'vitest';
import { hasUnlockedDisplay } from '../../src/actions/craft-table.ts';
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

/** Waits up to about 8 s for the join-time recipe grant to unlock the stick display. */
async function waitUnlocked(bot: Bot): Promise<boolean> {
  const item = bot.registry.itemsByName.stick;
  if (!item) throw new Error('stick is not an item in the 26.1 registry');
  const target = { id: item.id, name: 'stick' };
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
 * The craft yield, proved live (wave 4 live pass 2, finding L4). With every recipe granted, a stick has
 * a bamboo display (1 stick) and a planks display (4 sticks), and the 26.1 server's result slot does
 * not show what the shift-click moves. `craft stick count 4` must be one craft (2 planks, 4 sticks),
 * not four (all 8 planks, 16 sticks): the count is read from the inventory. Slot 2 is shared with
 * craft-grant.live.test.ts; the files run one after another.
 */
describe('craft yield from the inventory', () => {
  it('crafts exactly the sticks asked for, in the fewest crafts', async () => {
    const name = `GolemYield${randomBytes(3).toString('hex').slice(0, 5)}`;
    await withLiveBot({ name, slot: 2 }, async ({ bot, ctl, arena }) => {
      await ctl.command(
        `kill @e[type=item,x=${arena.center.x},y=200,z=${arena.center.z},distance=..40]`,
      );
      await ctl.clear(name);
      await ctl.give(name, 'oak_planks', 8);
      expect(
        await waitUnlocked(bot),
        'the plugin recipe grant did not unlock stick after join',
      ).toBe(true);
      await bot.waitForTicks(10);

      // One craft: 2 planks make 4 sticks. Four crafts would leave 16 sticks and no planks.
      const first = await craft(bot, 'stick', 4);
      expect(first.state).toBe('completed');
      expect(first.result.detail).toMatchObject({ item: 'stick', crafted: 4 });
      expect(await carried(ctl, name, 'stick')).toBe(4);
      expect(await carried(ctl, name, 'oak_planks')).toBe(6);

      // Two more crafts: 8 sticks from 4 planks, never a third.
      const second = await craft(bot, 'stick', 8);
      expect(second.state).toBe('completed');
      expect(second.result.detail).toMatchObject({ item: 'stick', crafted: 8 });
      expect(await carried(ctl, name, 'stick')).toBe(12);
      expect(await carried(ctl, name, 'oak_planks')).toBe(2);
      expect(bot.currentWindow).toBeNull();
    });
  }, 180_000);
});
