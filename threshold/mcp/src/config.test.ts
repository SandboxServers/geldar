import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { lifeIdFor, loadMcpConfig, parseMcpConfig, publicHostName, repoRoot } from './config.ts';

const ENV = {
  GELDAR_MCP_DB_PASSWORD_FILE: '/run/secrets/postgres-mcp.txt',
  GELDAR_MCP_PEPPER_FILE: '/run/secrets/mcp-token-pepper.txt',
};

/** A fresh copy of the shipped shard file, so a test can break one key without touching the others. */
function shardDoc(): Record<string, any> {
  const text = readFileSync(join(repoRoot(), 'shards', 'phase0.yaml'), 'utf8');
  return structuredClone(parse(text)) as Record<string, any>;
}

describe('loadMcpConfig', () => {
  it('reads the shipped phase0 shard file with the local defaults', async () => {
    const config = await loadMcpConfig({ env: ENV });
    expect(config.shard).toBe('phase0');
    expect(config.tickRate).toBe(20);
    expect(config.worldBorderRadius).toBe(1500);
    expect(config.chat.radius).toBe(32);
    expect(config.plan.expiresAfterTicks).toBe(1200);
    expect(config.sovereign.waitCapSeconds).toBe(240);
    expect(config.sovereign.players.map((p) => p.lifeId)).toContain('ag_jason_01');
    expect(config.sovereign.players.map((p) => p.lifeId)).toContain('ag_test_01');
    expect(config.http).toEqual({
      bind: '127.0.0.1',
      port: 8788,
      allowedHosts: ['host.docker.internal', '127.0.0.1', 'localhost'],
      publicHost: null,
      trustedProxies: [],
      clientIpHeader: 'cf-connecting-ip',
      maxConnections: 320,
      maxConnectionsPerAddress: 80,
      maxBodyBytes: 65536,
    });
    expect(config.nats.url).toBe('nats://127.0.0.1:4222');
    expect(config.postgres.user).toBe('geldar_mcp');
  });

  it('derives the connection caps from owner_cap_owner when the shard file leaves them out', () => {
    const doc = shardDoc();
    doc.sovereign.owner_cap_owner = 5;
    const config = parseMcpConfig(doc, { env: ENV });
    expect(config.http.maxConnectionsPerAddress).toBe(20);
    expect(config.http.maxConnections).toBe(80);
  });

  it('keeps an explicit connection cap over the derived one', () => {
    const doc = shardDoc();
    doc.sovereign.mcp.max_connections_per_address = 7;
    doc.sovereign.mcp.max_connections = 9;
    const config = parseMcpConfig(doc, { env: ENV });
    expect(config.http.maxConnectionsPerAddress).toBe(7);
    expect(config.http.maxConnections).toBe(9);
  });

  it('names the missing key when a sovereign key is absent', () => {
    const doc = shardDoc();
    delete doc.sovereign.mcp.wait_cap_seconds;
    expect(() => parseMcpConfig(doc, { env: ENV })).toThrow(
      'sovereign.mcp.wait_cap_seconds is missing',
    );
  });

  it('fails fast when the password file is not named', () => {
    expect(() => parseMcpConfig(shardDoc(), { env: { GELDAR_MCP_PEPPER_FILE: '/p' } })).toThrow(
      'GELDAR_MCP_DB_PASSWORD_FILE is required',
    );
  });

  it('refuses a trusted proxy range with prefix length 0, which would trust every peer', () => {
    for (const entry of ['0.0.0.0/0', '::/0']) {
      const doc = shardDoc();
      doc.sovereign.mcp.trusted_proxies = [entry];
      expect(() => parseMcpConfig(doc, { env: ENV })).toThrow(
        'has prefix length 0, which would trust every peer',
      );
    }
  });

  it('refuses a non-loopback bind without the container flag', () => {
    expect(() =>
      parseMcpConfig(shardDoc(), { env: { ...ENV, GELDAR_MCP_BIND: '0.0.0.0' } }),
    ).toThrow('needs GELDAR_MCP_IN_CONTAINER=1');
    expect(() =>
      parseMcpConfig(shardDoc(), { env: { ...ENV, GELDAR_MCP_BIND: '192.168.1.20' } }),
    ).toThrow('must be 127.0.0.1');
  });

  it('accepts 0.0.0.0 inside the container', () => {
    const config = parseMcpConfig(shardDoc(), {
      env: { ...ENV, GELDAR_MCP_BIND: '0.0.0.0', GELDAR_MCP_IN_CONTAINER: '1' },
    });
    expect(config.http.bind).toBe('0.0.0.0');
  });

  it('keeps the public host with the dev hosts when it is set', () => {
    const config = parseMcpConfig(shardDoc(), {
      env: {
        ...ENV,
        GELDAR_MCP_PUBLIC_HOST: 'MCP.Example.com',
        GELDAR_MCP_TRUSTED_PROXIES: '10.0.0.5',
      },
    });
    expect(config.http.publicHost).toBe('mcp.example.com');
    expect(config.http.allowedHosts[0]).toBe('mcp.example.com');
    expect(config.http.allowedHosts).toContain('host.docker.internal');
  });

  it('refuses a wait cap of 241', () => {
    const doc = shardDoc();
    doc.sovereign.mcp.wait_cap_seconds = 241;
    expect(() => parseMcpConfig(doc, { env: ENV })).toThrow(
      'sovereign.mcp.wait_cap_seconds must be an integer from 1 to 240',
    );
  });

  it('refuses a player id with an underscore', () => {
    const doc = shardDoc();
    doc.sovereign.players[0].player_id = 'ag_jason_01';
    expect(() => parseMcpConfig(doc, { env: ENV })).toThrow(
      'must be lowercase letters, digits and hyphens',
    );
  });

  it('refuses a ranger whose life id is Adam', () => {
    const doc = shardDoc();
    const adamLife: string = doc.mind.agent.username;
    doc.sovereign.players[0].player_id = adamLife.replace(/_/g, '-');
    doc.sovereign.players[0].life_id = adamLife;
    expect(() => parseMcpConfig(doc, { env: ENV })).toThrow("is Adam's life");
  });

  it('derives the life id by replacing hyphens with underscores', () => {
    expect(lifeIdFor('ag-kimberly-01')).toBe('ag_kimberly_01');
  });
});

describe('publicHostName', () => {
  it('accepts a DNS name', () => {
    expect(publicHostName('mcp.example.com')).toBe('mcp.example.com');
  });

  it('refuses an IP literal', () => {
    expect(() => publicHostName('203.0.113.7')).toThrow('is an IP literal');
    expect(() => publicHostName('[2001:db8::1]')).toThrow('is an IP literal');
  });

  it('refuses localhost', () => {
    expect(() => publicHostName('localhost')).toThrow('must not be localhost');
  });

  it('refuses *.internal and *.local names', () => {
    expect(() => publicHostName('db.internal')).toThrow('*.internal');
    expect(() => publicHostName('printer.local')).toThrow('*.local');
  });

  it('refuses userinfo', () => {
    expect(() => publicHostName('user@mcp.example.com')).toThrow('userinfo');
  });
});
