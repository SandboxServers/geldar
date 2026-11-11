import { readFileSync } from 'node:fs';

export interface ProviderCredentials {
  readonly clientId: string;
  readonly clientSecret: string;
}

export interface RegisterConfig {
  /** Registration is off while this is true. The default is true (decision 0135 item 5). */
  readonly killSwitch: boolean;
  readonly publicUrl: string;
  readonly host: string;
  readonly port: number;
  readonly github: ProviderCredentials;
  readonly discord: ProviderCredentials;
  readonly pepper: string;
  /** The MCP server's token pepper: a minted token's hash must match what the MCP checks (0054). */
  readonly tokenPepper: string;
  readonly shard: string;
  readonly harnesses: readonly string[];
  /** The credits a new life starts with (the shard's sovereign.budget.cap_credits). */
  readonly startCredits: number;
  readonly minAccountAgeDays: number;
  readonly maxNewOwnersPerDay: number;
  readonly trustedPeers: readonly string[];
  readonly perMinute: number;
}

function intOf(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${name} must be a non-negative integer`);
  return n;
}

function required(raw: string | undefined, name: string): string {
  if (!raw) throw new Error(`${name} is not set`);
  return raw;
}

/**
 * Reads the config from an environment map. A secret is read from the file named by
 * `<NAME>_FILE`. Only the exact string `false` turns the kill switch off.
 */
export function loadConfig(
  env: Readonly<Record<string, string | undefined>>,
  readSecret: (path: string) => string = (p) => readFileSync(p, 'utf8'),
): RegisterConfig {
  const secret = (name: string): string => {
    const path = env[`${name}_FILE`];
    if (!path) throw new Error(`${name}_FILE is not set`);
    const value = readSecret(path).trim();
    if (value === '') throw new Error(`${name}_FILE is empty`);
    return value;
  };
  const pepper = secret('REGISTER_PEPPER');
  if (pepper.length < 32) throw new Error('REGISTER_PEPPER must be at least 32 characters');
  const publicUrl = (env.REGISTER_PUBLIC_URL ?? '').replace(/\/+$/, '');
  if (!publicUrl.startsWith('https://')) throw new Error('REGISTER_PUBLIC_URL must be https');
  return {
    killSwitch: env.REGISTER_KILL_SWITCH !== 'false',
    publicUrl,
    host: env.REGISTER_HOST ?? '127.0.0.1',
    port: intOf(env.REGISTER_PORT, 8090, 'REGISTER_PORT'),
    github: {
      clientId: env.REGISTER_GITHUB_CLIENT_ID ?? '',
      clientSecret: secret('REGISTER_GITHUB_SECRET'),
    },
    discord: {
      clientId: env.REGISTER_DISCORD_CLIENT_ID ?? '',
      clientSecret: secret('REGISTER_DISCORD_SECRET'),
    },
    pepper,
    tokenPepper: secret('REGISTER_TOKEN_PEPPER'),
    shard: required(env.REGISTER_SHARD, 'REGISTER_SHARD'),
    harnesses: (env.REGISTER_HARNESSES ?? 'claude-code')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => /^[a-z][a-z0-9-]{0,31}$/.test(s)),
    startCredits: intOf(env.REGISTER_START_CREDITS, 0, 'REGISTER_START_CREDITS'),
    minAccountAgeDays: intOf(
      env.REGISTER_MIN_ACCOUNT_AGE_DAYS,
      30,
      'REGISTER_MIN_ACCOUNT_AGE_DAYS',
    ),
    maxNewOwnersPerDay: intOf(
      env.REGISTER_MAX_NEW_OWNERS_PER_DAY,
      10,
      'REGISTER_MAX_NEW_OWNERS_PER_DAY',
    ),
    trustedPeers: (env.REGISTER_TRUSTED_PEERS ?? '127.0.0.1')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    perMinute: intOf(env.REGISTER_PER_MINUTE, 30, 'REGISTER_PER_MINUTE'),
  };
}
