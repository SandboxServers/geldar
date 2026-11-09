import { Vec3 } from 'vec3';
import { describe, expect, it } from 'vitest';
import { eatAction } from '../../src/actions/eat.ts';
import { MemorySink } from '../../src/body/records.ts';
import { basicReflexes } from '../../src/body/reflexes/basic.ts';
import { BodyRuntime } from '../../src/body/runtime.ts';
import { type LiveContext, withLiveBot } from './fixture.ts';

/** The arena slot for this file (P0-15a: slot 4) and the bot that plays it. */
const SLOT = 4;
const BOT = 'GolemReflex';
/** Ticks a poll waits before the reflex or the clock is declared too slow. */
const POLL_LIMIT = 600;

/** Starts a Body with the basic reflexes on the live bot; the caller stops it. */
function startBody(live: LiveContext): { body: BodyRuntime; sink: MemorySink } {
  const sink = new MemorySink();
  const body = new BodyRuntime({
    lifeId: 'reflex-live',
    bodyGeneration: 1,
    bot: live.bot,
    ticks: live.manager.onWorldTick,
    sink,
    reflexes: basicReflexes,
  });
  body.actions.register(eatAction);
  body.start();
  return { body, sink };
}

/** Waits up to `POLL_LIMIT` ticks for `done`; returns whether it became true. */
async function waitFor(live: LiveContext, done: () => boolean): Promise<boolean> {
  for (let i = 0; i < POLL_LIMIT && !done(); i++) await live.bot.waitForTicks(1);
  return done();
}

describe('basic reflexes against a real server', () => {
  it('eat: a hungry Body with food eats on its own and the food level rises', async () => {
    await withLiveBot({ name: BOT, slot: SLOT }, async (live) => {
      const { bot, ctl, arena } = live;
      const { x: cx, z: cz } = arena.center;
      await ctl.command(`kill @e[type=item,x=${cx},y=200,z=${cz},distance=..40]`);
      await ctl.give(BOT, 'cooked_beef', 4);
      await ctl.effect(BOT, 'hunger', 20, 255);
      for (let i = 0; i < POLL_LIMIT && bot.food > 12; i++) await bot.waitForTicks(1);
      await ctl.effectClear(BOT);
      const before = bot.food;
      expect(before).toBeLessThanOrEqual(14);
      const { body, sink } = startBody(live);
      try {
        const fired = await waitFor(live, () => sink.reflexes.some((r) => r.name === 'eat'));
        expect(fired).toBe(true);
        expect(sink.reflexes.find((r) => r.name === 'eat')?.outcome.result).toBe('handled');
        expect(bot.food).toBeGreaterThan(before);
      } finally {
        await body.stop();
      }
    });
  });

  it('hazard_escape: a Body standing in a lava pool leaves it', async () => {
    await withLiveBot({ name: BOT, slot: SLOT }, async (live) => {
      const { bot, ctl, arena } = live;
      const { x: cx, z: cz } = arena.center;
      // A 3 by 3 pool, two deep, on the arena platform; the Body is dropped into its middle.
      await ctl.fill({ x: cx + 4, y: 200, z: cz }, { x: cx + 6, y: 201, z: cz + 2 }, 'lava');
      await ctl.tp(BOT, cx + 5, 200, cz + 1);
      const { body, sink } = startBody(live);
      try {
        const left = await waitFor(live, () => {
          const block = bot.blockAt(bot.entity.position);
          return block !== null && block.name !== 'lava' && sink.reflexes.length > 0;
        });
        expect(left).toBe(true);
        expect(sink.reflexes.some((r) => r.name === 'hazard_escape')).toBe(true);
        expect(bot.entity.position.x < cx + 4 || bot.entity.position.x > cx + 7).toBe(true);
      } finally {
        await body.stop();
      }
    });
  });

  it('fall_stop: a Body walking toward a 10-block drop stops at the edge', async () => {
    await withLiveBot({ name: BOT, slot: SLOT }, async (live) => {
      const { bot, ctl, arena } = live;
      const { x: cx, z: cz } = arena.center;
      // A raised stone pad at y 210, ten blocks above the arena platform; the Body walks +x off it.
      await ctl.fill({ x: cx - 3, y: 210, z: cz - 3 }, { x: cx + 3, y: 210, z: cz + 3 }, 'stone');
      await ctl.tp(BOT, cx - 2, 211, cz);
      await bot.waitForTicks(10);
      const { body, sink } = startBody(live);
      try {
        await bot.lookAt(new Vec3(cx + 20, 211.6, cz + 0.5), true);
        bot.setControlState('forward', true);
        const fired = await waitFor(live, () => sink.reflexes.some((r) => r.name === 'fall_stop'));
        bot.setControlState('forward', false);
        expect(fired).toBe(true);
        await bot.waitForTicks(20);
        // Still on the pad: not fallen, and short of the far edge at x = cx + 4.
        expect(bot.entity.position.y).toBeGreaterThanOrEqual(210.9);
        expect(bot.entity.position.x).toBeLessThan(cx + 4);
      } finally {
        await body.stop();
      }
    });
  });
});
