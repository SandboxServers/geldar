/**
 * The rate limit and the page. Loading the page is many small files, and the service worker then asks for
 * each of them again to keep its copy. Under the general bucket (20 at once by default) that load was
 * refused in part: the worker never installed and the page lost a stylesheet or a typeface. The page's
 * files now have their own bucket. These tests run one cold load against the handler with the limits Glass
 * ships with, and hold both buckets to their caps.
 */
import { readFileSync } from 'node:fs';
import { createServer, request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { loadGlassConfig } from '../src/config.ts';
import { createHandler } from '../src/http.ts';
import { buildLimiters, limiterFor, OPEN_POLICY, STATIC_RATE } from '../src/policy.ts';
import type { SqlClient } from '../src/query.ts';
import type { SseHub } from '../src/sse.ts';
import { STATIC_FILES } from '../src/static-files.ts';

/** The general bucket as Glass configures it when the operator sets nothing. */
const DEFAULTS = loadGlassConfig({ GELDAR_GLASS_PG_PASSWORD_FILE: 'x' }, () => 'pw').rateLimit;

const servers: Server[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

/** Glass's handler under the shipped limits, with a clock that never moves: no bucket refills. */
async function start(): Promise<number> {
  const db = { query: async () => ({ rows: [] }) } as unknown as SqlClient;
  const handler = createHandler({
    db,
    hub: {} as SseHub,
    policy: buildLimiters(DEFAULTS, () => 0),
  });
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as AddressInfo).port;
}

function status(port: number, path: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, method: 'GET', path }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode ?? 0));
    });
    req.on('error', reject);
    req.end();
  });
}

/** The paths the service worker copies when it installs, read from the worker itself. */
const SHELL = [
  ...readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8')
    .slice(0, 3000)
    .matchAll(/^ {2}'(\/[^']*)',$/gm),
].map((m) => m[1] as string);

describe('the rate limit and the page', () => {
  it('ships with a general bucket of 20 at once, which one page load would overrun', () => {
    expect(DEFAULTS).toEqual({ perMinute: 60, burst: 20, maxClients: 1024 });
    expect(STATIC_FILES.size).toBeGreaterThan(DEFAULTS.burst);
    expect(SHELL.length).toBe(STATIC_FILES.size - 1);
  });

  it('serves one cold load whole: every page file, the worker copying each again, then the API', async () => {
    const port = await start();
    const refused: string[] = [];
    // The page asks for its files; the worker, installing, asks for the shell again; a second visit repeats it.
    for (const path of [...STATIC_FILES.keys(), ...SHELL, ...STATIC_FILES.keys(), ...SHELL]) {
      if ((await status(port, path)) !== 200) refused.push(path);
    }
    expect(refused).toEqual([]);
    // The API the page then calls is charged to the general bucket, which the page's files did not touch.
    for (const path of ['/api/agents', '/api/thoughts?limit=50', '/api/thoughts/th-1']) {
      expect(await status(port, path), path).not.toBe(429);
    }
  });

  it('still caps the page files for one client: 200 at once, and the 201st is refused', async () => {
    const port = await start();
    expect(STATIC_RATE).toEqual({ perMinute: 600, burst: 200 });
    for (let i = 1; i <= 199; i += 1) await status(port, '/app.css');
    expect(await status(port, '/app.css')).toBe(200);
    expect(await status(port, '/app.css')).toBe(429);
    expect(await status(port, '/fonts/dm-mono-latin-400-normal.woff2')).toBe(429);
    // A spent static bucket does not spend the API's.
    expect(await status(port, '/api/agents')).toBe(200);
  });

  it('still caps the API at the general burst, whatever the page files did', async () => {
    const port = await start();
    for (let i = 1; i <= 19; i += 1) await status(port, '/api/agents');
    expect(await status(port, '/api/agents')).toBe(200);
    expect(await status(port, '/api/agents')).toBe(429);
    // The page still loads for a client whose API bucket is spent.
    expect(await status(port, '/')).toBe(200);
    // An unknown path is charged to the general bucket, not the generous one.
    expect(await status(port, '/fonts/nope.woff2')).toBe(429);
  });

  it('charges only the files of the table to the page bucket', () => {
    const limits = buildLimiters(DEFAULTS, () => 0);
    const policy = { ...OPEN_POLICY, ...limits };
    for (const path of STATIC_FILES.keys()) {
      expect(limiterFor(policy, path), path).toBe(limits.pageStaticLimiter);
    }
    for (const path of ['/api/agents', '/api/stream', '/nowhere', '/fonts/x.woff2', '/js/x.ts']) {
      expect(limiterFor(policy, path), path).toBe(limits.limiter);
    }
    expect(limiterFor(policy, '/kino/main.ts')).toBe(limits.kinoStaticLimiter);
    expect(limiterFor(policy, '/kino/targets')).toBe(limits.kinoTargetsLimiter);
    // Without a page bucket the general one applies, as before.
    expect(limiterFor({ ...policy, pageStaticLimiter: null }, '/app.css')).toBe(limits.limiter);
  });
});
