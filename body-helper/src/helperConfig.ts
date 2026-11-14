// The helper's config (C7-03c1). Values come from env names; the two passwords come from root-only files, named by
// env (never the value). A missing required name throws at start, before any Engine or NATS call. A secret file
// that group or others can read, or that root does not own, is refused with a clear error. A bad cap is a start
// failure like any other bad value: the helper exits before it connects.
import { globalBodyCapFromEnv } from './config.ts';
import type { BodyLimits, BodyWiring } from './template.ts';

export type Env = Readonly<Record<string, string | undefined>>;

/** The file access the loader needs. The entry point passes node:fs; the tests pass a fake. */
export interface SecretFs {
  stat(path: string): { mode: number; uid: number };
  read(path: string): string;
}

export interface HelperConfig {
  shard: string;
  natsUrl: string;
  natsUser: string;
  natsPassword: string;
  pg: { host: string; port: number; database: string; user: string; password: string };
  dockerSocket: string;
  image: string;
  wiring: BodyWiring;
  limits: BodyLimits;
  cap: number;
  sweepMinutes: number;
  /** The most time one start or stop may hold the queue, in ms (GELDAR_BODY_HELPER_DEADLINE_MS, default 120 s). */
  requestDeadlineMs: number;
}

/** Group and other permission bits: a secret file must have none. */
const GROUP_OR_OTHER = 0o077;

function required(env: Env, name: string): string {
  const value = env[name];
  if (value === undefined || value === '') throw new Error(`missing ${name}`);
  return value;
}

function positive(env: Env, name: string, fallback?: number): number {
  const raw = env[name];
  if (raw === undefined || raw === '') {
    if (fallback !== undefined) return fallback;
    throw new Error(`missing ${name}`);
  }
  if (!/^[1-9]\d*$/.test(raw)) throw new Error(`${name} must be a positive whole number`);
  return Number(raw);
}

/** A root-only secret file: no group or other bits, owned by root, not empty. Errors name the variable and path. */
export function readSecret(name: string, path: string, fs: SecretFs): string {
  let mode: number;
  let uid: number;
  try {
    ({ mode, uid } = fs.stat(path));
  } catch {
    throw new Error(`cannot read the file named by ${name}: ${path}`);
  }
  if ((mode & GROUP_OR_OTHER) !== 0) {
    throw new Error(`${name} file must not be readable by group or others: ${path}`);
  }
  if (uid !== 0) throw new Error(`${name} file must be owned by root: ${path}`);
  const value = fs.read(path).trim();
  if (!value) throw new Error(`${name} file is empty: ${path}`);
  return value;
}

/** Reads the whole config. Throws on the first missing or invalid value; never includes a secret in a message. */
export function loadHelperConfig(env: Env, fs: SecretFs): HelperConfig {
  const shard = required(env, 'GELDAR_SHARD');
  // A shard name is one NATS subject token: lower-case letters, digits and hyphens only.
  if (!/^[a-z0-9-]+$/.test(shard))
    throw new Error('GELDAR_SHARD must be lower-case letters, digits or hyphens');
  const uid = env.GELDAR_SERVICE_UID ?? '1000';
  if (!/^\d+$/.test(uid)) throw new Error('GELDAR_SERVICE_UID must be digits');
  return {
    shard,
    natsUrl: required(env, 'GELDAR_NATS_URL'),
    natsUser: required(env, 'GELDAR_NATS_USER'),
    natsPassword: readSecret(
      'GELDAR_NATS_PASSWORD_FILE',
      required(env, 'GELDAR_NATS_PASSWORD_FILE'),
      fs,
    ),
    pg: {
      host: required(env, 'GELDAR_PG_HOST'),
      port: positive(env, 'GELDAR_PG_PORT', 5432),
      database: required(env, 'GELDAR_PG_DATABASE'),
      user: required(env, 'GELDAR_PG_USER'),
      password: readSecret('GELDAR_PG_PASSWORD_FILE', required(env, 'GELDAR_PG_PASSWORD_FILE'), fs),
    },
    dockerSocket: required(env, 'GELDAR_DOCKER_SOCKET'),
    image: required(env, 'GELDAR_BODY_IMAGE'),
    wiring: {
      shard,
      uid,
      mcHost: required(env, 'GELDAR_MC_HOST'),
      mcPort: required(env, 'GELDAR_MC_PORT'),
      natsUrl: required(env, 'GELDAR_NATS_URL'),
      natsUser: required(env, 'GELDAR_NATS_USER'),
      natsSecretHostPath: required(env, 'GELDAR_BODY_NATS_SECRET_HOST_PATH'),
      shardHostPath: required(env, 'GELDAR_BODY_SHARD_HOST_PATH'),
    },
    limits: {
      nanoCpus: positive(env, 'GELDAR_BODY_NANO_CPUS'),
      memory: positive(env, 'GELDAR_BODY_MEMORY_BYTES'),
      pidsLimit: positive(env, 'GELDAR_BODY_PIDS_LIMIT'),
    },
    cap: globalBodyCapFromEnv(env),
    sweepMinutes: positive(env, 'GELDAR_SWEEP_MINUTES', 10),
    requestDeadlineMs: positive(env, 'GELDAR_BODY_HELPER_DEADLINE_MS', 120_000),
  };
}
