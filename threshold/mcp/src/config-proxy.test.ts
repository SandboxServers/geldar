import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { parseMcpConfig, repoRoot } from './config.ts';

const ENV = {
  GELDAR_MCP_DB_PASSWORD_FILE: '/run/secrets/postgres-mcp.txt',
  GELDAR_MCP_PEPPER_FILE: '/run/secrets/mcp-token-pepper.txt',
};

/** A fresh copy of the shipped shard file, so a test can change one key without touching the others. */
function shardDoc(): Record<string, any> {
  const text = readFileSync(join(repoRoot(), 'shards', 'phase0.yaml'), 'utf8');
  return structuredClone(parse(text)) as Record<string, any>;
}

describe('proxy and client address settings', () => {
  it('refuses a public host with no trusted proxy named, in yaml or in the environment', () => {
    expect(() =>
      parseMcpConfig(shardDoc(), { env: { ...ENV, GELDAR_MCP_PUBLIC_HOST: 'geldar.example.net' } }),
    ).toThrow('no trusted proxy is named');
  });

  it('accepts a public host once the proxy is named in the environment', () => {
    const config = parseMcpConfig(shardDoc(), {
      env: {
        ...ENV,
        GELDAR_MCP_PUBLIC_HOST: 'geldar.example.net',
        GELDAR_MCP_TRUSTED_PROXIES: '10.0.0.5, 10.0.1.0/24',
      },
    });
    expect(config.http.trustedProxies).toEqual(['10.0.0.5', '10.0.1.0/24']);
    expect(config.http.allowedHosts[0]).toBe('geldar.example.net');
  });

  it('lets GELDAR_MCP_TRUSTED_PROXIES override a yaml list', () => {
    const doc = shardDoc();
    doc.sovereign.mcp.trusted_proxies = ['10.9.9.9'];
    const config = parseMcpConfig(doc, { env: { ...ENV, GELDAR_MCP_TRUSTED_PROXIES: '10.1.1.1' } });
    expect(config.http.trustedProxies).toEqual(['10.1.1.1']);
  });

  it('refuses a prefix length 0 in the environment list, as it refuses one in yaml', () => {
    expect(() =>
      parseMcpConfig(shardDoc(), {
        env: { ...ENV, GELDAR_MCP_TRUSTED_PROXIES: '10.0.0.1,0.0.0.0/0' },
      }),
    ).toThrow('GELDAR_MCP_TRUSTED_PROXIES[1] has prefix length 0');
  });

  it('refuses an IPv4 prefix shorter than /8 and an IPv6 prefix shorter than /32, naming the key', () => {
    for (const entry of ['0.0.0.0/1', '10.0.0.0/7', '::/1', '2001:db8::/31']) {
      const doc = shardDoc();
      doc.public = { trusted_proxies: [entry] };
      expect(() => parseMcpConfig(doc, { env: ENV }), entry).toThrow(
        /public\.trusted_proxies\[0\] has a prefix shorter than \/(8|32)/,
      );
    }
    expect(() =>
      parseMcpConfig(shardDoc(), { env: { ...ENV, GELDAR_MCP_TRUSTED_PROXIES: '10.0.0.0/7' } }),
    ).toThrow('GELDAR_MCP_TRUSTED_PROXIES[0] has a prefix shorter than /8');
  });

  it('refuses an IPv6 prefix that covers IPv4-mapped space below /104', () => {
    for (const entry of [
      '::ffff:0.0.0.0/96',
      '::ffff:0:0/96',
      '0:0:0:0:0:ffff:0:0/96',
      '::/32',
      '::ffff:192.0.2.0/103',
    ]) {
      const doc = shardDoc();
      doc.public = { trusted_proxies: [entry] };
      expect(() => parseMcpConfig(doc, { env: ENV }), entry).toThrow(
        /public\.trusted_proxies\[0\] has a prefix shorter than \/104/,
      );
    }
  });

  it('accepts a mapped /104 and ::/96, which do not reach below the IPv4 floor', () => {
    const doc = shardDoc();
    doc.public = { trusted_proxies: ['::ffff:10.0.0.0/104', '::/96', '::ffff:127.0.0.1'] };
    expect(parseMcpConfig(doc, { env: ENV }).public.trustedProxies).toHaveLength(3);
  });

  it('accepts an IPv4 /8 and an IPv6 /32, the shortest prefixes allowed', () => {
    const doc = shardDoc();
    doc.public = { trusted_proxies: ['10.0.0.0/8', '2001:db8::/32'] };
    expect(parseMcpConfig(doc, { env: ENV }).public.trustedProxies).toEqual([
      '10.0.0.0/8',
      '2001:db8::/32',
    ]);
  });

  it('reads client_ip_header from yaml, defaulting to x-geldar-client-ip', () => {
    const doc = shardDoc();
    doc.sovereign.mcp.client_ip_header = 'x-geldar-client-ip';
    expect(parseMcpConfig(doc, { env: ENV }).http.clientIpHeader).toBe('x-geldar-client-ip');
    expect(parseMcpConfig(shardDoc(), { env: ENV }).http.clientIpHeader).toBe('x-geldar-client-ip');
  });

  it('lets GELDAR_MCP_CLIENT_IP_HEADER override the yaml header', () => {
    const config = parseMcpConfig(shardDoc(), {
      env: { ...ENV, GELDAR_MCP_CLIENT_IP_HEADER: 'x-forwarded-for' },
    });
    expect(config.http.clientIpHeader).toBe('x-forwarded-for');
  });

  it('refuses a header name that is not a lowercase header token', () => {
    expect(() =>
      parseMcpConfig(shardDoc(), { env: { ...ENV, GELDAR_MCP_CLIENT_IP_HEADER: 'X Bad Name' } }),
    ).toThrow('GELDAR_MCP_CLIENT_IP_HEADER must be a lowercase header name');
  });
});
