/**
 * No secret in any reply or log. Glass is built from a config whose password is a sentinel, read
 * from a file whose path is also a sentinel. Every route is hit, including the error paths, and the
 * captured console output and every response body must hold neither sentinel nor the connection
 * target. The database port is closed on purpose, so the query error path runs for real.
 */
import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadGlassConfig } from '../src/config.ts';
import { buildGlass, type GlassParts } from '../src/server.ts';
import { send } from './harness.ts';

const PASSWORD = 'PW-SENTINEL-9d2c71e4';
const PASSWORD_FILE = '/run/secrets/GLASS-PATH-SENTINEL-4b8a.txt';

/** Every route, the page, a 400, a 404, a 405 and a foreign Host. */
const REQUESTS = [
  { method: 'GET', path: '/' },
  { method: 'GET', path: '/app.css' },
  { method: 'GET', path: '/app.js' },
  { method: 'GET', path: '/js/render-model.ts' },
  { method: 'GET', path: '/api/agents' },
  { method: 'GET', path: '/api/thoughts' },
  { method: 'GET', path: '/api/thoughts/t1' },
  { method: 'GET', path: '/api/receipts?action_id=a1' },
  { method: 'GET', path: '/api/stream' },
  { method: 'GET', path: '/api/thoughts?limit=0' },
  { method: 'GET', path: '/no-such-page' },
  { method: 'POST', path: '/api/agents' },
  { method: 'GET', path: '/', host: 'evil.example' },
];

let parts: GlassParts | undefined;

afterEach(() => {
  parts?.close();
  parts = undefined;
  vi.restoreAllMocks();
});

describe('no secret in replies or logs', () => {
  it('keeps the password and its file path out of every route, error and log', async () => {
    const logged: string[] = [];
    for (const name of ['log', 'info', 'warn', 'error'] as const) {
      vi.spyOn(console, name).mockImplementation((...args: unknown[]) => {
        logged.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
      });
    }
    const config = loadGlassConfig(
      {
        GELDAR_GLASS_PG_PASSWORD_FILE: PASSWORD_FILE,
        GELDAR_GLASS_PG_PORT: '1',
        GELDAR_GLASS_SSE_POLL_MS: '20',
      },
      () => `${PASSWORD}\n`,
    );
    expect(config.pg.password).toBe(PASSWORD);

    parts = buildGlass(config);
    await new Promise<void>((resolve) => parts?.server.listen(0, '127.0.0.1', resolve));
    const port = (parts.server.address() as AddressInfo).port;

    const bodies: string[] = [];
    const statuses: number[] = [];
    for (const req of REQUESTS) {
      const reply = await send(port, { host: `127.0.0.1:${port}`, ...req });
      bodies.push(reply.body);
      statuses.push(reply.status);
    }
    // The receipts query hits the closed port: the error path must have run, not been skipped.
    expect(statuses).toContain(500);
    expect(statuses).toContain(404);
    expect(statuses).toContain(405);
    expect(statuses).toContain(421);

    // Hold a stream open across several polls (20 ms each) so the poll error log line really runs.
    await new Promise<void>((resolve, reject) => {
      const out = httpRequest(
        {
          host: '127.0.0.1',
          port,
          method: 'GET',
          path: '/api/stream',
          headers: { Host: `127.0.0.1:${port}` },
        },
        (res) => {
          res.resume();
          setTimeout(() => {
            out.destroy();
            resolve();
          }, 200);
        },
      );
      out.on('error', (err) => {
        if ((err as NodeJS.ErrnoException).code !== 'ECONNRESET') reject(err);
      });
      out.end();
    });
    const pollLines = logged.filter((line) => line.includes('glass_poll_error'));
    expect(pollLines.length, 'the poll error log path ran').toBeGreaterThanOrEqual(1);
    const haystack = [...bodies, ...logged].join('\n');
    expect(haystack).not.toContain(PASSWORD);
    expect(haystack).not.toContain('GLASS-PATH-SENTINEL');
    expect(haystack).not.toContain(PASSWORD_FILE);
    expect(haystack).not.toMatch(/postgres(ql)?:\/\//i);
  });
});
