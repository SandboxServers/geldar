/**
 * The Body wiring shared by the two player hosts: the sovereign host (main.ts, RCON whitelist) and
 * the managed host (managed-main.ts, no RCON). It holds the book serve beside the Body, the Body
 * start, the Body's env, and the fatal handlers. It imports no RCON and no whitelist code, so a
 * managed host that imports this module cannot reach them (managed-main.test.ts walks the graph).
 */

import type { connectNats } from '@geldar/contract/nats';
import type { Bot } from 'mineflayer';
import { type AdamBodyEnv, type RunningAdamBody, startAdamBody } from '../adam/adam-body.ts';
import { serveBooks } from '../books/book-server.ts';
import type { GolemMetrics } from '../metrics.ts';
import type { RequestServer } from '../mind-link/server.ts';
import { installFatalHandlers } from '../process-fatal.ts';

/** Serves more on the player's bot next to the Body (the book server, wired in WM-11). */
export type ExtraServe = (bot: Bot) => { stop(): Promise<void> | void };

const NO_EXTRA: ExtraServe = () => ({ stop() {} });

const jsonLog = (line: Record<string, unknown>): void => {
  console.log(JSON.stringify({ at: new Date().toISOString(), ...line }));
};

/** The book subject of one life, served beside its Body (WM-07, spec 5.15.2). */
export function bookServe(options: {
  shard: string;
  lifeId: string;
  server: RequestServer;
  log: (line: string) => void;
}): ExtraServe {
  return (bot) => {
    const stop = serveBooks({ ...options, bot });
    return { stop: () => stop() };
  };
}

/**
 * Starts the Body on `bot` with `extraServe` beside it. A failed start leaves nothing running (the
 * Body's own cleanup runs first). `stop` ends `extraServe` first, so nothing new is served, then the Body.
 */
export async function startPlayerBody(
  env: AdamBodyEnv,
  bot: Bot,
  extraServe: ExtraServe = NO_EXTRA,
): Promise<RunningAdamBody> {
  const running = await startAdamBody(env, bot);
  let extra: ReturnType<ExtraServe>;
  try {
    extra = extraServe(bot);
  } catch (error) {
    await running.stop();
    throw error;
  }
  return {
    ...running,
    async stop() {
      try {
        await extra.stop();
      } finally {
        await running.stop();
      }
    },
  };
}

type PlayerNats = Awaited<ReturnType<typeof connectNats>>;

/**
 * The Body's env in a player host. The host's own connection is the ownership transport (decision
 * 0165), so every ranger Body runs the ownership client, as Adam's Body does.
 */
export function playerBodyEnv(input: {
  config: AdamBodyEnv['config'];
  kv: AdamBodyEnv['kv'];
  publisher: AdamBodyEnv['publisher'];
  nc: PlayerNats;
  server: AdamBodyEnv['server'];
  log: AdamBodyEnv['log'];
  proficiency?: AdamBodyEnv['proficiency'];
  /** The host's Body metrics (`startPlayerTelemetry`); absent means the Body records nothing. */
  metrics?: GolemMetrics;
  /** AN-50d: `observations` on when true (from GELDAR_OBSERVATIONS); absent or false is off, as today. */
  observations?: boolean;
}): AdamBodyEnv {
  return {
    config: input.config,
    ...(input.config.character === undefined ? {} : { character: input.config.character }),
    kv: input.kv,
    publisher: input.publisher,
    server: input.server,
    owners: input.nc,
    log: input.log,
    ...(input.proficiency === undefined ? {} : { proficiency: input.proficiency }),
    ...(input.metrics === undefined ? {} : { metrics: input.metrics }),
    ...(input.observations === true ? { observations: true } : {}),
  };
}

/** Installs the host's fatal handlers (process-fatal.ts). The entry point calls it before the body starts. */
export function installEntryHandlers(): void {
  installFatalHandlers(jsonLog);
}
