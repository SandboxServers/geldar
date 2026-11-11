import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, expect, it } from 'vitest';
import { signKinoSession } from '../test/kino-fixture.ts';
import { createHandler } from './http.ts';
import type { SqlClient } from './query.ts';
import type { SseHub } from './sse.ts';

const KEY = 'k'.repeat(40);
const HASH = 'ef'.repeat(32);
let server: Server | undefined;
afterEach(async () => {
  server?.closeAllConnections();
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  server = undefined;
});

async function get(cookie: string | undefined, key: string | undefined = KEY) {
  const db: SqlClient = {
    query: async (text, values) =>
      text.includes('public_camera')
        ? { rows: [{ agent_id: 'ag-cam-01' }] }
        : { rows: values[0] === HASH ? [{ ok: 1 }] : [] },
  };
  server = createServer(
    createHandler({ db, hub: {} as SseHub, ...(key ? { sessionKey: key } : {}), now: () => 100 }),
  );
  await new Promise<void>((r) => server?.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  const res = await fetch(`http://127.0.0.1:${port}/api/session`, {
    headers: cookie ? { cookie } : {},
  });
  return { res, body: await res.json() };
}

it('GET /api/session reports the signed-in admin and the public cameras, read-only', async () => {
  const good = signKinoSession(KEY, { identityHash: HASH, expiresAt: 1000 });
  const { res, body } = await get(`gk_session=${good}`);
  expect(res.status).toBe(200);
  expect(res.headers.get('cache-control')).toBe('no-store');
  expect(res.headers.get('set-cookie')).toBeNull();
  expect(body).toEqual({ signedIn: true, admin: true, publicCameras: ['ag-cam-01'] });
});

it('GET /api/session is signed out without a cookie, with a forged or expired one, or with no key', async () => {
  const other = signKinoSession(KEY, { identityHash: 'aa'.repeat(32), expiresAt: 1000 });
  expect((await get(`gk_session=${other}`)).body).toMatchObject({ signedIn: true, admin: false });
  for (const cookie of [
    undefined,
    'gk_session=junk',
    `gk_session=${signKinoSession(KEY, { identityHash: HASH, expiresAt: 100 })}`,
    `gk_session=${signKinoSession('z'.repeat(40), { identityHash: HASH, expiresAt: 1000 })}`,
  ]) {
    expect((await get(cookie)).body).toMatchObject({ signedIn: false, admin: false });
  }
  const good = signKinoSession(KEY, { identityHash: HASH, expiresAt: 1000 });
  expect((await get(`gk_session=${good}`, '')).body).toMatchObject({ signedIn: false });
});
