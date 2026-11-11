import { EventEmitter } from 'node:events';
import {
  createServer,
  type IncomingHttpHeaders,
  request,
  type Server,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadGlassConfig } from './config.ts';
import { createHandler, SECURITY_HEADERS } from './http.ts';
import type { SqlClient } from './query.ts';
import { ROUTES } from './routes.ts';
import { SseHub } from './sse.ts';

const UNAVAILABLE = { error: { code: 'unavailable', message: 'Service unavailable' } };

/** A response that records writes and can be ended. */
class FakeRes extends EventEmitter {
  writes: string[] = [];
  writableEnded = false;
  writeHead(): this {
    return this;
  }
  write(chunk: string): boolean {
    this.writes.push(chunk);
    return true;
  }
  end(): this {
    this.writableEnded = true;
    this.emit('close');
    return this;
  }
}

const servers: Server[] = [];

afterEach(() => {
  vi.useRealTimers();
  for (const server of servers.splice(0)) server.close();
});

interface Reply {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
}

/** The db throws: a disabled Glass must not reach it. */
const noDb: SqlClient = {
  query: async () => {
    throw new Error('a disabled Glass does not query');
  },
};

async function serve(enabled: () => boolean): Promise<{ port: number; hub: SseHub }> {
  const hub = new SseHub({
    maxClients: 2,
    bufferFrames: 10,
    pollMs: 1000,
    heartbeatMs: 15_000,
    enabled,
    start: async () => ({ at: '2026-11-10 00:00:00+00', id: '' }),
    fetch: async () => [],
  });
  const server = createServer(createHandler({ db: noDb, hub, policy: { enabled } }));
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { port: (server.address() as AddressInfo).port, hub };
}

function send(port: number, method: string, path: string, host?: string): Promise<Reply> {
  const headers = host === undefined ? {} : { host };
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      let body = '';
      res.on('data', (chunk: Buffer) => {
        body += chunk.toString('utf8');
      });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('the kill switch (0072 item 6)', () => {
  it('is on by default and off only for the exact value false', () => {
    const env = { GELDAR_GLASS_PG_PASSWORD_FILE: '/run/secrets/glass_pg' };
    expect(loadGlassConfig(env, () => 'pw').enabled).toBe(true);
    expect(loadGlassConfig({ ...env, GELDAR_GLASS_ENABLED: 'false' }, () => 'pw').enabled).toBe(
      false,
    );
    expect(() => loadGlassConfig({ ...env, GELDAR_GLASS_ENABLED: 'no' }, () => 'pw')).toThrow(
      /true or false/,
    );
  });

  it('every route, the page, a write and an unknown path answer 503 with the security headers', async () => {
    const { port, hub } = await serve(() => false);
    const targets = [
      ...ROUTES.map((r) => ['GET', r.path.replace(':id', 'th-1')] as const),
      ['GET', '/'],
      ['GET', '/app.js'],
      ['POST', '/api/thoughts'],
      ['GET', '/nowhere'],
    ] as const;
    expect(targets.length).toBeGreaterThan(6);
    for (const [method, path] of targets) {
      const reply = await send(port, method, path);
      expect(reply.status, `${method} ${path}`).toBe(503);
      expect(JSON.parse(reply.body)).toEqual(UNAVAILABLE);
      for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
        expect(reply.headers[name.toLowerCase()], `${path} ${name}`).toBe(value);
      }
    }
    expect(hub.stats().clients).toBe(0);
  });

  it('answers 503 even for a foreign Host, and 200 again when switched back on', async () => {
    let on = false;
    const { port } = await serve(() => on);
    expect((await send(port, 'GET', '/api/stats', 'evil.example')).status).toBe(503);
    on = true;
    expect((await send(port, 'GET', '/api/stats')).status).toBe(200);
  });

  it('an open stream closes within one heartbeat of the switch going off', async () => {
    vi.useFakeTimers();
    let on = true;
    const hub = new SseHub({
      maxClients: 2,
      bufferFrames: 10,
      pollMs: 1000,
      heartbeatMs: 15_000,
      enabled: () => on,
      start: async () => ({ at: '2026-11-10 00:00:00+00', id: '' }),
      fetch: async () => [],
    });
    const res = new FakeRes();
    expect(hub.attach(res as unknown as ServerResponse)).toBe(true);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(res.writes).toContain(': heartbeat\n\n');
    expect(res.writableEnded).toBe(false);
    on = false;
    await vi.advanceTimersByTimeAsync(14_999);
    expect(res.writableEnded).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(res.writableEnded).toBe(true);
    expect(hub.stats().clients).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
