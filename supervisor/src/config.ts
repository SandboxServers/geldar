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

/**
 * The supervisor's settings. The database password is read from SUPERVISOR_DB_PASSWORD_FILE and is the only secret;
 * the NATS credentials are read by the contract's connect (GELDAR_NATS_USER and GELDAR_NATS_PASSWORD_FILE).
 */
export function loadSupervisorConfig(
  env: Env,
  read: (path: string) => string = (path) => readFileSync(path, 'utf8'),
): SupervisorConfig {
  const shard = required(env, 'SUPERVISOR_SHARD');
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
      port: Number(env.POSTGRES_PORT || '5432'),
      database: env.POSTGRES_DB || 'geldar',
      password,
    },
  };
}
