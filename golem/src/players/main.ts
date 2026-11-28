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
import { parse } from 'yaml';
import { managerAcquire, restartKvFor } from '../adam/main.ts';
import { observationsFromEnv } from '../adam/observations-env.ts';
import { jetStreamPublisher } from '../body/records-nats.ts';
import { assertLoopbackNatsUrl } from '../body/restart.ts';
import { startProficiency } from '../character/proficiency-host.ts';
import { loadStackConfig, readRconPassword, repoRoot } from '../config.ts';
import { ConnectionManager } from '../connection.ts';
import { natsRequestServer } from '../mind-link/server.ts';
import { golemNatsAuth } from '../nats-credentials.ts';
import { RconClient } from '../rcon.ts';
import { registryFromConfig } from '../registry.ts';
import {
  bookServe,
  type ExtraServe,
  installEntryHandlers,
  playerBodyEnv,
  startPlayerBody,
} from './body-host.ts';
import { parsePlayerConfig } from './player-config.ts';
import { startPlayerTelemetry } from './player-telemetry.ts';
import { watchPresence } from './presence.ts';
import { PlayerSession } from './session.ts';
import { admitLifeOverRcon } from './whitelist.ts';

// The Body wiring lives in body-host.ts (no RCON there); these names stay exported from this module.
export {
  bookServe,
  type ExtraServe,
  installEntryHandlers,
  playerBodyEnv,
  startPlayerBody,
  startPlayerTelemetry,
};

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
  // A failure after the connection opens closes what is open, so no NATS connection leaks. The plan
  // and seen buckets follow the player's body_actions.building, as Adam's Body does (A1).
  const restartKv = await restartKvFor(config, natsUrl).catch(async (error: unknown) => {
    await nc.close();
    throw error;
  });
  const presence = await new Kvm(jetstream(nc))
    .open(PRESENCE_BUCKET)
    .catch(async (error: unknown) => {
      await restartKv.close();
      await nc.close();
      throw error;
    });
  const server = natsRequestServer(nc);
  // The proficiency cache (AN-12a): started only for a config sheet; off and standard send no request.
  // A failure here closes the connections opened above, as the KV and presence failures do.
  let proficiency: ReturnType<typeof startProficiency>;
  try {
    proficiency = startProficiency({
      nc,
      shard: config.shard,
      lifeId,
      character: config.character,
      log: (line) => log({ event: 'proficiency', line }),
    });
  } catch (error) {
    await restartKv.close();
    await nc.close();
    throw error;
  }
  const telemetry = startPlayerTelemetry(env, log);
  const bodyEnv = playerBodyEnv({
    proficiency,
    config,
    kv: restartKv.kv,
    publisher: jetStreamPublisher(jetstream(nc)),
    nc,
    server,
    log: (line) => log({ event: 'body', line }),
    metrics: telemetry.metrics,
    // AN-50d: GELDAR_OBSERVATIONS '1' or 'on' turns the observations option on; otherwise off.
    observations: observationsFromEnv(env.GELDAR_OBSERVATIONS),
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
  proficiency?.stop();
  await telemetry.stop();
  await restartKv.close();
  await nc.close();
  log({ event: 'player_stopped' });
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  installEntryHandlers();
  runPlayer(playerIdFromArgs(process.argv.slice(2))).catch((error: unknown) => {
    jsonLog({ event: 'fatal', error: error instanceof Error ? error.message : String(error) });
    process.exit(1);
  });
}
