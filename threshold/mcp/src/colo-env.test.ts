import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { loadMcpConfig, repoRoot } from './config.ts';

/**
 * The environment of one service of compose/colo.yml, as compose resolves it: merge keys applied, and a
 * null value (`NAME:` with no value) left out. A copy of golem/src/colo-compose.fixture.ts, kept here so
 * the packages do not import across each other.
 */
function coloServiceEnv(service: string): Record<string, string> {
  const file = join(repoRoot(), 'compose', 'colo.yml');
  const doc = parse(readFileSync(file, 'utf8'), { merge: true }) as {
    services?: Record<string, { environment?: Record<string, string | null> }>;
  };
  const block = doc.services?.[service];
  if (block === undefined) throw new Error(`${file} has no service '${service}'`);
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(block.environment ?? {})) {
    if (value !== null) env[name] = String(value);
  }
  return env;
}

const coloShardFile = (): string => join(repoRoot(), 'shards', 'colo-mind.yaml');

// The MCP reads the geldar-mcp env block of compose/colo.yml and the sovereign block of the colo shard file.
describe('geldar-mcp in compose/colo.yml', () => {
  it('loads its config from the exact compose env and the colo shard file', async () => {
    const cfg = await loadMcpConfig({ env: coloServiceEnv('geldar-mcp'), file: coloShardFile() });
    expect(cfg.shard).toBe('colo');
    expect(cfg.http.bind).toBe('0.0.0.0');
    expect(cfg.http.allowedHosts).toEqual(['127.0.0.1', 'localhost']);
    expect(cfg.http.publicHost).toBeNull();
    expect(cfg.nats.url).toBe('nats://nats:4222');
    expect(cfg.postgres.host).toBe('postgres');
    expect(cfg.postgres.passwordFile).toBe('/run/secrets/postgres-mcp.txt');
    expect(cfg.pepperFile).toBe('/run/secrets/mcp-token-pepper.txt');
  });

  it('publishes the port the compose file publishes on loopback', async () => {
    const cfg = await loadMcpConfig({ env: coloServiceEnv('geldar-mcp'), file: coloShardFile() });
    expect(cfg.http.port).toBe(8788);
    expect(cfg.sovereign.port).toBe(8788);
  });

  it('refuses the 0.0.0.0 bind when the container flag is absent', async () => {
    const env = coloServiceEnv('geldar-mcp');
    const { GELDAR_MCP_IN_CONTAINER: _flag, ...withoutFlag } = env;
    await expect(loadMcpConfig({ env: withoutFlag, file: coloShardFile() })).rejects.toThrow(
      /GELDAR_MCP_BIND 0\.0\.0\.0 needs GELDAR_MCP_IN_CONTAINER=1/,
    );
  });

  it('refuses a bind address that is neither loopback nor the container wildcard', async () => {
    const env = { ...coloServiceEnv('geldar-mcp'), GELDAR_MCP_BIND: '10.0.0.5' };
    await expect(loadMcpConfig({ env, file: coloShardFile() })).rejects.toThrow(
      /GELDAR_MCP_BIND must be 127\.0\.0\.1/,
    );
  });
});
