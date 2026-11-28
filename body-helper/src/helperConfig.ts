// The helper's config (C7-03c1). Values come from env names; the two passwords come from root-only files, named by
// env (never the value). A missing required name throws at start, before any Engine or NATS call. A secret file
// that group or others can read, or that root does not own, is refused with a clear error. A bad cap is a start
// failure like any other bad value: the helper exits before it connects.
import { globalBodyCapFromEnv } from './config.ts';
import type { ManagedDbWiring } from './managed-template.ts';
import type { ManagedSettings } from './service.ts';
import { type BodyLimits, type BodyWiring, DEFAULT_NETWORK, DEFAULT_STACK } from './template.ts';

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
  /** Managed Bodies: GELDAR_MANAGED_BODIES (off by default), the managed DB wiring and the RCON file (both optional). */
  managed: ManagedSettings;
}

/** Group and other permission bits: a secret file must have none. */
const GROUP_OR_OTHER = 0o077;

/** Docker network names, at most 63 characters, starting with a letter or digit. */
const NETWORK_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,62}$/;
/** Stack label values, at most 63 characters, starting with a letter or digit (lower case only). */
const STACK_NAME = /^[a-z0-9][a-z0-9-]{0,62}$/;
/** Docker's reserved network modes, matched case-insensitively. A Body must never join one of these. */
const RESERVED_NETWORKS = ['host', 'bridge', 'none', 'default'];
/** A plain name (a DNS host or a Postgres role): letters, digits and the marks . _ - only. */
const PLAIN_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,62}$/;

function required(env: Env, name: string): string {
  const value = env[name];
  if (value === undefined || value === '') throw new Error(`missing ${name}`);
  return value;
}

function positive(env: Env, name: string, fallback?: number, max?: number): number {
  const raw = env[name];
  if (raw === undefined || raw === '') {
    if (fallback !== undefined) return fallback;
    throw new Error(`missing ${name}`);
  }
  // The upper bound is a start failure: a timer above 2147483647 ms fires at once, so a larger value would refuse all work.
  const limit = max === undefined ? '' : ` of at most ${max}`;
  if (!/^[1-9]\d*$/.test(raw) || Number(raw) > (max ?? Number.MAX_SAFE_INTEGER)) {
    throw new Error(`${name} must be a positive whole number${limit}`);
  }
  return Number(raw);
}

/** An unset or empty value takes the fallback (today's fixed value for the stack wiring). */
function withDefault(env: Env, name: string, fallback: string): string {
  const raw = env[name];
  return raw === undefined || raw === '' ? fallback : raw;
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

/** An optional Docker host path: absolute, with no comma, colon or line break (each would split a bind string). */
function optionalHostPath(env: Env, name: string): string | undefined {
  const raw = env[name];
  if (raw === undefined || raw === '') return undefined;
  if (!/^\/[^,:\r\n]*$/.test(raw))
    throw new Error(`${name} must be an absolute path with no comma, colon or line break`);
  return raw;
}

/**
 * GELDAR_MANAGED_BODIES: unset, empty or 0 is off. Off refuses every managed start before any Docker call. It is turned
 * on only after the live check (the managed Body path is not proven until then).
 */
function managedFlag(env: Env): boolean {
  const raw = env.GELDAR_MANAGED_BODIES;
  if (raw === undefined || raw === '' || raw === '0') return false;
  if (raw === '1') return true;
  throw new Error('GELDAR_MANAGED_BODIES must be 1 or 0');
}

/**
 * The managed Body's database wiring. It needs a host, a role and a secret host path. With the flag off a missing one
 * leaves it unset. With the flag on it is a load error that names the missing variable, so the helper never starts with
 * a half-wired flag. The role is the managed Body's narrow role, never the helper's own role.
 */
function managedDb(env: Env, enabled: boolean): ManagedDbWiring | undefined {
  const host = env.GELDAR_MANAGED_PG_HOST;
  const role = env.GELDAR_MANAGED_PG_ROLE;
  const secretHostPath = optionalHostPath(env, 'GELDAR_MANAGED_DB_SECRET_HOST_PATH');
  if (!host || !role || !secretHostPath) {
    if (!enabled) return undefined;
    const missing = !host
      ? 'GELDAR_MANAGED_PG_HOST'
      : !role
        ? 'GELDAR_MANAGED_PG_ROLE'
        : 'GELDAR_MANAGED_DB_SECRET_HOST_PATH';
    throw new Error(`GELDAR_MANAGED_BODIES is 1 but ${missing} is unset`);
  }
  if (!PLAIN_NAME.test(host) || !PLAIN_NAME.test(role))
    throw new Error('GELDAR_MANAGED_PG_HOST and GELDAR_MANAGED_PG_ROLE must be plain names');
  return {
    host,
    port: String(positive(env, 'GELDAR_MANAGED_PG_PORT', 5432)),
    role,
    secretHostPath,
  };
}

/**
 * The managed Body wiring as one unit. With the flag on, the RCON host path and the DB wiring are required: a missing one
 * is a load error, not a silent unset (the port alone stays optional, and defaults to 5432).
 */
function managedConfig(env: Env) {
  const enabled = managedFlag(env);
  const rconSecretHostPath = optionalHostPath(env, 'GELDAR_RCON_SECRET_HOST_PATH');
  if (enabled && rconSecretHostPath === undefined)
    throw new Error('GELDAR_MANAGED_BODIES is 1 but GELDAR_RCON_SECRET_HOST_PATH is unset');
  return {
    enabled,
    db: managedDb(env, enabled),
    rconSecretHostPath,
    observations: observationsOf(env),
  };
}

/**
 * AN-50d: GELDAR_OBSERVATIONS '1' or 'on' is forwarded to each managed Body (the golem parse turns it on there). Any other
 * value, unset or empty included, is not forwarded, so the Body's env has no key for it.
 */
function observationsOf(env: Env): string | undefined {
  const raw = env.GELDAR_OBSERVATIONS;
  return raw === '1' || raw === 'on' ? raw : undefined;
}

/** Reads the whole config. Throws on the first missing or invalid value; never includes a secret in a message. */
export function loadHelperConfig(env: Env, fs: SecretFs): HelperConfig {
  const shard = required(env, 'GELDAR_SHARD');
  // A shard name is one NATS subject token: lower-case letters, digits and hyphens only.
  if (!/^[a-z0-9-]+$/.test(shard))
    throw new Error('GELDAR_SHARD must be lower-case letters, digits or hyphens');
  const uid = env.GELDAR_SERVICE_UID ?? '1000';
  if (!/^\d+$/.test(uid)) throw new Error('GELDAR_SERVICE_UID must be digits');
  const network = withDefault(env, 'GELDAR_NETWORK', DEFAULT_NETWORK);
  // A Docker network name: a letter or digit, then up to 62 of letters, digits and the marks . _ -.
  // The charset is what refuses container:<id> (and every other ':'): ':' must stay outside NETWORK_NAME,
  // or a container:<id> join would pass. No separate container: check is needed, and none is kept.
  if (!NETWORK_NAME.test(network)) throw new Error('GELDAR_NETWORK must be a Docker network name');
  // Docker's own modes are not user networks: host shares the host's namespace, bridge and none are not user networks.
  if (RESERVED_NETWORKS.includes(network.toLowerCase()))
    throw new Error(
      'GELDAR_NETWORK must name a user network, not host, bridge, none, default or container:<id>',
    );
  const stack = withDefault(env, 'GELDAR_STACK', DEFAULT_STACK);
  if (!STACK_NAME.test(stack))
    throw new Error(
      'GELDAR_STACK must be lower-case letters, digits or hyphens, starting with a letter or digit, at most 63',
    );
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
      network,
      stack,
    },
    limits: {
      nanoCpus: positive(env, 'GELDAR_BODY_NANO_CPUS'),
      memory: positive(env, 'GELDAR_BODY_MEMORY_BYTES'),
      pidsLimit: positive(env, 'GELDAR_BODY_PIDS_LIMIT'),
    },
    cap: globalBodyCapFromEnv(env),
    // 35791 minutes is the most a sweep timer can hold (2147483647 ms).
    sweepMinutes: positive(env, 'GELDAR_SWEEP_MINUTES', 10, 35_791),
    requestDeadlineMs: positive(env, 'GELDAR_BODY_HELPER_DEADLINE_MS', 120_000, 2_147_483_647),
    managed: managedConfig(env),
  };
}
