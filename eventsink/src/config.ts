/** Settings for the sink: environment for plain values, a Docker secret file for the password. */
import { readFileSync } from 'node:fs';

/**
 * The JetStream stream the Geldar-Core plugin publishes into and the sink reads from.
 * The plugin (P0-11, NatsEventPublisher.java) creates the same stream, and whichever starts first
 * wins. stream-config.test.ts fails if the plugin source, plugin/README.md or the eventsink
 * README stops matching this constant, so change them together.
 */
export const STREAM_CONFIG = {
  name: 'GELDAR_EVENTS',
  subjects: ['geldar.*.*'],
  storage: 'file',
  retentionDays: 30,
} as const;

/** The durable pull consumer's name. */
export const CONSUMER_NAME = 'eventsink';

/** Everything `main.ts` needs. */
export interface SinkConfig {
  natsUrl: string;
  pg: { host: string; port: number; user: string; database: string; password: string };
  /** Messages fetched and written per transaction. */
  batchSize: number;
  /** How long one fetch waits for a full batch, in milliseconds. */
  fetchWaitMs: number;
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
 * Builds the configuration. The password comes from the file named by `POSTGRES_PASSWORD_FILE`
 * (a Docker secret), never from a plain environment value.
 */
export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  readFile: (path: string) => string = (path) => readFileSync(path, 'utf8'),
): SinkConfig {
  const passwordFile = env.POSTGRES_PASSWORD_FILE;
  if (passwordFile === undefined || passwordFile === '') {
    throw new Error('POSTGRES_PASSWORD_FILE is not set');
  }
  return {
    natsUrl: env.GELDAR_NATS_URL ?? 'nats://127.0.0.1:4222',
    pg: {
      host: env.POSTGRES_HOST ?? '127.0.0.1',
      port: intSetting(env, 'POSTGRES_PORT', 5432),
      user: env.POSTGRES_USER ?? 'geldar',
      database: env.POSTGRES_DB ?? 'geldar',
      password: readFile(passwordFile).trim(),
    },
    batchSize: intSetting(env, 'EVENTSINK_BATCH_SIZE', 50),
    fetchWaitMs: intSetting(env, 'EVENTSINK_FETCH_WAIT_MS', 1000),
  };
}
