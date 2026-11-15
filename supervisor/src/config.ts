// The supervisor's configuration (C7-03b5): read from environment variables and the secret file named by one of
// them. A failure names a variable or a path, never a value, so the message is safe to log.
import { readFileSync } from 'node:fs';

export interface SupervisorConfig {
  shard: string;
  natsServers: string;
  db: { host: string; port: number; database: string; password: string };
}

type Env = Readonly<Record<string, string | undefined>>;

function required(env: Env, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

// A shard id as the shard configs name them (shards/*.yaml): lowercase, starts with a letter. A dot, a NATS wildcard
// or whitespace would change the subjects the supervisor subscribes to, so none is accepted.
const SHARD_ID = /^[a-z][a-z0-9-]{0,31}$/;

function portOf(text: string): number {
  const port = Number(text);
  if (!/^\d+$/.test(text) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('POSTGRES_PORT is not a valid port');
  }
  return port;
}

/**
 * The supervisor's settings. The database password is read from SUPERVISOR_DB_PASSWORD_FILE and is the only secret;
 * the NATS credentials are read by the contract's connect (GELDAR_NATS_USER and GELDAR_NATS_PASSWORD_FILE).
 */
export function loadSupervisorConfig(
  env: Env,
  read: (path: string) => string = (path) => readFileSync(path, 'utf8'),
): SupervisorConfig {
  const shard = required(env, 'SUPERVISOR_SHARD');
  if (!SHARD_ID.test(shard)) throw new Error('SUPERVISOR_SHARD is not a valid shard id');
  const natsServers = required(env, 'SUPERVISOR_NATS_URL');
  const passwordFile = required(env, 'SUPERVISOR_DB_PASSWORD_FILE');
  let password: string;
  try {
    password = read(passwordFile).trim();
  } catch {
    throw new Error(
      `cannot read the database password file named by SUPERVISOR_DB_PASSWORD_FILE: ${passwordFile}`,
    );
  }
  if (password === '') {
    throw new Error('the database password file named by SUPERVISOR_DB_PASSWORD_FILE is empty');
  }
  return {
    shard,
    natsServers,
    db: {
      host: env.POSTGRES_HOST || '127.0.0.1',
      port: portOf(env.POSTGRES_PORT || '5432'),
      database: env.POSTGRES_DB || 'geldar',
      password,
    },
  };
}
