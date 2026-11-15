import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountAccountDelete } from '../src/account-delete-wiring.ts';
import { accountExportMount } from '../src/account-export-wiring.ts';
import { accountExportRoutes, exportFileName } from '../src/api/account-export.ts';
import { handleApi } from '../src/api/index.ts';
import type { ApiDeps, ApiRoute } from '../src/api/route.ts';
import { PgStore } from '../src/pg-store.ts';
import { sendProblem } from '../src/problem.ts';
import { type SessionStore, sessionHash } from '../src/session-store.ts';
import { baseDeps, bearer, cookie, IDENT, KEY_ALL, sessions } from './owner-api-harness.ts';

const SENTINEL = 'SENTINEL-EXPORT-PAYLOAD-7f3a';
const PAYLOAD = { format: 'geldar-owner-export/1', records: { note: SENTINEL } };
const NOW = Date.parse('2026-11-15T23:30:00Z');
const EXPORT = '/api/v1/account/export';

const servers: Server[] = [];

/** Starts a real server over handleApi, so the headers and the status are the ones a browser sees. */
async function start(deps: ApiDeps) {
  const server = createServer((req, res) => {
    void handleApi(req, res, new URL(req.url ?? '/', 'http://local'), deps).then((handled) => {
      if (!handled) sendProblem(res, 'not_found');
    });
  });
  servers.push(server);
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', () => ok()));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/** The deps of the route with a fake store port and a fixed window charge. */
function withRoutes(routes: readonly ApiRoute[]): ApiDeps {
  return baseDeps({ now: () => NOW, routes });
}

function fakeRoutes(exportOwnerData: (h: string) => Promise<unknown>, charge = () => 0) {
  return accountExportRoutes({ exportOwnerData, charge, now: () => NOW });
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((ok) => s.close(() => ok()))));
});

describe('GET /account/export (C7-09b)', () => {
  it('a cookie session gets the JSON passthrough as an attachment with no-store and nosniff', async () => {
    const fake = vi.fn(async () => PAYLOAD);
    const base = await start(withRoutes(fakeRoutes(fake)));
    const r = await fetch(`${base}${EXPORT}`, { headers: cookie });
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(r.headers.get('content-disposition')).toBe(
      'attachment; filename="geldar-export-2026-11-15.json"',
    );
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await r.text()).toBe(JSON.stringify(PAYLOAD));
    expect(fake).toHaveBeenCalledTimes(1);
    expect(fake).toHaveBeenCalledWith(IDENT);
  });

  it('no cookie is the unauthenticated 401 and nothing is read', async () => {
    const fake = vi.fn(async () => PAYLOAD);
    const base = await start(withRoutes(fakeRoutes(fake)));
    const r = await fetch(`${base}${EXPORT}`);
    expect(r.status).toBe(401);
    expect(fake).not.toHaveBeenCalled();
  });

  it('a Bearer owner key is refused 401 and nothing is read', async () => {
    const fake = vi.fn(async () => PAYLOAD);
    const base = await start(withRoutes(fakeRoutes(fake)));
    const r = await fetch(`${base}${EXPORT}`, { headers: bearer(KEY_ALL) });
    expect(r.status).toBe(401);
    expect(fake).not.toHaveBeenCalled();
  });

  it('a null document (no owner row) is the 404 problem and no document', async () => {
    const base = await start(withRoutes(fakeRoutes(async () => null)));
    const r = await fetch(`${base}${EXPORT}`, { headers: cookie });
    expect(r.status).toBe(404);
    expect(r.headers.get('content-disposition')).toBeNull();
  });

  it('the identity hash comes only from the session: a query string cannot pick another owner', async () => {
    const fake = vi.fn(async () => PAYLOAD);
    const base = await start(withRoutes(fakeRoutes(fake)));
    const other = 'ef'.repeat(32);
    const r = await fetch(`${base}${EXPORT}?identity=${other}&owner=alice`, { headers: cookie });
    expect(r.status).toBe(200);
    expect(fake.mock.calls).toEqual([[IDENT]]);
  });

  it('a cross-site or same-site request is answered 404 and nothing is read; same-origin is served', async () => {
    const fake = vi.fn(async () => PAYLOAD);
    const base = await start(withRoutes(fakeRoutes(fake)));
    const cross = await fetch(`${base}${EXPORT}`, {
      headers: { ...cookie, 'sec-fetch-site': 'cross-site' },
    });
    const same = await fetch(`${base}${EXPORT}`, {
      headers: { ...cookie, 'sec-fetch-site': 'same-site' },
    });
    expect(cross.status).toBe(404);
    expect(same.status).toBe(404);
    expect(fake).not.toHaveBeenCalled();
    const own = await fetch(`${base}${EXPORT}`, {
      headers: { ...cookie, 'sec-fetch-site': 'same-origin' },
    });
    expect(own.status).toBe(200);
  });

  it('a charged owner window is the 429 problem with retry-after, and nothing is read', async () => {
    const fake = vi.fn(async () => PAYLOAD);
    const base = await start(withRoutes(fakeRoutes(fake, () => 60)));
    const r = await fetch(`${base}${EXPORT}`, { headers: cookie });
    expect(r.status).toBe(429);
    expect(r.headers.get('retry-after')).toBe('60');
    expect(fake).not.toHaveBeenCalled();
  });

  it('the second export inside a minute is 429; after a minute the third is served', async () => {
    let clock = NOW;
    const fake = vi.fn(async () => PAYLOAD);
    const routes = accountExportMount({ exportOwnerData: fake }, () => clock);
    const base = await start(withRoutes(routes));
    const first = await fetch(`${base}${EXPORT}`, { headers: cookie });
    expect(first.status).toBe(200);
    clock += 1_000;
    const second = await fetch(`${base}${EXPORT}`, { headers: cookie });
    expect(second.status).toBe(429);
    expect(Number(second.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(fake).toHaveBeenCalledTimes(1);
    clock += 60_000;
    const third = await fetch(`${base}${EXPORT}`, { headers: cookie });
    expect(third.status).toBe(200);
    expect(fake).toHaveBeenCalledTimes(2);
  });

  it('the owner window is keyed by owner id: a second owner is not limited by the first', async () => {
    const BOB_IDENT = 'ab'.repeat(32);
    const BOB_SID = 'sid-bob';
    const bobSessions: SessionStore = {
      ...sessions,
      touch: async (h) =>
        h.equals(sessionHash(BOB_SID))
          ? {
              sessionHash: h,
              ownerId: 'bob',
              identityHash: BOB_IDENT,
              signedInMs: 0,
              lastSeenMs: 0,
              expiresMs: 1e15,
            }
          : sessions.touch(h),
    };
    const fake = vi.fn(async () => PAYLOAD);
    const routes = accountExportMount({ exportOwnerData: fake }, () => NOW);
    const base = await start(baseDeps({ now: () => NOW, routes, sessions: bobSessions }));
    const alice = await fetch(`${base}${EXPORT}`, { headers: cookie });
    expect(alice.status).toBe(200);
    const aliceAgain = await fetch(`${base}${EXPORT}`, { headers: cookie });
    expect(aliceAgain.status).toBe(429);
    const bob = await fetch(`${base}${EXPORT}`, {
      headers: { cookie: `__Host-gr_session=${BOB_SID}` },
    });
    expect(bob.status).toBe(200);
    expect(fake.mock.calls).toEqual([[IDENT], [BOB_IDENT]]);
  });

  it('a failing export is 500 internal and its error text is not in the answer', async () => {
    const base = await start(
      withRoutes(
        fakeRoutes(async () => {
          throw new Error(`database said ${SENTINEL}`);
        }),
      ),
    );
    const r = await fetch(`${base}${EXPORT}`, { headers: cookie });
    expect(r.status).toBe(500);
    expect(await r.text()).not.toContain(SENTINEL);
  });

  it('the payload is never logged', async () => {
    const logs: unknown[][] = [];
    for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        logs.push(args);
      });
    }
    const base = await start(withRoutes(fakeRoutes(async () => PAYLOAD)));
    const r = await fetch(`${base}${EXPORT}`, { headers: cookie });
    expect(r.status).toBe(200);
    expect(JSON.stringify(logs)).not.toContain(SENTINEL);
  });

  it('the file name is the UTC date only', () => {
    expect(exportFileName(NOW)).toBe('geldar-export-2026-11-15.json');
    expect(exportFileName(Date.parse('2026-01-02T00:00:00Z'))).toBe(
      'geldar-export-2026-01-02.json',
    );
  });
});

describe('the Pg adapter and the mount (C7-09b)', () => {
  it('exportOwnerData calls register_owner_export with the hash as a Buffer and returns the document', async () => {
    const store = new PgStore('postgres://127.0.0.1:1/unused', { shard: 'test' });
    const query = vi.fn(async (_sql: string, _params: unknown[]) => ({
      rows: [{ export: PAYLOAD }],
    }));
    (store as unknown as { pool: { query: typeof query } }).pool = { query };
    expect(await store.exportOwnerData(IDENT)).toEqual(PAYLOAD);
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0] ?? [];
    expect(sql).toBe('SELECT register_owner_export($1) AS export');
    const param = params?.[0];
    expect(param).toBeInstanceOf(Buffer);
    expect(Buffer.isBuffer(param) && param.equals(Buffer.from(IDENT, 'hex'))).toBe(true);
  });

  it('a NULL row is null from the adapter', async () => {
    const store = new PgStore('postgres://127.0.0.1:1/unused', { shard: 'test' });
    (store as unknown as { pool: unknown }).pool = {
      query: async () => ({ rows: [{ export: null }] }),
    };
    expect(await store.exportOwnerData(IDENT)).toBeNull();
  });

  it('the route is mounted only with the store port, and unmounted without it', () => {
    const store = {
      findOwner: async () => null,
      listPlayers: async () => [],
      eraseAccount: async () => false,
    };
    const body = { link: null, routes: [] as readonly ApiRoute[] };
    const without = mountAccountDelete(store, body, {}, () => undefined);
    expect(without.api.routes.some((r) => r.pattern.test('/account/export'))).toBe(false);
    const withPort = mountAccountDelete(
      { ...store, exportOwnerData: async () => PAYLOAD },
      body,
      {},
      () => undefined,
    );
    const mounted = withPort.api.routes.filter((r) => r.pattern.test('/account/export'));
    expect(mounted).toHaveLength(1);
    expect(mounted[0]?.method).toBe('GET');
    expect(mounted[0]?.cookieOnly).toBe(true);
    expect(mounted[0]?.write).toBe(false);
  });
});
