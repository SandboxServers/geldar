/**
 * The read-only contract, end to end over a real loopback socket: every path and method, the Host
 * check, the bind check, and the security headers on every kind of reply.
 */
import { type ClientRequest, request as httpRequest } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { assertLoopback, type GlassConfig } from '../src/config.ts';
import { SECURITY_HEADERS } from '../src/http.ts';
import { ROUTES } from '../src/routes.ts';
import { buildGlass } from '../src/server.ts';
import { type Running, send, startGlass } from './harness.ts';

/** A stream request whose socket stays open until the test destroys it. */
function openStream(port: number): ClientRequest {
  const req = httpRequest({
    host: '127.0.0.1',
    port,
    path: '/api/stream',
    headers: { Host: `127.0.0.1:${port}` },
  });
  req.on('error', () => undefined);
  req.end();
  return req;
}

const WRITE_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'TRACE'];
const PAGE_PATHS = ['/', '/app.css', '/app.js', '/js/render-model.ts', '/js/render-view.ts'];
const UNKNOWN_PATHS = ['/nope', '/api', '/api/thoughts/', '/api/agents/x/y'];

/** Every route path with each `:param` filled in, plus the page paths. */
function knownPaths(): string[] {
  return [...ROUTES.map((r) => r.path.replace(/:[a-z]+/g, 'x1')), ...PAGE_PATHS];
}

const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost', '[::1]'];

let running: Running | undefined;

afterEach(async () => {
  await running?.close();
  running = undefined;
});

describe('the Glass read-only route contract', () => {
  it('answers 405 to every write-like method on every known path, with no statement sent to the database', async () => {
    running = await startGlass();
    const { port } = running;
    for (const path of knownPaths()) {
      for (const method of WRITE_METHODS) {
        const reply = await send(port, { method, path, host: `127.0.0.1:${port}` });
        expect(reply.status, `${method} ${path}`).toBe(405);
        expect(reply.headers.allow, `${method} ${path}`).toBe('GET');
      }
    }
    expect(running.recorder.statements).toEqual([]);
  });

  it('answers 404 to every write-like method on an unknown path', async () => {
    running = await startGlass();
    for (const path of UNKNOWN_PATHS) {
      for (const method of WRITE_METHODS) {
        const reply = await send(running.port, { method, path, host: `localhost:${running.port}` });
        expect(reply.status, `${method} ${path}`).toBe(404);
      }
    }
    expect(running.recorder.statements).toEqual([]);
  });

  it('sends only SELECT statements for every GET, and none for the page', async () => {
    running = await startGlass([{ thought_id: 't1', agent_id: 'a1', at: '2026-11-10T00:00:00Z' }]);
    const { port } = running;
    for (const path of [
      '/api/agents',
      '/api/thoughts',
      '/api/thoughts/t1',
      '/api/receipts?action_id=a1',
    ]) {
      const reply = await send(port, { method: 'GET', path, host: `127.0.0.1:${port}` });
      expect(reply.status, path).toBe(200);
    }
    const sent = running.recorder.statements;
    expect(sent.length).toBeGreaterThan(0);
    for (const text of sent) expect(text.trimStart().toUpperCase()).toMatch(/^SELECT\b/);
    expect(sent.join('\n')).not.toMatch(
      /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT)\b/i,
    );
  });

  it('refuses a Host header that is not loopback, on every kind of path (DNS rebinding)', async () => {
    running = await startGlass();
    const { port } = running;
    const hosts = [
      'evil.example',
      `evil.example:${port}`,
      '127.0.0.2',
      '10.0.0.5',
      '192.168.1.9:8787',
      'localhost.evil.example',
    ];
    for (const host of hosts) {
      for (const path of ['/', '/api/agents', '/api/stream', '/app.js']) {
        const reply = await send(port, { method: 'GET', path, host });
        expect(reply.status, `Host ${host} on ${path}`).toBe(421);
      }
    }
    expect(running.recorder.statements).toEqual([]);
  });

  it('serves the same paths to each loopback Host spelling', async () => {
    running = await startGlass();
    for (const host of LOOPBACK_HOSTS) {
      const reply = await send(running.port, {
        method: 'GET',
        path: '/api/agents',
        host: `${host}:${running.port}`,
      });
      expect(reply.status, host).toBe(200);
    }
  });

  it('sends the CSP and the security headers on every reply: API, page, 404, 405, 421 and the stream', async () => {
    running = await startGlass();
    const { port } = running;
    const cases: { method: string; path: string; host?: string }[] = [
      { method: 'GET', path: '/api/agents', host: `127.0.0.1:${port}` },
      { method: 'GET', path: '/api/thoughts/x1', host: `127.0.0.1:${port}` },
      { method: 'GET', path: '/', host: `127.0.0.1:${port}` },
      { method: 'GET', path: '/app.js', host: `127.0.0.1:${port}` },
      { method: 'GET', path: '/nope', host: `127.0.0.1:${port}` },
      { method: 'POST', path: '/api/agents', host: `127.0.0.1:${port}` },
      { method: 'GET', path: '/api/agents', host: 'evil.example' },
      { method: 'GET', path: '/api/stream', host: `127.0.0.1:${port}` },
    ];
    for (const req of cases) {
      const reply = await send(port, req);
      for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
        expect(reply.headers[name.toLowerCase()], `${name} on ${req.method} ${req.path}`).toBe(
          value,
        );
      }
      expect(reply.headers['access-control-allow-origin'], req.path).toBeUndefined();
    }
  });

  it('sends the CSP on a 503 from the stream cap', async () => {
    running = await startGlass();
    const { port, hub } = running;
    const open: ClientRequest[] = [];
    for (let i = 0; i < 8; i += 1) {
      open.push(openStream(port));
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
    const refused = await send(port, {
      method: 'GET',
      path: '/api/stream',
      host: `127.0.0.1:${port}`,
    });
    expect(refused.status).toBe(503);
    expect(refused.headers['content-security-policy']).toBe(
      SECURITY_HEADERS['Content-Security-Policy'],
    );
    expect(hub.stats().clients).toBe(8);
    for (const req of open) req.destroy();
  });
});

describe('the Glass bind check', () => {
  const config = (host: string): GlassConfig => ({
    host,
    port: 8787,
    pg: { host: '127.0.0.1', port: 5432, user: 'geldar_glass', database: 'geldar', password: 'x' },
    sseMaxClients: 8,
    sseBufferFrames: 100,
    ssePollMs: 1000,
    enabled: true,
    delaySeconds: 0,
    showLivingSovereign: false,
    trustedProxies: [],
    rateLimit: { perMinute: 60, burst: 20, maxClients: 1024 },
  });

  it('refuses every bind address but 127.0.0.1, IPv6 loopback and wildcards included', () => {
    for (const host of [
      '::1',
      '0.0.0.0',
      '::',
      '',
      'localhost',
      '127.0.0.2',
      '10.0.0.5',
      '192.168.1.9',
      '::ffff:127.0.0.1',
    ]) {
      expect(() => assertLoopback(host), `host ${JSON.stringify(host)}`).toThrow(
        /127\.0\.0\.1 only/,
      );
    }
  });

  it('buildGlass refuses a non-loopback bind before any socket is created', () => {
    expect(() => buildGlass(config('0.0.0.0'))).toThrow(/refusing to start/);
    expect(() => buildGlass(config('::1'))).toThrow(/refusing to start/);
  });
});
