import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/** Where Golem reaches the shard. Golem talks to the Velocity ingress, never to Paper directly. */
export interface GolemConfig {
  mcHost: string;
  mcPort: number;
  rconHost: string;
  rconPort: number;
  rconPasswordFile: string;
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost']);
const SHARD_UP_HINT = 'run ./geldar.ps1 shard secrets phase0';

/** Reads the settings from the environment, falling back to the Phase 0 loopback defaults. */
export function loadConfig(env: Record<string, string | undefined> = process.env): GolemConfig {
  const mcHost = env.GELDAR_MC_HOST ?? '127.0.0.1';
  // Phase 0 binds nothing but loopback (threat model): any other host is refused.
  if (!LOOPBACK_HOSTS.has(mcHost)) {
    throw new Error(`GELDAR_MC_HOST must be 127.0.0.1 or localhost, got '${mcHost}'`);
  }
  return {
    mcHost,
    mcPort: parsePort('GELDAR_MC_PORT', env.GELDAR_MC_PORT, 25565),
    rconHost: '127.0.0.1',
    rconPort: parsePort('GELDAR_RCON_PORT', env.GELDAR_RCON_PORT, 25575),
    rconPasswordFile:
      env.GELDAR_RCON_PASSWORD_FILE ?? join(repoRoot(), 'compose', 'secrets', 'rcon.txt'),
  };
}

/** Reads the RCON password from its secret file, without the trailing newline. */
export async function readRconPassword(cfg: GolemConfig): Promise<string> {
  const file = cfg.rconPasswordFile;
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`RCON password file ${file} does not exist: ${SHARD_UP_HINT}`, {
        cause: error,
      });
    }
    throw error;
  }
  const password = text.trim();
  if (password === '') {
    throw new Error(`RCON password file ${file} is empty: ${SHARD_UP_HINT}`);
  }
  return password;
}

/** The repository root: the nearest directory above this file that holds pnpm-workspace.yaml. */
export function repoRoot(): string {
  let dir = import.meta.dirname;
  while (!existsSync(join(dir, 'pnpm-workspace.yaml'))) {
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error('repository root not found: no pnpm-workspace.yaml above golem/src');
    }
    dir = parent;
  }
  return dir;
}

function parsePort(name: string, raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const port = Number(raw);
  if (!/^\d{1,5}$/.test(raw) || port < 1 || port > 65535) {
    throw new Error(`${name} must be a port from 1 to 65535, got '${raw}'`);
  }
  return port;
}
