import type { AddressInfo } from 'node:net';
import { connect } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GlassConfig } from '../config.ts';
import { buildGlass, type GlassParts } from '../server.ts';
import { KinoMetrics } from './metrics.ts';
import { otlpBody, startOtlpExporter } from './otlp.ts';
import type { FeedSource } from './relay.ts';
import { loadKinoEnv } from './wiring.ts';

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
  trustedProxies: [],
  rateLimit: { perMinute: 60, burst: 20, maxClients: 1024 },
};
const FEED: FeedSource = { subscribe: () => () => {} };
const built: GlassParts[] = [];

async function listen(feed?: FeedSource): Promise<{ port: number }> {
  const parts = buildGlass(CONFIG, feed);
  built.push(parts);
  await new Promise<void>((r) => parts.server.listen(0, '127.0.0.1', r));
  return { port: (parts.server.address() as AddressInfo).port };
}

beforeEach(() => {
  vi.stubEnv('GELDAR_KINO_ALLOWED_ORIGINS', 'https://glass.example.test');
});

afterEach(() => {
  vi.unstubAllEnvs();
  for (const p of built.splice(0)) p.close();
});

describe('Kino default off', () => {
  it('refuses to build Kino with no allowed origin, naming the variable', () => {
    vi.stubEnv('GELDAR_KINO_ALLOWED_ORIGINS', '');
    expect(() => buildGlass(CONFIG, FEED)).toThrow(/GELDAR_KINO_ALLOWED_ORIGINS/);
  });

  it('is off unless GELDAR_KINO_ENABLED is 1 or true', () => {
    expect(loadKinoEnv({}).enabled).toBe(false);
    expect(loadKinoEnv({ GELDAR_KINO_ENABLED: '0' }).enabled).toBe(false);
    expect(loadKinoEnv({ GELDAR_KINO_ENABLED: 'yes' }).enabled).toBe(false);
    expect(loadKinoEnv({ GELDAR_KINO_ENABLED: '1' }).enabled).toBe(true);
    expect(loadKinoEnv({ GELDAR_KINO_ENABLED: 'true' }).enabled).toBe(true);
  });

  it('has no /kino/ page when disabled, and serves it when enabled', async () => {
    const off = await listen();
    expect((await fetch(`http://127.0.0.1:${off.port}/kino/`)).status).toBe(404);
    const on = await listen(FEED);
    const res = await fetch(`http://127.0.0.1:${on.port}/kino/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect((await fetch(`http://127.0.0.1:${on.port}/kino/`, { method: 'POST' })).status).toBe(405);
  });

  it('serves the production entry at /kino/ and keeps the mock feed on /kino/dev.html', async () => {
    const { port } = await listen(FEED);
    const index = await (await fetch(`http://127.0.0.1:${port}/kino/`)).text();
    expect(index).toContain('src="./main.ts"');
    expect(index).not.toContain('dev.ts');
    expect((await fetch(`http://127.0.0.1:${port}/kino/main.ts`)).status).toBe(200);
    expect((await fetch(`http://127.0.0.1:${port}/kino/session.ts`)).status).toBe(200);
    const dev = await (await fetch(`http://127.0.0.1:${port}/kino/dev.html`)).text();
    expect(dev).toContain('dev.ts');
    expect((await fetch(`http://127.0.0.1:${port}/kino/targets`, { method: 'POST' })).status).toBe(
      405,
    );
  });

  it('has no /kino/targets when disabled', async () => {
    const { port } = await listen();
    expect((await fetch(`http://127.0.0.1:${port}/kino/targets`)).status).toBe(404);
  });

  it('closes a WebSocket upgrade without a 101 when disabled', async () => {
    const { port } = await listen();
    const data = await new Promise<string>((resolve) => {
      const s = connect(port, '127.0.0.1', () =>
        s.write(
          'GET /kino/ws HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n',
        ),
      );
      let got = '';
      s.on('data', (d) => {
        got += d.toString();
      });
      s.on('close', () => resolve(got));
      s.on('error', () => resolve(got));
    });
    expect(data).not.toContain('101');
  });
});

describe('the OTLP exporter', () => {
  it('is off when the endpoint is unset', () => {
    expect(startOtlpExporter(new KinoMetrics(), { endpoint: undefined })).toBeNull();
    expect(startOtlpExporter(new KinoMetrics(), { endpoint: '' })).toBeNull();
  });

  it('pushes the counters with only a reason attribute', async () => {
    const m = new KinoMetrics();
    m.onPanes(2);
    m.onBytes(40);
    m.onRefusal('kill_switch');
    const calls: { url: string; body: string }[] = [];
    const stop = startOtlpExporter(m, {
      endpoint: 'http://otel.invalid:4318/',
      intervalMs: 5,
      fetch: async (url, init) => void calls.push({ url, body: init.body }),
    });
    await new Promise((r) => setTimeout(r, 40));
    stop?.();
    expect(calls[0]?.url).toBe('http://otel.invalid:4318/v1/metrics');
    const body = JSON.parse(calls[0]?.body ?? '{}');
    const keys = JSON.stringify(body).match(/"key":"[^"]+"/g);
    expect(new Set(keys)).toEqual(new Set(['"key":"service.name"', '"key":"reason"']));
    expect(JSON.stringify(otlpBody(m.snapshot(), '1', '0'))).toContain('"asInt":"40"');
  });

  it('survives a failing endpoint', async () => {
    const stop = startOtlpExporter(new KinoMetrics(), {
      endpoint: 'http://otel.invalid',
      intervalMs: 5,
      fetch: () => Promise.reject(new Error('down')),
    });
    await new Promise((r) => setTimeout(r, 20));
    stop?.();
  });
});
