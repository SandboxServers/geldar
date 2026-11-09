import type { Bot } from 'mineflayer';
import { describe, expect, it } from 'vitest';
import { createRegistry } from '../../src/actions/index.ts';
import { runAction } from '../../src/actions/registry.ts';
import { MemorySink } from '../../src/body/records.ts';
import { combatReflexes } from '../../src/body/reflexes/combat.ts';
import { BodyRuntime } from '../../src/body/runtime.ts';
import { withLiveBot } from './fixture.ts';

/** The arena slot for this file (P0-15b: slot 9) and the bot that plays it. */
const SLOT = 9;
const BOT = 'GolemCombat';
/** Polls of one tick each before a wait gives up. */
const POLL_LIMIT = 600;

/** Waits until `done` holds or the poll limit runs out; returns whether it held. */
async function waitFor(bot: Bot, done: () => boolean): Promise<boolean> {
  for (let i = 0; i < POLL_LIMIT && !done(); i++) await bot.waitForTicks(1);
  return done();
}

describe('reflexes: retreat and fight-or-flee against a real server', () => {
  it('an armed bot kills a zombie that attacks it', async () => {
    await withLiveBot({ name: BOT, slot: SLOT }, async ({ bot, ctl, arena, manager }) => {
      const { x: cx, z: cz } = arena.center;
      await ctl.timeSet('night');
      await ctl.give(BOT, 'iron_sword', 1);
      const sink = new MemorySink();
      const runtime = new BodyRuntime({
        lifeId: 'live-combat',
        bodyGeneration: 1,
        bot,
        ticks: manager.onWorldTick,
        sink,
        reflexes: combatReflexes,
      });
      runtime.start();
      try {
        // Test setup only: the Body itself uses no RCON.
        await ctl.command(`summon zombie ${cx + 2} 200 ${cz}`);
        const fired = await waitFor(bot, () =>
          sink.reflexes.some((r) => r.name === 'fight_or_flee'),
        );
        expect(fired).toBe(true);
        const gone = await waitFor(
          bot,
          () => !Object.values(bot.entities).some((e) => e.name === 'zombie'),
        );
        expect(gone).toBe(true);
        expect(sink.reflexes.find((r) => r.name === 'fight_or_flee')?.trigger).toMatchObject({
          armed: true,
        });
      } finally {
        await runtime.stop();
      }
    });
  });

  it('an unarmed bot flees a zombie that attacks it', async () => {
    await withLiveBot({ name: BOT, slot: SLOT }, async ({ bot, ctl, arena, manager }) => {
      const { x: cx, z: cz } = arena.center;
      await ctl.timeSet('night');
      await ctl.clear(BOT);
      const sink = new MemorySink();
      const runtime = new BodyRuntime({
        lifeId: 'live-combat',
        bodyGeneration: 1,
        bot,
        ticks: manager.onWorldTick,
        sink,
        reflexes: combatReflexes,
      });
      runtime.start();
      try {
        await ctl.command(`summon zombie ${cx + 1} 200 ${cz}`);
        const fired = await waitFor(bot, () =>
          sink.reflexes.some((r) => r.name === 'fight_or_flee'),
        );
        expect(fired).toBe(true);
        const record = sink.reflexes.find((r) => r.name === 'fight_or_flee');
        expect(record?.trigger).toMatchObject({ armed: false });
        expect(sink.wakes.some((w) => w.reason === 'reflex_danger')).toBe(true);
      } finally {
        await runtime.stop();
      }
    });
  });

  it('a bot at 4 health retreats toward the world spawn and raises a danger wake', async () => {
    await withLiveBot({ name: BOT, slot: SLOT }, async ({ bot, ctl, arena, manager }) => {
      const { x: cx, z: cz } = arena.center;
      await ctl.timeSet('night');
      const sink = new MemorySink();
      const runtime = new BodyRuntime({
        lifeId: 'live-combat',
        bodyGeneration: 1,
        bot,
        ticks: manager.onWorldTick,
        sink,
        reflexes: combatReflexes,
      });
      runtime.start();
      try {
        await ctl.command(`damage ${BOT} 16 minecraft:generic`);
        await waitFor(bot, () => bot.health <= 6);
        await ctl.command(`summon zombie ${cx + 3} 200 ${cz}`);
        const fired = await waitFor(bot, () => sink.reflexes.some((r) => r.name === 'retreat'));
        expect(fired).toBe(true);
        expect(sink.wakes.some((w) => w.reason === 'reflex_danger')).toBe(true);
      } finally {
        await runtime.stop();
      }
    });
  });

  it('the attack action kills a loaded zombie through the registry', async () => {
    await withLiveBot({ name: BOT, slot: SLOT }, async ({ bot, ctl, arena }) => {
      const { x: cx, z: cz } = arena.center;
      await ctl.timeSet('night');
      await ctl.give(BOT, 'iron_sword', 1);
      await ctl.command(`summon zombie ${cx + 4} 200 ${cz}`);
      await bot.waitForTicks(10);
      const run = await runAction(createRegistry(), bot, { do: 'attack', target: 'zombie' });
      expect(run.result).toMatchObject({ status: 'completed' });
      expect(run.result.detail).toMatchObject({ killed: true });
    });
  });
});
