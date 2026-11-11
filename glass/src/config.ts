/**
 * Settings for Glass: environment for plain values, a Docker secret file for the password. Glass
 * binds to loopback only and reads Postgres as the read-only role `geldar_glass` (migration 0005).
 */
import { readFileSync } from 'node:fs';

/** The only address Glass may bind to. There is no authentication in Phase 0 (wave 6 item 10). */
export const GLASS_HOST = '127.0.0.1';

/** The one Postgres role Glass connects as. The override is refused, so a write role cannot be set. */
export const GLASS_PG_USER = 'geldar_glass';

/** Milliseconds between SSE heartbeat comments (the Glass design: every 15 s). */
export const HEARTBEAT_MS = 15_000;

/** Everything `main.ts` needs. */
export interface GlassConfig {
  host: string;
  port: number;
  pg: { host: string; port: number; user: string; database: string; password: string };
  /** Most SSE clients at once; the next one gets 503. */
  sseMaxClients: number;
  /** Frames held for one slow SSE client; the oldest is dropped when it is full. */
  sseBufferFrames: number;
  /** How often the stream looks for new thoughts. */
  ssePollMs: number;
  /** False: every route answers 503 and open streams close (the kill switch, 0072 item 6). */
  enabled: boolean;
  /** Thoughts newer than this many seconds are not shown (0072 item 5). Default 60; zero shows them at once. */
  delaySeconds: number;
  /** True only when the owner rules that a living sovereign player's thoughts may show (0072 item 4). */
  showLivingSovereign: boolean;
  /** Peers whose `x-geldar-client-ip` header is believed (0090). Empty: the socket address is used. */
  trustedProxies: string[];
  /** The per-client token bucket (0072 item 3). The table holds at most `maxClients` clients. */
  rateLimit: { perMinute: number; burst: number; maxClients: number };
}

/** The all-interfaces address, accepted only inside the Colo compose network (decision 0131). */
const IN_NETWORK_BIND = '0.0.0.0';

/** The Colo compose service name of Postgres, accepted only with the same opt-in (decision 0131). */
const IN_NETWORK_PG_HOST = 'postgres';

function inNetwork(env: NodeJS.ProcessEnv): boolean {
  return env.GELDAR_IN_NETWORK_HOSTS === '1';
}

/** Loopback always; the Colo service name `postgres` only with the opt-in. Nothing else. */
function pgHostAllowed(host: string, env: NodeJS.ProcessEnv): boolean {
  if (host === '127.0.0.1' || host === 'localhost') return true;
  return host === IN_NETWORK_PG_HOST && inNetwork(env);
}

/**
 * Refuses any address but loopback. Called before every listen, so a setting cannot widen it.
 * `0.0.0.0` passes only with `GELDAR_IN_NETWORK_HOSTS=1` (decision 0131, 0093 in-network bind).
 */
export function assertLoopback(host: string, env: NodeJS.ProcessEnv = process.env): void {
  if (host === GLASS_HOST) return;
  if (host === IN_NETWORK_BIND && inNetwork(env)) return;
  throw new Error(`Glass binds to ${GLASS_HOST} only; refusing to start`);
}

/** Reads a positive integer setting, or the default when unset. */
function intSetting(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
  return value;
}

/** Reads a whole number that may be zero, or the default when unset. */
function wholeSetting(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a whole number`);
  return value;
}

/** Reads a true or false setting, or the default when unset. Any other value is refused. */
function flagSetting(env: NodeJS.ProcessEnv, name: string, fallback: boolean): boolean {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new Error(`${name} must be true or false`);
}

/** Splits a comma list of peer addresses, dropping blanks. */
function listSetting(env: NodeJS.ProcessEnv, name: string): string[] {
  return (env[name] ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '');
}

/**
 * Builds the configuration. The password comes from the file named by `GELDAR_GLASS_PG_PASSWORD_FILE`
 * and is never echoed: no error message names the file's contents or the password.
 */
export function loadGlassConfig(
  env: NodeJS.ProcessEnv = process.env,
  readFile: (path: string) => string = (path) => readFileSync(path, 'utf8'),
): GlassConfig {
  const host = env.GELDAR_GLASS_HOST ?? GLASS_HOST;
  assertLoopback(host, env);
  const user = env.GELDAR_GLASS_PG_USER ?? GLASS_PG_USER;
  if (user !== GLASS_PG_USER) throw new Error(`Glass connects only as ${GLASS_PG_USER}`);
  const pgHost = env.GELDAR_GLASS_PG_HOST ?? '127.0.0.1';
  if (!pgHostAllowed(pgHost, env)) {
    throw new Error(
      'GELDAR_GLASS_PG_HOST must be 127.0.0.1 or localhost (or postgres with GELDAR_IN_NETWORK_HOSTS=1)',
    );
  }
  const passwordFile = env.GELDAR_GLASS_PG_PASSWORD_FILE;
  if (passwordFile === undefined || passwordFile === '') {
    throw new Error('GELDAR_GLASS_PG_PASSWORD_FILE is not set');
  }
  return {
    host,
    port: intSetting(env, 'GELDAR_GLASS_PORT', 8787),
    pg: {
      host: pgHost,
      port: intSetting(env, 'GELDAR_GLASS_PG_PORT', 5432),
      user,
      database: env.GELDAR_GLASS_PG_DB ?? 'geldar',
      password: readFile(passwordFile).trim(),
    },
    sseMaxClients: intSetting(env, 'GELDAR_GLASS_SSE_MAX_CLIENTS', 8),
    sseBufferFrames: intSetting(env, 'GELDAR_GLASS_SSE_BUFFER_FRAMES', 100),
    ssePollMs: intSetting(env, 'GELDAR_GLASS_SSE_POLL_MS', 1000),
    enabled: flagSetting(env, 'GELDAR_GLASS_ENABLED', true),
    delaySeconds: wholeSetting(env, 'GELDAR_GLASS_DELAY_SECONDS', 60),
    showLivingSovereign: flagSetting(env, 'GELDAR_GLASS_SHOW_LIVING_SOVEREIGN', false),
    trustedProxies: listSetting(env, 'GELDAR_GLASS_TRUSTED_PROXIES'),
    rateLimit: {
      perMinute: intSetting(env, 'GELDAR_GLASS_RATE_PER_MINUTE', 60),
      burst: intSetting(env, 'GELDAR_GLASS_RATE_BURST', 20),
      maxClients: intSetting(env, 'GELDAR_GLASS_RATE_MAX_CLIENTS', 1024),
    },
  };
}
