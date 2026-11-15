/**
 * The managed player host (BODY-HOST design, section 3, decisions 0260 and 0261): one agent's Body in
 * its own container, started by the body helper's `start`. Its config comes from the read-only shard
 * file and ONE database function, `player_host_config(life_id)`, which the role `geldar_body_host`
 * may call and nothing else; the database password is read from a secret file. There is no RCON
 * here: the whitelist is the helper's one-shot admit, so the admit of this session is a no-op. The
 * life registry key is written and heartbeated by this process over the `body` NATS user, under the
 * lowercased life id. A null row (the roster row is gone, banned or retired) exits with
 * NO_HOST_CONFIG_EXIT, so the helper sweep removes the container. Every log line is one JSON object.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PRESENCE_BUCKET } from '@geldar/contract';
import { connectNats } from '@geldar/contract/nats';
import { jetstream } from '@nats-io/jetstream';
import { type KV, Kvm } from '@nats-io/kv';
import pg from 'pg';
import { parse } from 'yaml';
import { managerAcquire } from '../adam/main.ts';
import { jetStreamPublisher } from '../body/records-nats.ts';
import { openRestartKv } from '../body/restart.ts';
import { startProficiency } from '../character/proficiency-host.ts';
import { loadStackConfig, repoRoot } from '../config.ts';
import { ConnectionManager } from '../connection.ts';
import { natsRequestServer } from '../mind-link/server.ts';
import { golemNatsAuth } from '../nats-credentials.ts';
import {
  type BotRegistry,
  LifeRegistration,
  type OpenedRegistry,
  openRegistryBucket,
} from '../registry.ts';
import { bookServe, installEntryHandlers, playerBodyEnv, startPlayerBody } from './main.ts';
import { managedLifeId, NO_HOST_CONFIG_EXIT, parseManagedPlayerConfig } from './managed-config.ts';
import type { PlayerConfig } from './player-config.ts';
import { watchPresence } from './presence.ts';
import { PlayerSession } from './session.ts';

/** The connection options of the host database: the role is the narrow one from the environment. */
export interface HostDbOptions {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

/** The database port of the host: one query, `player_host_config(life_id)`, and a close. */
export interface HostDb {
  /** The JSON row of the life, or null when the function answers NULL. */
  hostConfig(lifeId: string): Promise<unknown>;
  close(): Promise<void>;
}

/** The pg adapter of HostDb: a single client, with no pool, opened for one read. */
export async function openPgHostDb(options: HostDbOptions): Promise<HostDb> {
  const client = new pg.Client({
    host: options.host,
    port: options.port,
    database: options.database,
    user: options.user,
    password: options.password,
    connectionTimeoutMillis: 5_000,
  });
  await client.connect();
  return {
    async hostConfig(lifeId) {
      const result = await client.query('SELECT player_host_config($1) AS cfg', [lifeId]);
      return result.rows[0]?.cfg ?? null;
    },
    close: () => client.end(),
  };
}

/** The effects the host needs, so a test can replace each one. */
export interface ManagedDeps {
  readText(file: string): Promise<string>;
  openDb(options: HostDbOptions): Promise<HostDb>;
  runBody(config: PlayerConfig, env: Record<string, string | undefined>): Promise<void>;
  log(line: Record<string, unknown>): void;
}

const jsonLog = (line: Record<string, unknown>): void => {
  console.log(JSON.stringify({ at: new Date().toISOString(), ...line }));
};

/**
 * The bot registry of a managed Body: the life registry, opened with the `body` NATS user. The key
 * is the lowercased username (registry.ts), the name the Velocity plugin looks up.
 */
export function managedBotRegistry(open: () => Promise<OpenedRegistry>): BotRegistry {
  return new LifeRegistration(open, undefined, (username, error) =>
    jsonLog({
      event: 'registry_heartbeat_failed',
      life_id: username,
      error: error instanceof Error ? error.message : String(error),
    }),
  );
}

/** The values of one life's presence key: the record text, or null for a deletion or purge. */
async function* presenceEntries(kv: KV, lifeId: string): AsyncGenerator<string | null> {
  const watch = await kv.watch({ key: lifeId });
  for await (const entry of watch) yield entry.operation === 'PUT' ? entry.string() : null;
}

/** The required variable, or a fixed error naming only the variable. */
function required(env: Record<string, string | undefined>, name: string): string {
  const value = env[name];
  if (value === undefined || value === '') throw new Error(`${name} is required`);
  return value;
}

/**
 * Runs the managed Body of one life until a signal. Mirrors runPlayer without RCON: the admit is a
 * no-op, the start mode is always `always`, and the presence watch still stops the session on `down`.
 */
export async function runManagedBody(
  config: PlayerConfig,
  env: Record<string, string | undefined>,
): Promise<void> {
  const { lifeId } = config;
  const log = (line: Record<string, unknown>): void => jsonLog({ life_id: lifeId, ...line });
  const stack = loadStackConfig(env);
  const natsUrl = stack.natsUrl ?? '';
  const nc = await connectNats({
    servers: natsUrl,
    name: `managed-${lifeId}`,
    timeout: 5_000,
    ...golemNatsAuth(),
  });
  const restartKv = await openRestartKv(natsUrl).catch(async (error: unknown) => {
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
  const bodyEnv = playerBodyEnv({
    proficiency,
    config,
    kv: restartKv.kv,
    publisher: jetStreamPublisher(jetstream(nc)),
    nc,
    server,
    log: (line) => log({ event: 'body', line }),
  });
  const serve = bookServe({
    shard: config.shard,
    lifeId,
    server,
    log: (line) => log({ event: 'book', line }),
  });
  const session = new PlayerSession({
    lifeId,
    // A managed host has no RCON: the helper's one-shot admitted this life before `start`.
    admit: async () => undefined,
    connect: () => {
      const manager = new ConnectionManager({
        host: stack.mcHost,
        port: stack.mcPort,
        username: lifeId,
        registry: managedBotRegistry(() => openRegistryBucket(natsUrl)),
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
  await session.up();
  await watchPresence({
    lifeId,
    entries: presenceEntries(presence, lifeId),
    handlers: { up: () => session.up(), down: () => session.down() },
    signal: abort.signal,
    log,
  });
  await session.down();
  proficiency?.stop();
  await restartKv.close();
  await nc.close();
  log({ event: 'player_stopped' });
}

const REAL_DEPS: ManagedDeps = {
  readText: (file) => readFile(file, 'utf8'),
  openDb: openPgHostDb,
  runBody: runManagedBody,
  log: jsonLog,
};

/**
 * Starts the managed host of the life in GELDAR_LIFE_ID. Returns the process exit code: 0 after a
 * normal stop, NO_HOST_CONFIG_EXIT when the database has no config for the life (no Body starts).
 * Throws on a malformed environment, before any connection is opened.
 */
export async function runManagedPlayer(
  env: Record<string, string | undefined> = process.env,
  deps: ManagedDeps = REAL_DEPS,
): Promise<number> {
  const lifeId = managedLifeId(env.GELDAR_LIFE_ID);
  if (env.GELDAR_LOGIN_NAME !== lifeId)
    throw new Error('GELDAR_LOGIN_NAME must equal GELDAR_LIFE_ID');
  const shard = required(env, 'GELDAR_SHARD');
  if (!/^[a-z0-9-]{1,32}$/.test(shard)) throw new Error('GELDAR_SHARD must be a shard name');
  const shardDoc = parse(await deps.readText(join(repoRoot(), 'shards', `${shard}.yaml`)));
  const password = (await deps.readText(required(env, 'GELDAR_DB_PASSWORD_FILE'))).trim();
  if (password === '') throw new Error('the database password file is empty');
  const row = await readHostRow(env, deps, password, lifeId);
  if (row === null) {
    deps.log({ event: 'no_host_config', life_id: lifeId, exit: NO_HOST_CONFIG_EXIT });
    return NO_HOST_CONFIG_EXIT;
  }
  const config = parseManagedPlayerConfig(shardDoc, lifeId, row);
  await deps.runBody(config, env);
  return 0;
}

/** One read of the host row. Database errors are reported with a fixed message, never the cause text. */
async function readHostRow(
  env: Record<string, string | undefined>,
  deps: ManagedDeps,
  password: string,
  lifeId: string,
): Promise<unknown> {
  const port = Number(env.GELDAR_DB_PORT ?? '5432');
  const db = await deps
    .openDb({
      host: required(env, 'GELDAR_DB_HOST'),
      port,
      database: env.GELDAR_DB_NAME ?? 'geldar',
      user: required(env, 'GELDAR_DB_ROLE'),
      password,
    })
    .catch(() => {
      throw new Error('the host database could not be opened');
    });
  try {
    return await db.hostConfig(lifeId);
  } catch {
    throw new Error('the host database could not read the host config');
  } finally {
    await db.close().catch(() => undefined);
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  installEntryHandlers();
  runManagedPlayer().then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      jsonLog({ event: 'fatal', error: error instanceof Error ? error.message : String(error) });
      process.exitCode = 1;
    },
  );
}
