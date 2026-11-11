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

describe('public block: proxy trust and client-address header', () => {
  it('reads public.trusted_proxies and public.client_ip_header', () => {
    const doc = shardDoc();
    doc.public = { trusted_proxies: ['10.2.2.2'], client_ip_header: 'x-real-client' };
    const config = parseMcpConfig(doc, { env: ENV });
    expect(config.public.trustedProxies).toEqual(['10.2.2.2']);
    expect(config.public.clientIpHeader).toBe('x-real-client');
    expect(config.http.trustedProxies).toEqual(['10.2.2.2']);
    expect(config.http.clientIpHeader).toBe('x-real-client');
  });

  it('prefers public.trusted_proxies over sovereign.mcp.trusted_proxies', () => {
    const doc = shardDoc();
    doc.sovereign.mcp.trusted_proxies = ['10.9.9.9'];
    doc.public = { trusted_proxies: ['10.2.2.2'] };
    const config = parseMcpConfig(doc, { env: ENV });
    expect(config.http.trustedProxies).toEqual(['10.2.2.2']);
  });

  it('keeps sovereign.mcp.trusted_proxies as the fallback when the public block leaves it out', () => {
    const doc = shardDoc();
    doc.sovereign.mcp.trusted_proxies = ['10.9.9.9'];
    doc.sovereign.mcp.client_ip_header = 'x-old-header';
    const config = parseMcpConfig(doc, { env: ENV });
    expect(config.public.trustedProxies).toEqual(['10.9.9.9']);
    expect(config.public.clientIpHeader).toBe('x-old-header');
    expect(config.http.clientIpHeader).toBe('x-old-header');
  });

  it('lets the environment override public.trusted_proxies and public.client_ip_header', () => {
    const doc = shardDoc();
    doc.public = { trusted_proxies: ['10.2.2.2'], client_ip_header: 'x-real-client' };
    const config = parseMcpConfig(doc, {
      env: {
        ...ENV,
        GELDAR_MCP_TRUSTED_PROXIES: '10.1.1.1',
        GELDAR_MCP_CLIENT_IP_HEADER: 'x-env-client',
      },
    });
    expect(config.http.trustedProxies).toEqual(['10.1.1.1']);
    expect(config.http.clientIpHeader).toBe('x-env-client');
    expect(config.public.trustedProxies).toEqual(['10.2.2.2']);
  });

  it('defaults to no trusted proxy and the x-geldar-client-ip header', () => {
    const config = parseMcpConfig(shardDoc(), { env: ENV });
    expect(config.public.trustedProxies).toEqual([]);
    expect(config.public.clientIpHeader).toBe('x-geldar-client-ip');
  });

  it('refuses a prefix length 0 in public.trusted_proxies, naming the key', () => {
    const doc = shardDoc();
    doc.public = { trusted_proxies: ['0.0.0.0/0'] };
    expect(() => parseMcpConfig(doc, { env: ENV })).toThrow('public.trusted_proxies[0]');
  });

  it('refuses a header name with capitals in public.client_ip_header', () => {
    const doc = shardDoc();
    doc.public = { client_ip_header: 'X-Real-Client' };
    expect(() => parseMcpConfig(doc, { env: ENV })).toThrow('public.client_ip_header');
  });
});

describe('public block: rate limit and kill switch', () => {
  it('defaults the rate limit to 60 a minute with a burst of 20, and the kill switch off', () => {
    const config = parseMcpConfig(shardDoc(), { env: ENV });
    expect(config.public.rateLimit).toEqual({ perMinute: 60, burst: 20 });
    expect(config.public.killSwitch).toBe(false);
  });

  it('reads public.rate_limit and public.kill_switch', () => {
    const doc = shardDoc();
    doc.public = { rate_limit: { per_minute: 30, burst: 5 }, kill_switch: true };
    const config = parseMcpConfig(doc, { env: ENV });
    expect(config.public.rateLimit).toEqual({ perMinute: 30, burst: 5 });
    expect(config.public.killSwitch).toBe(true);
  });

  it('defaults a missing key inside public.rate_limit', () => {
    const doc = shardDoc();
    doc.public = { rate_limit: { burst: 7 } };
    const config = parseMcpConfig(doc, { env: ENV });
    expect(config.public.rateLimit).toEqual({ perMinute: 60, burst: 7 });
  });

  it('refuses a per_minute of 0 and a burst above 1000, naming the key', () => {
    const zero = shardDoc();
    zero.public = { rate_limit: { per_minute: 0 } };
    expect(() => parseMcpConfig(zero, { env: ENV })).toThrow(
      'public.rate_limit.per_minute must be an integer from 1 to 10000',
    );
    const big = shardDoc();
    big.public = { rate_limit: { burst: 1001 } };
    expect(() => parseMcpConfig(big, { env: ENV })).toThrow(
      'public.rate_limit.burst must be an integer from 1 to 1000',
    );
  });

  it('refuses a kill_switch that is not true or false', () => {
    const doc = shardDoc();
    doc.public = { kill_switch: 'yes' };
    expect(() => parseMcpConfig(doc, { env: ENV })).toThrow(
      'public.kill_switch must be true or false',
    );
  });
});
