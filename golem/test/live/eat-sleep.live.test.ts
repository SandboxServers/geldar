import { describe, expect, it } from 'vitest';
import { createRegistry } from '../../src/actions/index.ts';
import { runAction } from '../../src/actions/registry.ts';
import { wakeBot } from '../../src/actions/wake.ts';
import { withLiveBot } from './fixture.ts';

/** The arena slot for this file (P0-09a: slot 3) and the bot that plays it. */
const SLOT = 3;
const BOT = 'GolemPlace';
/** Polls of one tick each before the food or the clock gives up. */
const POLL_LIMIT = 600;

const registry = createRegistry();

describe('eat: the eat action against a real server', () => {
  it('eats cooked beef when hungry and the food level rises', async () => {
    await withLiveBot({ name: BOT, slot: SLOT }, async ({ bot, ctl, arena }) => {
      const { x: cx, z: cz } = arena.center;
      await ctl.command(`kill @e[type=item,x=${cx},y=200,z=${cz},distance=..40]`);
      await ctl.give(BOT, 'cooked_beef', 2);
      await ctl.effect(BOT, 'hunger', 20, 255);
      // The hunger effect drains food a tick at a time; the poll is capped in ticks, not by the world clock.
      for (let i = 0; i < POLL_LIMIT && bot.food > 12; i++) await bot.waitForTicks(1);
      await ctl.effectClear(BOT);
      const before = bot.food;
      expect(before).toBeLessThanOrEqual(12);
      const run = await runAction(registry, bot, { do: 'eat' });
      expect(run.result).toMatchObject({ status: 'completed' });
      expect(run.result.detail).toMatchObject({ food_before: before });
      expect(Number(run.result.detail.food_after)).toBeGreaterThan(before);
    });
  });

  it('fails as not_possible at full hunger', async () => {
    await withLiveBot({ name: BOT, slot: SLOT }, async ({ bot, ctl, arena }) => {
      const { x: cx, z: cz } = arena.center;
      await ctl.command(`kill @e[type=item,x=${cx},y=200,z=${cz},distance=..40]`);
      await ctl.give(BOT, 'cooked_beef', 2);
      for (let i = 0; i < POLL_LIMIT && bot.food < 20; i++) await bot.waitForTicks(1);
      const run = await runAction(registry, bot, { do: 'eat' });
      expect(run.result).toMatchObject({ status: 'failed', reason: 'not_possible' });
    });
  });

  it('fails as missing_materials with nothing to eat', async () => {
    await withLiveBot({ name: BOT, slot: SLOT }, async ({ bot, ctl, arena }) => {
      const { x: cx, z: cz } = arena.center;
      await ctl.command(`kill @e[type=item,x=${cx},y=200,z=${cz},distance=..40]`);
      const run = await runAction(registry, bot, { do: 'eat' });
      expect(run.result).toMatchObject({ status: 'failed', reason: 'missing_materials' });
    });
  });
});

describe('sleep: the sleep action against a real server', () => {
  it('sleeps in a placed bed at night', async () => {
    await withLiveBot({ name: BOT, slot: SLOT }, async ({ bot, ctl, arena }) => {
      const { x: cx, z: cz } = arena.center;
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
      expect(bot.isSleeping).toBe(true);
      // The server may already have woken the bot; the waking belongs to the intent layer, not this test.
      if (bot.isSleeping) await wakeBot(bot);
    });
  });

  it('fails as not_possible by day', async () => {
    await withLiveBot({ name: BOT, slot: SLOT }, async ({ bot, ctl, arena }) => {
      const { x: cx, z: cz } = arena.center;
      await ctl.command(`kill @e[type=item,x=${cx},y=200,z=${cz},distance=..40]`);
      await ctl.setblock(cx + 2, 200, cz, 'white_bed');
      await ctl.timeSet('day');
      const run = await runAction(registry, bot, { do: 'sleep' });
      expect(run.result).toMatchObject({ status: 'failed', reason: 'not_possible' });
      expect(bot.isSleeping).toBe(false);
    });
  });

  it('fails as not_found with no bed in range', async () => {
    await withLiveBot({ name: BOT, slot: SLOT }, async ({ bot, ctl, arena }) => {
      const { x: cx, z: cz } = arena.center;
      await ctl.command(`kill @e[type=item,x=${cx},y=200,z=${cz},distance=..40]`);
      await ctl.timeSet('night');
      const run = await runAction(registry, bot, { do: 'sleep' });
      expect(run.result).toMatchObject({ status: 'failed', reason: 'not_found' });
    });
  });
});
