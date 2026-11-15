import { afterEach, describe, expect, it } from 'vitest';
import { signOutCookies } from '../src/account.ts';
import { FakeStore } from './fake-store.ts';
import { type Harness, harness, NOW, RAW_ID } from './fixture.ts';

let h: Harness;
afterEach(async () => {
  await h.close();
});

async function start(): Promise<void> {
  const clock = { at: NOW };
  const store = new FakeStore(() => clock.at);
  h = await harness({}, store);
  (store as { now: () => number }).now = () => h.clock.at;
}

interface Session {
  /** The session cookie as the browser sends it back: `__Host-gr_session=<id>`. */
  cookie: string;
  /** Every Set-Cookie header of the sign-in redirect. */
  headers: string[];
  csrf: string;
}

/** Signs in with the consent box ticked and reads the session and its form token. */
async function signIn(): Promise<Session> {
  h.idp.userId = RAW_ID;
  const { state, cookie } = await h.begin(undefined, true);
  const res = await fetch(`${h.base}/register/callback?code=c&state=${state}`, {
    headers: { cookie },
    redirect: 'manual',
  });
  const headers = res.headers.getSetCookie();
  const set = headers.find((c) => c.startsWith('__Host-gr_session=')) ?? '';
  const sc = set.split(';')[0] ?? '';
  const page = await (
    await fetch(`${h.base}/register/account`, { headers: { cookie: sc } })
  ).text();
  return { cookie: sc, headers, csrf: /name="csrf" value="([^"]+)"/.exec(page)?.[1] ?? '' };
}

const account = (cookie: string): Promise<Response> =>
  fetch(`${h.base}/register/account`, { headers: { cookie }, redirect: 'manual' });

const PLAYER = 'ag-one-01';

async function mint(s: Session, path = '/register/players'): Promise<void> {
  await fetch(`${h.base}${path}`, {
    method: 'POST',
    redirect: 'manual',
    headers: { cookie: s.cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      csrf: s.csrf,
      player_id: PLAYER,
      name: 'One',
      harness: 'claude-code',
    }).toString(),
  });
}

const onboarding = (s: Session, site?: string): Promise<Response> =>
  fetch(`${h.base}/register/onboarding`, {
    headers:
      site === undefined ? { cookie: s.cookie } : { cookie: s.cookie, 'sec-fetch-site': site },
  });
const tokenIn = (html: string): string => /gmcp-[0-9a-f]{64}/.exec(html)?.[0] ?? '';

describe('session cookie names (CF-5)', () => {
  it('sets the session and the state cookie with the __Host- prefix, Secure, Path=/ and no Domain', async () => {
    await start();
    h.idp.userId = RAW_ID;
    const { state, cookie } = await h.begin(undefined, true);
    expect(cookie.startsWith('__Host-gr_state=')).toBe(true);
    const login = await fetch(`${h.base}/register/login?consent=yes`, { redirect: 'manual' });
    const stateSet =
      login.headers.getSetCookie().find((c) => c.startsWith('__Host-gr_state=')) ?? '';
    expect(stateSet).toMatch(/;\s*Path=\/(;|$)/);
    expect(stateSet).toContain('Secure');
    expect(stateSet).toContain('HttpOnly');
    expect(stateSet).not.toMatch(/;\s*domain=/i);
    const res = await fetch(`${h.base}/register/callback?code=c&state=${state}`, {
      headers: { cookie },
      redirect: 'manual',
    });
    const set = res.headers.getSetCookie().find((c) => c.startsWith('__Host-gr_session=')) ?? '';
    expect(set).not.toBe('');
    expect(set).toMatch(/;\s*Path=\/(;|$)/);
    expect(set).toContain('Secure');
    expect(set).toContain('HttpOnly');
    expect(set).not.toMatch(/;\s*domain=/i);
  });

  it('clears the old gr_session and gr_state names on sign-in, host-only, for one release', async () => {
    await start();
    const s = await signIn();
    const oldSession = s.headers.filter((c) => c.startsWith('gr_session=;'));
    expect(oldSession).toHaveLength(1);
    expect(oldSession[0]).toContain('Max-Age=0');
    expect(oldSession[0]).not.toMatch(/;\s*domain=/i);
    expect(s.headers.some((c) => c.startsWith('gr_state=;') && c.includes('Max-Age=0'))).toBe(true);
  });

  it('the old gr_session name no longer authenticates', async () => {
    await start();
    const s = await signIn();
    const oldName = s.cookie.replace('__Host-gr_session=', 'gr_session=');
    expect((await account(oldName)).status).toBe(302);
    expect((await account(s.cookie)).status).toBe(200);
  });

  it('a header with two cookies of the session name is no session, in either order', async () => {
    await start();
    const s = await signIn();
    const planted = '__Host-gr_session=planted-value';
    expect((await account(`${s.cookie}; ${s.cookie}`)).status).toBe(302);
    expect((await account(`${s.cookie}; ${planted}`)).status).toBe(302);
    expect((await account(`${planted}; ${s.cookie}`)).status).toBe(302);
    expect((await account(s.cookie)).status).toBe(200);
  });

  it('logout clears the new name and the old names, host-only', async () => {
    await start();
    const s = await signIn();
    const res = await fetch(`${h.base}/register/logout`, {
      method: 'POST',
      redirect: 'manual',
      headers: { cookie: s.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ csrf: s.csrf }).toString(),
    });
    expect(res.status).toBe(302);
    const set = res.headers.getSetCookie();
    expect(set.some((c) => c.startsWith('__Host-gr_session=;') && c.includes('Max-Age=0'))).toBe(
      true,
    );
    expect(set.some((c) => c.startsWith('gr_session=;') && c.includes('Max-Age=0'))).toBe(true);
    expect(set.some((c) => c.startsWith('gr_state=;') && c.includes('Max-Age=0'))).toBe(true);
    for (const c of set) expect(c).not.toMatch(/;\s*domain=/i);
    // logout and the account delete clear exactly the same list (signOutCookies), in the same order (review fix 2)
    expect(set).toEqual(signOutCookies());
  });
});

describe('onboarding fetch-metadata (CF-4)', () => {
  it('a cross-site GET renders the empty page and does not consume the token', async () => {
    await start();
    const s = await signIn();
    await mint(s);
    const cross = await (await onboarding(s, 'cross-site')).text();
    expect(tokenIn(cross)).toBe('');
    expect(cross).toContain('No token to show');
    const same = await (await onboarding(s, 'same-origin')).text();
    expect(tokenIn(same)).not.toBe('');
  });

  it('a cross-site empty page says the token is held for the signed-in browser, not that it is gone', async () => {
    await start();
    const s = await signIn();
    await mint(s);
    const cross = await (await onboarding(s, 'cross-site')).text();
    expect(cross).toContain('opened from another site');
    expect(cross).not.toContain('not shown again');
    expect(tokenIn(cross)).toBe('');
    expect(tokenIn(await (await onboarding(s, 'same-origin')).text())).not.toBe('');
    const consumed = await (await onboarding(s, 'same-origin')).text();
    expect(consumed).toContain('not shown again');
    expect(consumed).not.toContain('opened from another site');
  });

  it('a same-site GET renders the empty page and does not consume the token', async () => {
    await start();
    const s = await signIn();
    await mint(s);
    expect(tokenIn(await (await onboarding(s, 'same-site')).text())).toBe('');
    expect(tokenIn(await (await onboarding(s, 'same-origin')).text())).not.toBe('');
  });

  it('a typed or bookmarked GET (none) and an old client with no header both show the token', async () => {
    await start();
    const s = await signIn();
    await mint(s);
    expect(tokenIn(await (await onboarding(s, 'none')).text())).not.toBe('');
    const other = await signIn();
    await mint(other, `/register/players/${PLAYER}/token`);
    expect(tokenIn(await (await onboarding(other)).text())).not.toBe('');
  });
});
