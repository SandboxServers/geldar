import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { RateLimiter } from './guard.ts';
import { createHandler } from './http.ts';
import type { PublicPolicy } from './policy.ts';
import type { SqlClient } from './query.ts';
import type { SseHub } from './sse.ts';

/** A database that must not be read: the static page is served without a query. */
const db: SqlClient = {
  query: async () => {
    throw new Error('the database must not be queried');
  },
};

const servers: Server[] = [];

afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

/** Starts the handler on a loopback port the OS picks, with the given public policy. */
async function start(policy: Partial<PublicPolicy>): Promise<{ port: number }> {
  const hub = {} as unknown as SseHub;
  const server = createServer(createHandler({ db, hub, policy }));
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { port: (server.address() as AddressInfo).port };
}

interface Reply {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

function get(port: number, headers: Record<string, string> = {}): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method: 'GET', path: '/', headers }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        body += chunk;
      });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('Glass rate limit on the wire', () => {
  it('serves the last request of the burst, then refuses with 429, Retry-After and the fixed body', async () => {
    const clock = { at: 1_000_000 };
    const limiter = new RateLimiter({
      perMinute: 60,
      burst: 2,
      maxClients: 8,
      now: () => clock.at,
    });
    const { port } = await start({ limiter });
    expect((await get(port)).status).toBe(200);
    expect((await get(port)).status).toBe(200);
    const refused = await get(port);
    expect(refused.status).toBe(429);
    expect(refused.headers['retry-after']).toBe('1');
    expect(JSON.parse(refused.body)).toEqual({
      error: { code: 'rate_limited', message: 'Too many requests' },
      retryAfter: 1,
    });
    expect(refused.body).not.toMatch(/stack|at |\.ts|127\.0\.0\.1|password/i);
    expect(refused.headers['content-security-policy']).toContain("default-src 'none'");
  });

  it('charges a forwarded client address only when the socket peer is trusted', async () => {
    const clock = { at: 1_000_000 };
    const limiter = new RateLimiter({
      perMinute: 60,
      burst: 1,
      maxClients: 8,
      now: () => clock.at,
    });
    const { port } = await start({ limiter, trustedProxies: new Set(['127.0.0.1']) });
    expect((await get(port, { 'x-geldar-client-ip': '203.0.113.1' })).status).toBe(200);
    // A second forwarded client is a new bucket, so it is served too.
    expect((await get(port, { 'x-geldar-client-ip': '203.0.113.2' })).status).toBe(200);
    // The first client is refused: its bucket is empty.
    expect((await get(port, { 'x-geldar-client-ip': '203.0.113.1' })).status).toBe(429);
  });

  it('ignores the forwarded header when the peer is not in the trusted list', async () => {
    const clock = { at: 1_000_000 };
    const limiter = new RateLimiter({
      perMinute: 60,
      burst: 1,
      maxClients: 8,
      now: () => clock.at,
    });
    const { port } = await start({ limiter, trustedProxies: new Set() });
    expect((await get(port, { 'x-geldar-client-ip': '203.0.113.1' })).status).toBe(200);
    // The same socket peer is charged, so a new forwarded address does not get a new bucket.
    expect((await get(port, { 'x-geldar-client-ip': '203.0.113.2' })).status).toBe(429);
  });
});

interface Sent {
  method: string;
  path: string;
  headers?: Record<string, string>;
  body?: string;
}

function send(port: number, sent: Sent): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port, method: sent.method, path: sent.path, headers: sent.headers },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          body += chunk;
        });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      },
    );
    req.on('error', reject);
    req.end(sent.body);
  });
}

describe('Glass request size cap on the wire', () => {
  it('serves a target of exactly 2048 characters and refuses 2049 with 414 and the headers', async () => {
    const { port } = await start({});
    const atLimit = `/?pad=${'a'.repeat(2048 - '/?pad='.length)}`;
    expect(atLimit.length).toBe(2048);
    expect((await send(port, { method: 'GET', path: atLimit })).status).toBe(200);
    const over = await send(port, { method: 'GET', path: `${atLimit}a` });
    expect(over.status).toBe(414);
    expect(JSON.parse(over.body)).toEqual({ error: 'request target is too long' });
    expect(over.headers['content-security-policy']).toContain("default-src 'none'");
    expect(over.headers['x-content-type-options']).toBe('nosniff');
  });

  it('admits a declared body of 1024 bytes and refuses 1025 with 413 before routing', async () => {
    const { port } = await start({});
    // The static page takes GET only, so an admitted body reaches the route and gets 405, not 413.
    const atLimit = await send(port, {
      method: 'POST',
      path: '/',
      headers: { 'content-length': '1024' },
      body: 'x'.repeat(1024),
    });
    expect(atLimit.status).toBe(405);
    const over = await send(port, {
      method: 'POST',
      path: '/',
      headers: { 'content-length': '1025' },
      body: 'x'.repeat(1025),
    });
    expect(over.status).toBe(413);
    expect(JSON.parse(over.body)).toEqual({ error: 'request body is too large' });
    expect(over.headers['content-security-policy']).toContain("default-src 'none'");
  });
});
