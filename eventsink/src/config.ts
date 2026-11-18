/** Settings for the sink: environment for plain values, a Docker secret file for the password. */
import { readFileSync } from 'node:fs';

/**
 * The JetStream stream the Geldar-Core plugin publishes into and the sink reads from.
 * The plugin (P0-11, NatsEventPublisher.java) creates the same stream, and whichever starts first
 * wins. stream-config.test.ts fails if the plugin source, plugin/README.md or the eventsink
 * README stops matching this constant, so change them together.
 *
 * `maxBytes` caps the stored bytes (JetStream `max_bytes`); when the cap is reached the oldest
 * messages go first. It applies when the stream is created: an existing stream keeps its limits
 * until an operator edits it (see the eventsink README).
 *
 * These are the defaults. A shard whose NATS carries only its own events may set the
 * `GELDAR_EVENTS_*` keys (see `loadStreamSettings`); the plugin keeps creating this default stream.
 */
export const STREAM_CONFIG = {
  name: 'GELDAR_EVENTS',
  subjects: ['geldar.*.*'],
  storage: 'file',
  retentionDays: 30,
  maxBytes: 2 * 1024 * 1024 * 1024,
} as const;

/** The durable pull consumer's name. Fixed: the NATS allow list for the sink is scoped to it. */
export const CONSUMER_NAME = 'eventsink';

/** The stream the sink reads, created with these limits when it does not exist. */
export interface StreamSettings {
  name: string;
  subjects: string[];
  storage: 'file';
  retentionDays: number;
  maxBytes: number;
}

/** Everything `main.ts` needs. */
export interface SinkConfig {
  natsUrl: string;
  pg: { host: string; port: number; user: string; database: string; password: string };
  /** Messages fetched and written per transaction. */
  batchSize: number;
  /** How long one fetch waits for a full batch, in milliseconds. */
  fetchWaitMs: number;
  /** The stream and its filter; absent in hand-built configs, which then mean the defaults. */
  stream?: StreamSettings | undefined;
  /** The shard this sink serves; absent means accept any shard (the colo behaviour). */
  servedShard?: string | undefined;
}

/** The default stream settings, as a fresh object (the constant is `as const`). */
export function defaultStreamSettings(): StreamSettings {
  return {
    name: STREAM_CONFIG.name,
    subjects: [...STREAM_CONFIG.subjects],
    storage: STREAM_CONFIG.storage,
    retentionDays: STREAM_CONFIG.retentionDays,
    maxBytes: STREAM_CONFIG.maxBytes,
  };
}

/** A shard token, as in the shard names of the contract: `nf`, `colo`, `nf-scratch` (decision 0380). */
export const SHARD_TOKEN = /^[a-z][a-z0-9-]{1,31}$/;

/** A JetStream stream name: letters, digits, `-` and `_`, 1 to 64 characters. */
const STREAM_NAME = /^[A-Za-z0-9_-]{1,64}$/;

/** A single subject filter of three tokens, `geldar.<shard or *>.<type or *>`. */
const SUBJECT_FILTER = /^geldar\.[A-Za-z0-9_*-]+\.[A-Za-z0-9_*-]+$/;

/** Retention bounds: 1 day to 10 years, and 1 MiB to 1 TiB of stored bytes. */
const MAX_AGE_DAYS_BOUNDS = [1, 3650] as const;
const MAX_BYTES_BOUNDS = [1024 * 1024, 1024 * 1024 * 1024 * 1024] as const;

/**
 * Reads a positive integer setting, or the default when unset or empty. With `bounds`, the value
 * must also lie within them (the retention keys); without, the message is the one sinks always had.
 */
function intSetting(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  bounds?: readonly [number, number],
): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (bounds === undefined) {
    if (!Number.isInteger(value) || value < 1)
      throw new Error(`${name} must be a positive integer`);
    return value;
  }
  const [min, max] = bounds;
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be a whole number from ${min} to ${max}`);
  }
  return value;
}

/** Reads a string setting that must match `pattern`, or the default when unset or empty. */
function patternSetting(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: string,
  pattern: RegExp,
  describe: string,
): string {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  if (!pattern.test(raw)) throw new Error(`${name} must be ${describe}`);
  return raw;
}

/**
 * The stream settings from the environment. Every key is optional and defaults to today's value:
 * - `GELDAR_EVENTS_STREAM` (default `GELDAR_EVENTS`): stream name.
 * - `GELDAR_EVENTS_SUBJECTS` (default `geldar.*.*`): the one subject filter the consumer reads.
 * - `GELDAR_EVENTS_MAX_AGE_DAYS` (default 30): retention in days, 1 to 3650.
 * - `GELDAR_EVENTS_MAX_BYTES` (default 2 GiB): size cap in bytes, 1 MiB to 1 TiB.
 * An empty value counts as unset. A bad value throws, so the sink refuses to start.
 */
export function loadStreamSettings(env: NodeJS.ProcessEnv = process.env): StreamSettings {
  const base = defaultStreamSettings();
  return {
    ...base,
    name: patternSetting(
      env,
      'GELDAR_EVENTS_STREAM',
      base.name,
      STREAM_NAME,
      '1 to 64 letters, digits, "-" or "_"',
    ),
    subjects: [
      patternSetting(
        env,
        'GELDAR_EVENTS_SUBJECTS',
        base.subjects[0] ?? '',
        SUBJECT_FILTER,
        'a subject filter of three tokens, geldar.<shard>.<type>, where a token may be "*"',
      ),
    ],
    retentionDays: intSetting(
      env,
      'GELDAR_EVENTS_MAX_AGE_DAYS',
      base.retentionDays,
      MAX_AGE_DAYS_BOUNDS,
    ),
    maxBytes: intSetting(env, 'GELDAR_EVENTS_MAX_BYTES', base.maxBytes, MAX_BYTES_BOUNDS),
  };
}

/**
 * The shard this sink serves, from `GELDAR_EVENTSINK_SHARD`, or undefined when unset (accept any
 * shard, as colo does today). A value that is not a shard token throws.
 */
export function loadServedShard(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const raw = env.GELDAR_EVENTSINK_SHARD;
  if (raw === undefined || raw === '') return undefined;
  if (!SHARD_TOKEN.test(raw)) {
    throw new Error(
      'GELDAR_EVENTSINK_SHARD must be a shard token: lowercase letters, digits and "-", 2 to 32 characters, starting with a letter',
    );
  }
  return raw;
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
    stream: loadStreamSettings(env),
    servedShard: loadServedShard(env),
  };
}
