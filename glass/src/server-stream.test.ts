import { request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import type { GlassConfig } from './config.ts';
import { buildGlass, type GlassParts } from './server.ts';

const BASE: GlassConfig = {
  host: '127.0.0.1',
  port: 0,
  pg: { host: '127.0.0.1', port: 1, user: 'geldar_glass', database: 'geldar', password: 'x' },
  sseMaxClients: 10,
  ssePerClient: 1,
  sseBufferFrames: 10,
  ssePollMs: 60_000,
  enabled: true,
  delaySeconds: 0,
  showLivingSovereign: false,
  trustedProxies: [],
  rateLimit: { perMinute: 600, burst: 100, maxClients: 1024 },
};

const built: GlassParts[] = [];
const aborts: Array<() => void> = [];

afterEach(() => {
  for (const abort of aborts.splice(0)) abort();
  for (const parts of built.splice(0)) parts.close();
});

async function listen(config: GlassConfig): Promise<number> {
  const parts = buildGlass(config);
  built.push(parts);
  const server: Server = parts.server;
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as AddressInfo).port;
}

/** Opens /api/stream and resolves with the status; a 200 stream stays open until the test ends. */
function openStream(port: number, headers: Record<string, string> = {}): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port, method: 'GET', path: '/api/stream', headers },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      },
    );
    aborts.push(() => req.destroy());
    req.on('error', () => undefined);
    req.on('close', () => reject(new Error('closed')));
    req.end();
  }).catch(() => 0);
}

describe('the per-client stream cap in the built server', () => {
  it('refuses the second stream from one address with 503 at ssePerClient 1', async () => {
    const port = await listen(BASE);
    expect(await openStream(port)).toBe(200);
    expect(await openStream(port)).toBe(503);
  });

  it('counts forwarded client addresses separately when the peer is trusted', async () => {
    const port = await listen({ ...BASE, trustedProxies: ['127.0.0.1', '::ffff:127.0.0.1'] });
    expect(await openStream(port, { 'x-geldar-client-ip': '203.0.113.1' })).toBe(200);
    expect(await openStream(port, { 'x-geldar-client-ip': '203.0.113.2' })).toBe(200);
    expect(await openStream(port, { 'x-geldar-client-ip': '203.0.113.1' })).toBe(503);
  });
});
