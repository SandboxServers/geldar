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

/** The test control's command surface, as the fixture hands it out. */
type Control = Parameters<Parameters<typeof withLiveBot>[1]>[0]['ctl'];

/**
 * Sets the world to midnight and waits until the bot sees it, so a summoned zombie does not burn
 * in daylight and never attacks. Returns the call that puts the time back to noon.
 */
async function midnight(bot: Bot, ctl: Control): Promise<() => Promise<void>> {
  await ctl.timeSet('midnight');
  for (let i = 0; i < 100 && bot.time.timeOfDay < 13_000; i++) await bot.waitForTicks(1);
  return async () => {
    await ctl.timeSet('noon');
  };
}

/** Summons a zombie in a helmet (test setup only: the Body uses no RCON), so the sun cannot burn it. */
async function summonZombie(ctl: Control, x: number, z: number): Promise<void> {
  await ctl.command(
    `summon zombie ${x} 200 ${z} {equipment:{head:{id:"minecraft:iron_helmet",count:1}}}`,
  );
}

/** What the bot sees around it, for an assertion message. */
function nearby(bot: Bot): string {
  const seen = Object.values(bot.entities)
    .filter((e) => e !== bot.entity && e.position.distanceTo(bot.entity.position) < 24)
    .map((e) => `${e.name ?? e.type} at ${e.position.floored()}`);
  return `nothing fired; time ${bot.time.timeOfDay}, health ${bot.health}, near: ${seen.join('; ') || 'nothing'}`;
}

/** The zombies the bot sees, with their distance, for an assertion message. */
function zombies(bot: Bot): string {
  const list = Object.values(bot.entities)
    .filter((e) => e.name === 'zombie')
    .map(
      (e) => `${e.position.floored()} at ${e.position.distanceTo(bot.entity.position).toFixed(1)}`,
    );
  return `bot at ${bot.entity.position.floored()}, health ${bot.health}, zombies: ${list.join('; ') || 'none'}`;
}

/**
 * Turns natural regeneration off (the rule is named differently across server versions) and
 * returns the call that turns it back on.
 */
async function stopRegeneration(ctl: Control): Promise<() => Promise<void>> {
  for (const rule of ['naturalRegeneration', 'natural_health_regeneration']) {
    const reply = await ctl.gamerule(rule, false);
    if (/unknown|incorrect|expected/i.test(reply)) continue;
    return async () => {
      await ctl.gamerule(rule, true);
    };
  }
  throw new Error('no natural regeneration game rule found to switch off');
}

/** Waits until `done` holds or the poll limit runs out; returns whether it held. */
async function waitFor(bot: Bot, done: () => boolean): Promise<boolean> {
  for (let i = 0; i < POLL_LIMIT && !done(); i++) await bot.waitForTicks(1);
  return done();
}

describe('reflexes: retreat and fight-or-flee against a real server', () => {
  it('an armed bot kills a zombie that attacks it', async () => {
    await withLiveBot({ name: BOT, slot: SLOT }, async ({ bot, ctl, arena, manager }) => {
      const { x: cx, z: cz } = arena.center;
      const restoreTime = await midnight(bot, ctl);
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
        await summonZombie(ctl, cx + 2, cz);
        const fired = await waitFor(bot, () =>
          sink.reflexes.some((r) => r.name === 'fight_or_flee'),
        );
        expect(fired, nearby(bot)).toBe(true);
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
        await restoreTime();
      }
    });
  });

  it('an unarmed bot flees a zombie that attacks it', async () => {
    await withLiveBot({ name: BOT, slot: SLOT }, async ({ bot, ctl, arena, manager }) => {
      const { x: cx, z: cz } = arena.center;
      const restoreTime = await midnight(bot, ctl);
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
        await summonZombie(ctl, cx + 1, cz);
        const fired = await waitFor(bot, () =>
          sink.reflexes.some((r) => r.name === 'fight_or_flee'),
        );
        expect(fired, nearby(bot)).toBe(true);
        const record = sink.reflexes.find((r) => r.name === 'fight_or_flee');
        expect(record?.trigger).toMatchObject({ armed: false });
        expect(sink.wakes.some((w) => w.reason === 'reflex_danger')).toBe(true);
      } finally {
        await runtime.stop();
        await restoreTime();
      }
    });
  });

  it('a bot at 4 health retreats toward the world spawn and raises a danger wake', async () => {
    await withLiveBot({ name: BOT, slot: SLOT }, async ({ bot, ctl, arena, manager }) => {
      const { x: cx, z: cz } = arena.center;
      const restoreTime = await midnight(bot, ctl);
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
      // Test setup only: natural regeneration would heal the bot back within ticks of the damage.
      const regen = await stopRegeneration(ctl);
      try {
        await ctl.effectClear(BOT);
        const reply = await ctl.command(`damage ${BOT} 16 minecraft:generic`);
        const low = await waitFor(bot, () => bot.health <= 6);
        expect(low, `damage did not take: reply '${reply}'; ${nearby(bot)}`).toBe(true);
        expect(bot.health).toBeLessThanOrEqual(6);
        await summonZombie(ctl, cx + 3, cz);
        const fired = await waitFor(bot, () => sink.reflexes.some((r) => r.name === 'retreat'));
        expect(fired, `${nearby(bot)}; ${zombies(bot)}`).toBe(true);
        expect(sink.wakes.some((w) => w.reason === 'reflex_danger')).toBe(true);
      } finally {
        await runtime.stop();
        await regen();
        await restoreTime();
      }
    });
  });

  it('the attack action kills a loaded zombie through the registry', async () => {
    await withLiveBot({ name: BOT, slot: SLOT }, async ({ bot, ctl, arena }) => {
      const { x: cx, z: cz } = arena.center;
      const restoreTime = await midnight(bot, ctl);
      await ctl.give(BOT, 'iron_sword', 1);
      try {
        await summonZombie(ctl, cx + 4, cz);
        await bot.waitForTicks(10);
        const run = await runAction(createRegistry(), bot, { do: 'attack', target: 'zombie' });
        expect(run.result, nearby(bot)).toMatchObject({ status: 'completed' });
        expect(run.result.detail).toMatchObject({ killed: true });
      } finally {
        await restoreTime();
      }
    });
  });
});
