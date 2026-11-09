import type { Bot } from 'mineflayer';
import { type Arena, buildArena, quietWorld, restoreWorld } from '../../src/arena.ts';
import { ConnectionManager } from '../../src/connection.ts';
import { loadConfig, readRconPassword } from '../../src/config.ts';
import { RconClient } from '../../src/rcon.ts';
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
  const cfg = loadConfig();
  const password = await readRconPassword(cfg);
  const rcon = await RconClient.connect({ host: cfg.rconHost, port: cfg.rconPort, password });
  const ctl = new TestControl(rcon);
  const manager = new ConnectionManager({ host: cfg.mcHost, port: cfg.mcPort, username: opts.name });
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
    await manager.stop();
    await restoreWorld(ctl);
    await rcon.close();
  }
}
