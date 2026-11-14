import { afterEach, describe, expect, it } from 'vitest';
import { errorPage } from '../src/errors.ts';
import { FakeStore } from './fake-store.ts';
import { type Harness, harness, NOW } from './fixture.ts';

let h: Harness;
afterEach(async () => {
  await h.close();
});

type Over = Parameters<typeof harness>[0];

async function start(over: Over = {}): Promise<FakeStore> {
  const clock = { at: NOW };
  const store = new FakeStore(() => clock.at);
  h = await harness(over, store);
  (store as { now: () => number }).now = () => h.clock.at;
  return store;
}

interface Session {
  cookie: string;
  csrf: string;
}

/** Signs in with the fake identity provider and reads the form token from the account page. */
async function signIn(userId: string): Promise<Session> {
  h.idp.userId = userId;
  const { state, cookie } = await h.begin(undefined, true);
  const res = await fetch(`${h.base}/register/callback?code=c&state=${state}`, {
    headers: { cookie },
    redirect: 'manual',
  });
  const set = res.headers.getSetCookie().find((c) => c.startsWith('__Host-gr_session='));
  const sc = (set ?? '').split(';')[0] ?? '';
  const page = await (
    await fetch(`${h.base}/register/account`, { headers: { cookie: sc } })
  ).text();
  return { cookie: sc, csrf: /name="csrf" value="([^"]+)"/.exec(page)?.[1] ?? '' };
}

function post(path: string, s: Session, fields: Record<string, string>): Promise<Response> {
  return fetch(`${h.base}${path}`, {
    method: 'POST',
    redirect: 'manual',
    headers: { cookie: s.cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ csrf: s.csrf, ...fields }).toString(),
  });
}

describe('HTML error pages on the page routes (C7-06b)', () => {
  it('answers a kill-switched page request with the HTML 503 page', async () => {
    await start({ killSwitch: true });
    const res = await fetch(`${h.base}/register/`);
    expect(res.status).toBe(503);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toBe(errorPage(503));
  });

  it('keeps the kill-switch answer under /api/ as problem JSON', async () => {
    await start({ killSwitch: true });
    const res = await fetch(`${h.base}/register/api/v1/agents`);
    expect(res.status).toBe(503);
    expect(res.headers.get('content-type')).toBe('application/problem+json');
  });

  it('answers an unknown page with the HTML 404 page', async () => {
    await start();
    const res = await fetch(`${h.base}/register/no-such-page`);
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toBe(errorPage(404));
  });

  it('keeps an unknown API path as problem JSON', async () => {
    await start();
    const res = await fetch(`${h.base}/register/api/v1/no-such`);
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toBe('application/problem+json');
  });

  it('answers a rate-limited page with the HTML 429 page and the wait', async () => {
    await start({ perMinute: 1 });
    await fetch(`${h.base}/register/`);
    const res = await fetch(`${h.base}/register/`);
    expect(res.status).toBe(429);
    const wait = Number(res.headers.get('retry-after'));
    expect(wait).toBeGreaterThan(0);
    expect(await res.text()).toBe(errorPage(429, wait));
  });

  it('answers a sign-in refused by the sign-in window with the HTML 429 page', async () => {
    await start({ signInPerMinute: 1 });
    await fetch(`${h.base}/register/login`, { redirect: 'manual' });
    const res = await fetch(`${h.base}/register/login`, { redirect: 'manual' });
    expect(res.status).toBe(429);
    expect(res.headers.get('content-type')).toContain('text/html');
    const wait = Number(res.headers.get('retry-after'));
    expect(await res.text()).toBe(errorPage(429, wait));
  });

  it('answers an owner post past the owner window with the HTML 429 page', async () => {
    await start({ ownerPerMinute: 1 });
    const s = await signIn('7101');
    const first = await post('/register/players', s, {
      player_id: 'ag-first',
      name: 'One',
      harness: 'claude-code',
    });
    expect(first.status).not.toBe(429);
    const res = await post('/register/players', s, {
      player_id: 'ag-second',
      name: 'Two',
      harness: 'claude-code',
    });
    expect(res.status).toBe(429);
    expect(res.headers.get('content-type')).toContain('text/html');
    const wait = Number(res.headers.get('retry-after'));
    expect(await res.text()).toBe(errorPage(429, wait));
  });

  it('refuses a banned owner post with the HTML 403 page', async () => {
    const store = await start();
    const s = await signIn('7102');
    for (const owner of store.owners.values()) (owner as { banned: boolean }).banned = true;
    const res = await post('/register/players', s, {
      player_id: 'ag-banned',
      name: 'One',
      harness: 'claude-code',
    });
    expect(res.status).toBe(403);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toBe(errorPage(403));
  });
});
