import { EventEmitter } from 'node:events';
import {
  createServer,
  type IncomingMessage,
  request,
  type Server,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadGlassConfig } from './config.ts';
import { createHandler } from './http.ts';
import { SseHub } from './sse.ts';

class FakeRes extends EventEmitter {
  accept = true;
  destroyed = false;
  writableEnded = false;
  writeHead(): this {
    return this;
  }
  write(): boolean {
    return this.accept;
  }
  end(): this {
    this.writableEnded = true;
    this.emit('close');
    return this;
  }
  destroy(): this {
    this.destroyed = true;
    this.emit('close');
    return this;
  }
}

const HEARTBEAT = 15_000;

function makeHub(perClient: number, hubs: SseHub[] = []) {
  const hub = new SseHub({
    maxClients: 50,
    perClient,
    bufferFrames: 10,
    pollMs: 1000,
    heartbeatMs: HEARTBEAT,
    start: async () => ({ at: '2026-11-10 00:00:00+00', id: '' }),
    fetch: async () => [],
  });
  hubs.push(hub);
  return hub;
}

const attach = (hub: SseHub, res: FakeRes, key: string) =>
  hub.attach(res as unknown as ServerResponse, key);

describe('the per-client stream cap', () => {
  const hubs: SseHub[] = [];
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    for (const h of hubs.splice(0)) h.close();
    vi.useRealTimers();
  });

  it('allows one stream at cap 1 and refuses the second, without writing', () => {
    const hub = makeHub(1, hubs);
    expect(attach(hub, new FakeRes(), '192.0.2.1')).toBe(true);
    expect(attach(hub, new FakeRes(), '192.0.2.1')).toBe(false);
    expect(hub.stats()).toMatchObject({ clients: 1, rejected: 1 });
  });

  it('allows `cap` streams, refuses cap + 1, and counts each client key on its own', () => {
    const hub = makeHub(2, hubs);
    expect(attach(hub, new FakeRes(), '192.0.2.1')).toBe(true);
    expect(attach(hub, new FakeRes(), '192.0.2.1')).toBe(true);
    expect(attach(hub, new FakeRes(), '192.0.2.1')).toBe(false);
    expect(attach(hub, new FakeRes(), '192.0.2.2')).toBe(true);
  });

  it.each([
    ['close', (r: FakeRes) => r.end()],
    ['abort', (r: FakeRes) => r.emit('close')],
    ['error', (r: FakeRes) => r.emit('error', new Error('socket'))],
  ])('releases the count on %s', (_name, finish) => {
    const hub = makeHub(1, hubs);
    const first = new FakeRes();
    expect(attach(hub, first, '192.0.2.1')).toBe(true);
    expect(attach(hub, new FakeRes(), '192.0.2.1')).toBe(false);
    finish(first);
    expect(hub.stats().clients).toBe(0);
    expect(attach(hub, new FakeRes(), '192.0.2.1')).toBe(true);
  });

  it('releases the count when the hub closes every stream', () => {
    const hub = makeHub(1, hubs);
    expect(attach(hub, new FakeRes(), '192.0.2.1')).toBe(true);
    hub.close();
    expect(attach(hub, new FakeRes(), '192.0.2.1')).toBe(true);
  });
});

describe('the write-stall timeout', () => {
  const hubs: SseHub[] = [];
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    for (const h of hubs.splice(0)) h.close();
    vi.useRealTimers();
  });

  it('ends a stream whose socket stays full for more than one heartbeat period', async () => {
    const hub = makeHub(1, hubs);
    const slow = new FakeRes();
    const fine = new FakeRes();
    expect(attach(hub, slow, '192.0.2.1')).toBe(true);
    expect(attach(hub, fine, '192.0.2.2')).toBe(true);
    slow.accept = false;
    // The first heartbeat fills the slow socket: the stall starts there.
    await vi.advanceTimersByTimeAsync(HEARTBEAT);
    expect(slow.destroyed).toBe(false);
    // One period later it has waited exactly one period: not yet longer.
    await vi.advanceTimersByTimeAsync(HEARTBEAT);
    expect(slow.destroyed).toBe(false);
    await vi.advanceTimersByTimeAsync(HEARTBEAT);
    expect(slow.destroyed).toBe(true);
    expect(fine.destroyed).toBe(false);
    expect(hub.stats().clients).toBe(1);
    // Its client slot is free again.
    expect(attach(hub, new FakeRes(), '192.0.2.1')).toBe(true);
  });

  it('keeps a client that drains in time', async () => {
    const hub = makeHub(1, hubs);
    const res = new FakeRes();
    attach(hub, res, '192.0.2.1');
    res.accept = false;
    await vi.advanceTimersByTimeAsync(HEARTBEAT);
    res.accept = true;
    res.emit('drain');
    await vi.advanceTimersByTimeAsync(HEARTBEAT * 3);
    expect(res.destroyed).toBe(false);
  });
});

describe('the per-client cap over HTTP', () => {
  const servers: Server[] = [];
  const hubs: SseHub[] = [];
  afterEach(() => {
    for (const h of hubs.splice(0)) h.close();
    for (const s of servers.splice(0)) s.close();
  });

  function open(port: number): Promise<{ status: number; body: string; abort: () => void }> {
    return new Promise((resolve, reject) => {
      const req = request(
        { host: '127.0.0.1', port, path: '/api/stream' },
        (res: IncomingMessage) => {
          res.on('error', () => undefined);
          res.once('data', (chunk: Buffer) =>
            resolve({
              status: res.statusCode ?? 0,
              body: chunk.toString(),
              abort: () => req.destroy(),
            }),
          );
        },
      );
      req.on('error', reject);
      req.end();
    });
  }

  it('answers the over-cap stream with the 503 body, and admits one again after an abort', async () => {
    const hub = makeHub(1, hubs);
    const db = { query: async () => ({ rows: [] }) };
    const server = createServer(createHandler({ db, hub }));
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    const first = await open(port);
    expect(first.status).toBe(200);
    const second = await open(port);
    expect(second.status).toBe(503);
    expect(JSON.parse(second.body)).toEqual({ error: 'too many streams' });
    first.abort();
    const deadline = Date.now() + 2000;
    while (hub.stats().clients > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 5));
    }
    const third = await open(port);
    expect(third.status).toBe(200);
    third.abort();
  });
});

describe('the per-client cap setting', () => {
  const read = () => 'pw';
  it('defaults to 2 and reads GELDAR_GLASS_SSE_PER_CLIENT', () => {
    const base = { GELDAR_GLASS_PG_PASSWORD_FILE: '/run/secrets/x' };
    expect(loadGlassConfig(base, read).ssePerClient).toBe(2);
    expect(loadGlassConfig({ ...base, GELDAR_GLASS_SSE_PER_CLIENT: '3' }, read).ssePerClient).toBe(
      3,
    );
    expect(() => loadGlassConfig({ ...base, GELDAR_GLASS_SSE_PER_CLIENT: '0' }, read)).toThrow();
  });
});
