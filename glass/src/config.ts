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
}

/** Refuses any address but loopback. Called before every listen, so a setting cannot widen it. */
export function assertLoopback(host: string): void {
  if (host !== GLASS_HOST) {
    throw new Error(`Glass binds to ${GLASS_HOST} only; refusing to start`);
  }
}

/** Reads a positive integer setting, or the default when unset. */
function intSetting(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
  return value;
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
  assertLoopback(host);
  const user = env.GELDAR_GLASS_PG_USER ?? GLASS_PG_USER;
  if (user !== GLASS_PG_USER) throw new Error(`Glass connects only as ${GLASS_PG_USER}`);
  const passwordFile = env.GELDAR_GLASS_PG_PASSWORD_FILE;
  if (passwordFile === undefined || passwordFile === '') {
    throw new Error('GELDAR_GLASS_PG_PASSWORD_FILE is not set');
  }
  return {
    host,
    port: intSetting(env, 'GELDAR_GLASS_PORT', 8787),
    pg: {
      host: env.GELDAR_GLASS_PG_HOST ?? '127.0.0.1',
      port: intSetting(env, 'GELDAR_GLASS_PG_PORT', 5432),
      user,
      database: env.GELDAR_GLASS_PG_DB ?? 'geldar',
      password: readFile(passwordFile).trim(),
    },
    sseMaxClients: intSetting(env, 'GELDAR_GLASS_SSE_MAX_CLIENTS', 8),
    sseBufferFrames: intSetting(env, 'GELDAR_GLASS_SSE_BUFFER_FRAMES', 100),
    ssePollMs: intSetting(env, 'GELDAR_GLASS_SSE_POLL_MS', 1000),
  };
}
