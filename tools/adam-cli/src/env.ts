/**
 * The environment the host processes get: the `.env` file under the process environment, only
 * the keys the Mind side reads, and a loopback check (decision 0050). Pure.
 */

/** The keys the three processes read (`.env.example` lists them with their defaults). */
export const ENV_KEYS = [
  'GELDAR_SHARD',
  'GELDAR_NATS_URL',
  'GELDAR_MC_HOST',
  'GELDAR_MC_PORT',
  'GELDAR_MIND_WS_URL',
  'OLLAMA_URL',
  'POSTGRES_HOST',
  'POSTGRES_PORT',
  'POSTGRES_USER',
  'POSTGRES_DB',
  'POSTGRES_PASSWORD_FILE',
] as const;

/** Parses `KEY=value` lines; blank lines and `#` comments are skipped, matching quotes are removed. */
export function parseEnvFile(source: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (value.length >= 2 && /^(["']).*\1$/.test(value)) value = value.slice(1, -1);
    if (/^[A-Z][A-Z0-9_]*$/.test(key)) out[key] = value;
  }
  return out;
}

/** The allow-listed keys: the process environment wins over the `.env` file. */
export function adamEnv(
  fileEnv: Record<string, string>,
  processEnv: Record<string, string | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of ENV_KEYS) {
    const value = processEnv[key] ?? fileEnv[key];
    if (value !== undefined && value !== '') out[key] = value;
  }
  return out;
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

/** Every address key must name a loopback host; returns one message per key that does not. */
export function loopbackProblems(env: Record<string, string>): string[] {
  const problems: string[] = [];
  for (const key of ['GELDAR_NATS_URL', 'GELDAR_MIND_WS_URL', 'OLLAMA_URL'] as const) {
    const value = env[key];
    if (value === undefined) continue;
    let host: string | null = null;
    try {
      host = new URL(value).hostname;
    } catch {
      // reported below
    }
    if (host === null || !LOOPBACK.has(host)) {
      problems.push(
        `${key} must point at loopback (127.0.0.1); every address is loopback in Phase 0`,
      );
    }
  }
  for (const key of ['POSTGRES_HOST', 'GELDAR_MC_HOST'] as const) {
    const value = env[key];
    if (value !== undefined && !LOOPBACK.has(value)) {
      problems.push(
        `${key} must be a loopback host (127.0.0.1); every address is loopback in Phase 0`,
      );
    }
  }
  return problems;
}

/** One service of `docker compose ps --format json`. */
export interface ComposeRow {
  service: string;
  state: string;
  health: string;
}

/** Parses the output of `docker compose ps --format json`: one JSON object per line, or an array. */
export function parseComposePs(output: string): ComposeRow[] {
  const trimmed = output.trim();
  if (trimmed === '') return [];
  const objects: unknown[] = trimmed.startsWith('[')
    ? (JSON.parse(trimmed) as unknown[])
    : trimmed.split(/\r?\n/).map((line) => JSON.parse(line) as unknown);
  return objects.map((o) => {
    const row = o as { Service?: unknown; State?: unknown; Health?: unknown };
    return {
      service: typeof row.Service === 'string' ? row.Service : '',
      state: typeof row.State === 'string' ? row.State : '',
      health: typeof row.Health === 'string' ? row.Health : '',
    };
  });
}

/** The services the Mind side needs up, from `compose/phase0.yml`. */
export const REQUIRED_SERVICES = ['postgres', 'nats', 'paper', 'velocity', 'eventsink'] as const;

/** One message per required service that is absent, not running or not healthy. */
export function shardProblems(rows: ComposeRow[], shard: string): string[] {
  const problems: string[] = [];
  for (const name of REQUIRED_SERVICES) {
    const row = rows.find((r) => r.service === name);
    if (row === undefined) problems.push(`${name} is not part of the running shard`);
    else if (row.state !== 'running') problems.push(`${name} is ${row.state || 'not running'}`);
    else if (row.health !== '' && row.health !== 'healthy')
      problems.push(`${name} is ${row.health}`);
  }
  return problems.length === 0
    ? []
    : [...problems, `start it with: ./geldar.ps1 shard up ${shard}`];
}
