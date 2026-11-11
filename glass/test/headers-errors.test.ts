/**
 * The security headers on every kind of reply, error replies included. A 200 page, a 400, a 404,
 * a 405, a 421, a 429 and a 500 each carry the same Content-Security-Policy and nosniff, and the
 * policy keeps its defaults: nothing loads from elsewhere and no inline script or style is allowed.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { RateLimiter } from '../src/guard.ts';
import { createHandler, SECURITY_HEADERS } from '../src/http.ts';
import type { SseHub } from '../src/sse.ts';
import { type Reply, recordingPool, send } from './harness.ts';

const servers: Server[] = [];

afterEach(() => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    server.close();
  }
});

interface Options {
  limiter?: RateLimiter | null;
  /** A database whose every statement fails, for the 500 path. */
  failing?: boolean;
}

/** Starts the handler on an ephemeral loopback port; returns the port. */
async function start(options: Options = {}): Promise<number> {
  const recorder = recordingPool([]);
  const db = options.failing
    ? { query: async () => Promise.reject(new Error('connection refused at db.internal')) }
    : recorder.pool;
  const hub = { attach: () => true, stats: () => ({}) } as unknown as SseHub;
  const policy = { limiter: options.limiter ?? null };
  const server = createServer(createHandler({ db: db as never, hub, policy }));
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as AddressInfo).port;
}

/** Asserts the full header set on one reply: the policy text, the nosniff flag and the referrer rule. */
function expectSecurityHeaders(reply: Reply, label: string): void {
  const csp = String(reply.headers['content-security-policy'] ?? '');
  expect(csp, label).toBe(SECURITY_HEADERS['Content-Security-Policy']);
  expect(csp, label).toContain("default-src 'none'");
  expect(csp, label).toContain("script-src 'self'");
  expect(csp, label).not.toContain('unsafe-inline');
  expect(reply.headers['x-content-type-options'], label).toBe('nosniff');
  expect(reply.headers['referrer-policy'], label).toBe('no-referrer');
}

describe('security headers on every reply', () => {
  it('a 200 page carries the policy', async () => {
    const port = await start();
    const reply = await send(port, { method: 'GET', path: '/' });
    expect(reply.status).toBe(200);
    expectSecurityHeaders(reply, '200 /');
  });

  it('a 400 from a bad query carries the policy', async () => {
    const port = await start();
    const reply = await send(port, { method: 'GET', path: '/api/thoughts?limit=0' });
    expect(reply.status).toBe(400);
    expectSecurityHeaders(reply, '400 limit');
  });

  it('a 404 carries the policy', async () => {
    const port = await start();
    const reply = await send(port, { method: 'GET', path: '/no-such-page' });
    expect(reply.status).toBe(404);
    expectSecurityHeaders(reply, '404');
  });

  it('a 405 on a known path carries the policy', async () => {
    const port = await start();
    const reply = await send(port, { method: 'POST', path: '/api/thoughts' });
    expect(reply.status).toBe(405);
    expectSecurityHeaders(reply, '405 api');
    const page = await send(port, { method: 'PUT', path: '/' });
    expect(page.status).toBe(405);
    expectSecurityHeaders(page, '405 page');
  });

  it('a 421 for a foreign Host carries the policy', async () => {
    const port = await start();
    const reply = await send(port, { method: 'GET', path: '/', host: 'evil.example' });
    expect(reply.status).toBe(421);
    expectSecurityHeaders(reply, '421');
  });

  it('a 429 from the rate limit carries the policy and Retry-After', async () => {
    const limiter = new RateLimiter({
      perMinute: 60,
      burst: 1,
      maxClients: 8,
      now: () => 1_000_000,
    });
    const port = await start({ limiter });
    expect((await send(port, { method: 'GET', path: '/' })).status).toBe(200);
    const refused = await send(port, { method: 'GET', path: '/' });
    expect(refused.status).toBe(429);
    expect(refused.headers['retry-after']).toBe('1');
    expectSecurityHeaders(refused, '429');
  });

  it('a 500 from a failing database carries the policy and no error text', async () => {
    const port = await start({ failing: true });
    const reply = await send(port, { method: 'GET', path: '/api/receipts?action_id=a1' });
    expect(reply.status).toBe(500);
    expect(reply.body).toBe(JSON.stringify({ error: 'internal error' }));
    expect(reply.body).not.toMatch(/db\.internal|refused/);
    expectSecurityHeaders(reply, '500');
  });
});
