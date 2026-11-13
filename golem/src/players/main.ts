/**
 * One sovereign player's Body process (spec 5.2, 5.15.2; decisions 0040, 0043, 0050-0052), run as
 * `main.ts --player <player-id>`. The player's config comes from its `sovereign.players` entry; the
 * life is whitelisted over RCON before each connect; the `geldar-presence` record of the life
 * starts and stops the session. Every log line is one JSON object with `life_id`. SIGINT and
 * SIGTERM stop the Body and keep its checkpoint, as Adam's process does.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PRESENCE_BUCKET } from '@geldar/contract';
import { connectNats } from '@geldar/contract/nats';
import { jetstream } from '@nats-io/jetstream';
import { type KV, Kvm } from '@nats-io/kv';
import type { Bot } from 'mineflayer';
import { parse } from 'yaml';
import { type AdamBodyEnv, type RunningAdamBody, startAdamBody } from '../adam/adam-body.ts';
import { managerAcquire } from '../adam/main.ts';
import { jetStreamPublisher } from '../body/records-nats.ts';
import { assertLoopbackNatsUrl, openRestartKv } from '../body/restart.ts';
import { serveBooks } from '../books/book-server.ts';
import { loadStackConfig, readRconPassword, repoRoot } from '../config.ts';
import { ConnectionManager } from '../connection.ts';
import { natsRequestServer, type RequestServer } from '../mind-link/server.ts';
import { golemNatsAuth } from '../nats-credentials.ts';
import { RconClient } from '../rcon.ts';
import { registryFromConfig } from '../registry.ts';
import { parsePlayerConfig } from './player-config.ts';
import { watchPresence } from './presence.ts';
import { PlayerSession } from './session.ts';
import { admitLifeOverRcon } from './whitelist.ts';

/** Serves more on the player's bot next to the Body (the book server, wired in WM-11). */
export type ExtraServe = (bot: Bot) => { stop(): Promise<void> | void };

const NO_EXTRA: ExtraServe = () => ({ stop() {} });

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

/** The player id after `--player`; throws with the usage line when it is missing. */
export function playerIdFromArgs(argv: string[]): string {
  const at = argv.indexOf('--player');
  const playerId = at === -1 ? undefined : argv[at + 1];
  if (playerId === undefined || playerId.startsWith('--')) {
    throw new Error('usage: main.ts --player <player-id>');
  }
  return playerId;
}

const jsonLog = (line: Record<string, unknown>): void => {
  console.log(JSON.stringify({ at: new Date().toISOString(), ...line }));
};

/** The values of one life's presence key: the record text, or null for a deletion or purge. */
async function* presenceEntries(kv: KV, lifeId: string): AsyncGenerator<string | null> {
  const watch = await kv.watch({ key: lifeId });
  for await (const entry of watch) yield entry.operation === 'PUT' ? entry.string() : null;
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
}): AdamBodyEnv {
  return {
    config: input.config,
    kv: input.kv,
    publisher: input.publisher,
    server: input.server,
    owners: input.nc,
    log: input.log,
  };
}

/** Runs the player's Body until a signal; the presence record decides when it is up. */
export async function runPlayer(
  playerId: string,
  extraServe?: ExtraServe,
  env: Record<string, string | undefined> = process.env,
): Promise<void> {
  const file = join(repoRoot(), 'shards', `${env.GELDAR_SHARD ?? 'phase0'}.yaml`);
  const config = parsePlayerConfig(parse(await readFile(file, 'utf8')), playerId);
  const { lifeId } = config;
  const log = (line: Record<string, unknown>): void => jsonLog({ life_id: lifeId, ...line });
  const stack = loadStackConfig(env);
  const natsUrl = stack.natsUrl ?? '';
  assertLoopbackNatsUrl(natsUrl);
  const nc = await connectNats({
    servers: natsUrl,
    name: `player-${playerId}`,
    timeout: 5_000,
    ...golemNatsAuth(),
  });
  const restartKv = await openRestartKv(natsUrl);
  const presence = await new Kvm(jetstream(nc)).open(PRESENCE_BUCKET);
  const server = natsRequestServer(nc);
  const bodyEnv = playerBodyEnv({
    config,
    kv: restartKv.kv,
    publisher: jetStreamPublisher(jetstream(nc)),
    nc,
    server,
    log: (line) => log({ event: 'body', line }),
  });
  const serve =
    extraServe ??
    bookServe({
      shard: config.shard,
      lifeId,
      server,
      log: (line) => log({ event: 'book', line }),
    });
  const session = new PlayerSession({
    lifeId,
    // A fresh RCON connection per admission, closed right after: no command socket stays open.
    admit: (id) =>
      admitLifeOverRcon(
        async () =>
          RconClient.connect({
            host: stack.rconHost,
            port: stack.rconPort,
            password: await readRconPassword(stack),
          }),
        id,
      ),
    connect: () => {
      const manager = new ConnectionManager({
        host: stack.mcHost,
        port: stack.mcPort,
        username: lifeId,
        registry: registryFromConfig(stack),
      });
      return { acquire: managerAcquire(manager), close: () => manager.stop() };
    },
    body: (bot) => startPlayerBody(bodyEnv, bot, serve),
    log,
    watchdog: { limitMs: Number(env.GELDAR_BODY_WATCHDOG_MS) || 60_000 },
  });

  const abort = new AbortController();
  const onSignal = (signal: string): void => {
    log({ event: 'signal', signal });
    abort.abort();
  };
  process.once('SIGINT', () => onSignal('SIGINT'));
  process.once('SIGTERM', () => onSignal('SIGTERM'));
  // `always` starts at boot; a later `down` record still stops it (decision: start mode).
  if (config.start === 'always') await session.up();
  await watchPresence({
    lifeId,
    entries: presenceEntries(presence, lifeId),
    handlers: { up: () => session.up(), down: () => session.down() },
    signal: abort.signal,
    log,
  });
  // The watch has ended, so no `up` is in progress: stop the Body, then the connections.
  await session.down();
  await restartKv.close();
  await nc.close();
  log({ event: 'player_stopped' });
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runPlayer(playerIdFromArgs(process.argv.slice(2))).catch((error: unknown) => {
    jsonLog({ event: 'fatal', error: error instanceof Error ? error.message : String(error) });
    process.exitCode = 1;
  });
}
