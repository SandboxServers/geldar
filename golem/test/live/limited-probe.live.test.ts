import { describe, expect, it } from 'vitest';
import { createRegistry } from '../../src/actions/index.ts';
import { runAction } from '../../src/actions/registry.ts';
import { wakeBot } from '../../src/actions/wake.ts';
import { limitedControl } from '../../src/bench/limited-control.ts';
import { withLiveBot } from './fixture.ts';

/** The arena slot for this file and the bot that plays it. */
const SLOT = 8;
const BOT = 'GolemProbe';

const registry = createRegistry();

describe('limited control reads against a real server', () => {
  it('blockIs reads the arena floor', async () => {
    await withLiveBot({ name: BOT, slot: SLOT }, async ({ ctl, arena }) => {
      const limited = limitedControl(ctl);
      const { x, z } = arena.center;
      // The platform is stone_bricks one block below the arena center.
      const y = arena.center.y - 1;
      expect(await limited.blockIs(x, y, z, 'minecraft:stone_bricks')).toBe(true);
      expect(await limited.blockIs(x, y, z, 'stone_bricks')).toBe(true);
      expect(await limited.blockIs(x, y, z, 'minecraft:stone')).toBe(false);
      expect(await limited.blockIs(x, y, z, 'minecraft:bedrock')).toBe(false);
    });
  });

  it('isSleeping follows the bot from awake to asleep, for either case of the name', async () => {
    await withLiveBot({ name: BOT, slot: SLOT }, async ({ bot, ctl, arena }) => {
      const limited = limitedControl(ctl);
      const { x: cx, z: cz } = arena.center;
      expect(await limited.isSleeping(BOT)).toBe(false);
      expect(await limited.isSleeping(BOT.toLowerCase())).toBe(false);

      await ctl.command(`kill @e[type=item,x=${cx},y=200,z=${cz},distance=..40]`);
      await ctl.give(BOT, 'white_bed', 1);
      const placed = await runAction(registry, bot, {
        do: 'place',
        block: 'white_bed',
        at: { x: cx + 2, y: 200, z: cz },
      });
      expect(placed.state).toBe('completed');
      await ctl.timeSet('night');
      for (let i = 0; i < 60 && bot.time.timeOfDay < 13_000; i++) await bot.waitForTicks(1);
      const run = await runAction(registry, bot, { do: 'sleep' });
      expect(run.result).toMatchObject({ status: 'completed' });
      expect(await limited.isSleeping(BOT)).toBe(true);
      expect(await limited.isSleeping(BOT.toLowerCase())).toBe(true);
      if (bot.isSleeping) await wakeBot(bot);
    });
  });
});
