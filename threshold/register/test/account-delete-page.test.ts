import { randomBytes } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { SESSION_COOKIE, TERMS_VERSION } from '../src/account.ts';
import { deleteAccountPage } from '../src/account-delete-page.ts';
import {
  type AccountDeleteDeps,
  accountDeleteRoutes,
  DELETE_PHRASE,
} from '../src/api/account-data-delete.ts';
import type { BodyStopLink } from '../src/api/body-retire.ts';
import { createBodySlot } from '../src/api/body-slot.ts';
import type { Identity } from '../src/identity.ts';
import { createRegisterServer } from '../src/server.ts';
import { sessionHash } from '../src/session-store.ts';
import { FakeSessionStore } from './fake-session-store.ts';
import { FakeStore } from './fake-store.ts';
import { config } from './fixture.ts';

const T0 = Date.parse('2026-11-11T00:00:00Z');
const OWNER = 'reg-account-delete-test';
const identity: Identity = {
  provider: 'microsoft',
  identityHash: 'cd'.repeat(32),
  display: 'someone',
};

afterEach(() => {
  for (const s of servers.splice(0)) s.close();
});

describe('account delete page notice (delete-guard)', () => {
  it('the page tells the owner that a moved-in player blocks the delete', () => {
    expect(deleteAccountPage('csrf-value')).toContain(
      'If the operator moved a player to your account',
    );
  });
});
const servers: Server[] = [];

/**
 * The register server with one signed-in cookie session and a recording erase. The body link is null unless given: with
 * no body link the stop step is a no-op (NATS not configured).
 */
async function boot(body: BodyStopLink | null = null) {
  const store = new FakeStore(() => T0);
  await store.createOwner(identity, OWNER, TERMS_VERSION);
  const sessions = new FakeSessionStore();
  const id = randomBytes(32).toString('base64url');
  await sessions.create({
    sessionHash: sessionHash(id),
    ownerId: OWNER,
    identityHash: identity.identityHash,
    signedInMs: T0,
    lastSeenMs: T0,
    expiresMs: T0 + 3_600_000,
  });
  const erased: string[] = [];
  const deps: AccountDeleteDeps = {
    findOwner: (h) => store.findOwner(h),
    listPlayers: (h) => store.listPlayers(h),
    eraseAccount: async (h) => {
      erased.push(h);
      return true;
    },
    clearCookies: ['__Host-gr_session=; Max-Age=0; Path=/', 'gr_session=; Max-Age=0; Path=/'],
    body,
    movedInPlayers: async () => [],
  };
  // The production shape: the delete route is one of the API routes, next to the body routes (main.ts).
  const server = createRegisterServer({
    config: config(),
    store,
    sessions,
    providers: {},
    fetch,
    now: () => T0,
    log: () => undefined,
    accountDelete: deps,
    api: { routes: accountDeleteRoutes(deps) },
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}/register`;
  const cookie = `${SESSION_COOKIE}=${id}`;
  return { base, cookie, erased };
}

/** The page's hidden CSRF field: the token the page actions and the API header must carry. */
const csrfOf = (html: string): string => /name="csrf" value="([^"]+)"/.exec(html)?.[1] ?? '';

describe('account delete page (C7-09a)', () => {
  it('GET shows the typed-phrase form with the CSRF field and posts to the account delete path', async () => {
    const { base, cookie } = await boot();
    const r = await fetch(`${base}/account/delete`, { headers: { cookie } });
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toContain('action="/register/account/delete"');
    expect(html).toContain('name="phrase"');
    expect(csrfOf(html)).not.toBe('');
  });

  it('POST with the phrase and the page CSRF token runs the delete and clears the cookies', async () => {
    const { base, cookie, erased } = await boot();
    const csrf = csrfOf(
      await (await fetch(`${base}/account/delete`, { headers: { cookie } })).text(),
    );
    const r = await fetch(`${base}/account/delete`, {
      method: 'POST',
      redirect: 'manual',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ csrf, phrase: DELETE_PHRASE }).toString(),
    });
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toBe('/register');
    expect(r.headers.get('set-cookie')).toContain('__Host-gr_session=; Max-Age=0');
    expect(erased).toEqual([identity.identityHash]);
  });

  it('POST with a wrong phrase answers 422 and erases nothing', async () => {
    const { base, cookie, erased } = await boot();
    const csrf = csrfOf(
      await (await fetch(`${base}/account/delete`, { headers: { cookie } })).text(),
    );
    const r = await fetch(`${base}/account/delete`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ csrf, phrase: 'yes' }).toString(),
    });
    expect(r.status).toBe(422);
    expect(await r.text()).toContain('The confirmation phrase does not match.');
    expect(erased).toEqual([]);
  });

  it('POST without the CSRF token is refused 403 and erases nothing', async () => {
    const { base, cookie, erased } = await boot();
    const r = await fetch(`${base}/account/delete`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ csrf: 'wrong', phrase: DELETE_PHRASE }).toString(),
    });
    expect(r.status).toBe(403);
    expect(erased).toEqual([]);
  });

  it('POST while an agent body operation holds the owner slot answers 409 and erases nothing', async () => {
    const slot = createBodySlot();
    slot.add(OWNER);
    const { base, cookie, erased } = await boot({
      conn: null as never,
      shard: 'shard-test',
      timeoutMs: 1000,
      slot,
    });
    const csrf = csrfOf(
      await (await fetch(`${base}/account/delete`, { headers: { cookie } })).text(),
    );
    const r = await fetch(`${base}/account/delete`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ csrf, phrase: DELETE_PHRASE }).toString(),
    });
    expect(r.status).toBe(409);
    expect(erased).toEqual([]);
  });
});

describe('account delete link and route anchor (C7-09a review fix)', () => {
  it('the account page links to the delete page', async () => {
    const { base, cookie } = await boot();
    const html = await (await fetch(`${base}/account`, { headers: { cookie } })).text();
    expect(html).toContain('href="/register/account/delete"');
  });

  it('/account/delete/ag-x/retire is not the delete: a GET is 404 and a POST erases nothing', async () => {
    const { base, cookie, erased } = await boot();
    const csrf = csrfOf(
      await (await fetch(`${base}/account/delete`, { headers: { cookie } })).text(),
    );
    const get = await fetch(`${base}/account/delete/ag-x/retire`, { headers: { cookie } });
    expect(get.status).toBe(404);
    const post = await fetch(`${base}/account/delete/ag-x/retire`, {
      method: 'POST',
      redirect: 'manual',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ csrf, phrase: DELETE_PHRASE }).toString(),
    });
    // The router refuses the POST (405 for this path, not the delete): no redirect, no 204 and no erase.
    expect(post.status).toBe(405);
    expect(erased).toEqual([]);
  });
});

describe('POST /api/v1/account/delete through the production shape (C7-09a)', () => {
  it('answers 204 for a signed-in cookie session with the CSRF header, and erases the account', async () => {
    const { base, cookie, erased } = await boot();
    const csrf = csrfOf(
      await (await fetch(`${base}/account/delete`, { headers: { cookie } })).text(),
    );
    const r = await fetch(`${base}/api/v1/account/delete`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json', 'x-csrf-token': csrf },
      body: JSON.stringify({ confirm: DELETE_PHRASE }),
    });
    expect(r.status).toBe(204);
    expect(erased).toEqual([identity.identityHash]);
  });

  it('refuses a cookie write with no CSRF header (401 from the route) and erases nothing', async () => {
    const { base, cookie, erased } = await boot();
    const r = await fetch(`${base}/api/v1/account/delete`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ confirm: DELETE_PHRASE }),
    });
    expect(r.status).not.toBe(204);
    expect(r.status).not.toBe(404);
    expect(erased).toEqual([]);
  });

  it('a wrong confirm phrase is refused before the owner is read (422, nothing erased)', async () => {
    const { base, cookie, erased } = await boot();
    const csrf = csrfOf(
      await (await fetch(`${base}/account/delete`, { headers: { cookie } })).text(),
    );
    const r = await fetch(`${base}/api/v1/account/delete`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json', 'x-csrf-token': csrf },
      body: JSON.stringify({ confirm: 'delete' }),
    });
    expect(r.status).toBe(422);
    expect(erased).toEqual([]);
  });
});
