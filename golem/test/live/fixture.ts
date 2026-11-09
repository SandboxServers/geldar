import type { Bot } from 'mineflayer';
import { watchRecipeBook } from '../../src/actions/craft-table.ts';
import { type Arena, buildArena, quietWorld, restoreWorld } from '../../src/arena.ts';
import { loadStackConfig, readRconPassword } from '../../src/config.ts';
import { ConnectionManager } from '../../src/connection.ts';
import { RconClient } from '../../src/rcon.ts';
import { registryFromConfig } from '../../src/registry.ts';
import { TestControl } from '../../src/test-control.ts';

/** What a live test gets: the joined bot, the RCON control, the arena and the connection manager. */
export interface LiveContext {
  bot: Bot;
  ctl: TestControl;
  arena: Arena;
  manager: ConnectionManager;
}

/**
 * Runs `fn` with one bot joined through the Velocity ingress and standing in an arena. Fails fast
 * with the "shard not up" text when RCON cannot connect. Bots play survival; the fixture does not
 * set the gamemode. `finally` stops the bot, restores the world and closes RCON, even on failure.
 */
export async function withLiveBot(
  opts: { name: string; slot: number },
  fn: (ctx: LiveContext) => Promise<void>,
): Promise<void> {
  const cfg = loadStackConfig();
  const password = await readRconPassword(cfg);
  const rcon = await RconClient.connect({ host: cfg.rconHost, port: cfg.rconPort, password });
  const manager = new ConnectionManager({
    host: cfg.mcHost,
    port: cfg.mcPort,
    username: opts.name,
    onBot: watchRecipeBook,
    registry: registryFromConfig(cfg),
  });
  await runWithBot({ ctl: new TestControl(rcon), manager, close: () => rcon.close() }, opts, fn);
}

/** The parts `runWithBot` needs; tests pass fakes. */
export interface LiveParts {
  ctl: TestControl;
  manager: ConnectionManager;
  close(): Promise<void>;
}

/**
 * The body of `withLiveBot` over injected parts. The bot name is whitelisted before it connects
 * and removed again in `finally`; a failed removal is ignored.
 */
export async function runWithBot(
  { ctl, manager, close }: LiveParts,
  opts: { name: string; slot: number },
  fn: (ctx: LiveContext) => Promise<void>,
): Promise<void> {
  try {
    await quietWorld(ctl);
    const arena = await buildArena(ctl, opts.slot);
    await ctl.whitelistAdd(opts.name);
    const bot = await manager.start();
    await ctl.clear(opts.name);
    await ctl.tp(opts.name, arena.center.x, arena.center.y + 1, arena.center.z);
    await bot.waitForTicks(10);
    await fn({ bot, ctl, arena, manager });
  } finally {
    // `stop()` does not wait for the bot to leave, so `restoreWorld` can run while it is leaving.
    // RCON closes even when the restore fails.
    try {
      await manager.stop();
      await restoreWorld(ctl);
    } finally {
      await ctl.whitelistRemove(opts.name).catch(() => undefined);
      await close();
    }
  }
}

/** Named times `resetBot` can set. */
export type ResetTime = 'day' | 'noon' | 'night' | 'midnight';

/** What `resetBot` puts the world and the bot in; every field has a default. */
export interface ResetOptions {
  /** Time of day to set and wait for; default `noon`, so a case never depends on the clock. */
  time?: ResetTime;
  /** Gamerules to set for the case; each previous value is put back by the restore call. */
  gamerules?: Record<string, boolean>;
  /**
   * Reset the bot's recipe book to nothing, so recipes unlock only through play (decision 0048).
   * Revokes the recipe advancements AND takes the recipes: either alone leaves the bot unable to unlock.
   */
  recipes?: boolean;
}

/**
 * The one explicit recipe unlock for live cases that are not about discovery (table crafting and the
 * like). A case about discovery never calls this: it uses `resetBot(..., { recipes: true })`.
 */
export async function unlockAllRecipes(ctl: TestControl, name: string): Promise<void> {
  await ctl.recipeGive(name);
}

/** Heals the bot to full health, failing with the server's reply and the bot's state. */
export async function healBot(bot: Bot, ctl: TestControl): Promise<void> {
  const name = bot.username;
  await ctl.effectClear(name);
  const reply = await ctl.effect(name, 'instant_health', 1, 10);
  for (let i = 0; i < 600 && bot.health < 20; i++) await bot.waitForTicks(1);
  if (bot.health < 20) {
    throw new Error(
      `bot did not heal to full: reply '${reply}'; health ${bot.health}, at ${bot.entity.position.floored()}`,
    );
  }
}

/** Reads a boolean gamerule back from the server's reply, or throws with the reply. */
async function readRule(ctl: TestControl, name: string): Promise<boolean> {
  const reply = await ctl.gamerule(name);
  const value = /(true|false)/.exec(reply)?.[1];
  if (value === undefined) throw new Error(`gamerule ${name} query replied: ${reply}`);
  return value === 'true';
}

/**
 * The standard start of a live case that depends on world state: the bot persists between runs, so
 * heal it, clear its effects, set the time (and wait until the bot sees it) and the weather, and
 * apply the case's gamerules. Returns the call that puts the time back to noon and the gamerules
 * back to what they were; call it in `finally`. A set or restore the server did not take throws.
 */
export async function resetBot(
  bot: Bot,
  ctl: TestControl,
  opts: ResetOptions = {},
): Promise<() => Promise<void>> {
  const time = opts.time ?? 'noon';
  const previous = new Map<string, boolean>();
  await healBot(bot, ctl);
  if (opts.recipes) await ctl.recipeReset(bot.username);
  await ctl.timeSet(time);
  await ctl.command('weather clear');
  const wanted = { day: 1000, noon: 6000, night: 13_000, midnight: 18_000 }[time];
  for (let i = 0; i < 100 && Math.abs(bot.time.timeOfDay - wanted) > 1000; i++) {
    await bot.waitForTicks(1);
  }
  for (const [rule, value] of Object.entries(opts.gamerules ?? {})) {
    previous.set(rule, await readRule(ctl, rule));
    await ctl.gamerule(rule, value);
    if ((await readRule(ctl, rule)) !== value) {
      throw new Error(`could not set gamerule ${rule} to ${value}`);
    }
  }
  return async () => {
    await ctl.timeSet('noon');
    for (const [rule, value] of previous) {
      await ctl.gamerule(rule, value);
      if ((await readRule(ctl, rule)) !== value) {
        throw new Error(`could not restore gamerule ${rule} to ${value}`);
      }
    }
  };
}
