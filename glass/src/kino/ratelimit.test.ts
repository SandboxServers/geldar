import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GlassConfig } from '../config.ts';
import { buildGlass, type GlassParts } from '../server.ts';
import type { FeedSource } from './relay.ts';

const CONFIG: GlassConfig = {
  host: '127.0.0.1',
  port: 0,
  pg: { host: '127.0.0.1', port: 5432, user: 'geldar_glass', database: 'geldar', password: 'x' },
  sseMaxClients: 2,
  sseBufferFrames: 10,
  ssePollMs: 1000,
  enabled: true,
  delaySeconds: 0,
  showLivingSovereign: false,
  trustedProxies: ['127.0.0.1'],
  rateLimit: { perMinute: 60, burst: 20, maxClients: 1024 },
};
const FEED: FeedSource = { subscribe: () => () => {} };
const built: GlassParts[] = [];

async function listen(): Promise<string> {
  const parts = buildGlass(CONFIG, FEED);
  built.push(parts);
  await new Promise<void>((r) => parts.server.listen(0, '127.0.0.1', r));
  return `http://127.0.0.1:${(parts.server.address() as AddressInfo).port}`;
}

const get = (base: string, path: string, headers: Record<string, string> = {}) =>
  fetch(base + path, { headers });

beforeEach(() => {
  vi.stubEnv('GELDAR_KINO_ALLOWED_ORIGINS', 'https://glass.example.test');
});

afterEach(() => {
  vi.unstubAllEnvs();
  for (const p of built.splice(0)) p.close();
});

describe('Kino rate limit buckets', () => {
  it('serves many static files without spending the targets bucket', async () => {
    const base = await listen();
    // Far more than the general burst of 20: a page load plus reloads.
    for (let i = 0; i < 60; i++) expect((await get(base, '/kino/')).status).toBe(200);
    for (let i = 0; i < 10; i++) expect((await get(base, '/kino/targets')).status).not.toBe(429);
  });

  it('gives /kino/targets its own bucket of 10, then 429 with Retry-After', async () => {
    const base = await listen();
    for (let i = 0; i < 10; i++) expect((await get(base, '/kino/targets')).status).not.toBe(429);
    const refused = await get(base, '/kino/targets');
    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
    // The static files are a different bucket and still answer.
    expect((await get(base, '/kino/')).status).toBe(200);
  });

  it('keys the buckets by the trusted forwarded address, not the socket', async () => {
    const base = await listen();
    const a = { 'x-geldar-client-ip': '203.0.113.1' };
    const b = { 'x-geldar-client-ip': '203.0.113.2' };
    for (let i = 0; i < 10; i++) expect((await get(base, '/kino/targets', a)).status).not.toBe(429);
    expect((await get(base, '/kino/targets', a)).status).toBe(429);
    // Same socket peer (Caddy), another visitor: not limited.
    expect((await get(base, '/kino/targets', b)).status).not.toBe(429);
  });

  it('caches static files with an ETag (304 on reload) and keeps targets no-store', async () => {
    const base = await listen();
    const first = await get(base, '/kino/');
    const etag = first.headers.get('etag');
    expect(etag).toMatch(/^"[\w-]+"$/);
    expect(first.headers.get('cache-control')).toMatch(/max-age=\d+/);
    const again = await get(base, '/kino/', { 'if-none-match': etag as string });
    expect(again.status).toBe(304);
    expect((await get(base, '/kino/targets')).headers.get('cache-control')).toBe('no-store');
  });
});
