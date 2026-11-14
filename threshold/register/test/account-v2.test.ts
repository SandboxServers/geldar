import { afterEach, describe, expect, it } from 'vitest';
import { errorPage } from '../src/errors.ts';
import { FakeStore } from './fake-store.ts';
import { type Harness, harness, NOW } from './fixture.ts';

let h: Harness;
let store: FakeStore;
afterEach(async () => {
  await h.close();
});

async function start(): Promise<void> {
  const clock = { at: NOW };
  store = new FakeStore(() => clock.at);
  h = await harness({}, store);
  (store as { now: () => number }).now = () => h.clock.at;
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

async function accountPage(s: Session): Promise<string> {
  return (await fetch(`${h.base}/register/account`, { headers: { cookie: s.cookie } })).text();
}

const newPlayer = (id: string) => ({ player_id: id, name: 'One', harness: 'claude-code' });

describe('account page v2 (C7-06): mobile and accessibility', () => {
  it('has a viewport meta so the page scales on a phone', async () => {
    await start();
    const s = await signIn('6001');
    const page = await accountPage(s);
    expect(page).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">');
  });

  it('links the account stylesheet and serves it as CSS under the CSP', async () => {
    await start();
    const s = await signIn('6002');
    const page = await accountPage(s);
    expect(page).toContain('<link rel="stylesheet" href="/register/account.css">');
    const css = await fetch(`${h.base}/register/account.css`);
    expect(css.status).toBe(200);
    expect(css.headers.get('content-type')).toBe('text/css; charset=utf-8');
    expect(css.headers.get('content-security-policy')).toContain("style-src 'self'");
    expect((await css.text()).length).toBeGreaterThan(0);
  });

  it('has no inline style attribute and no style element (CSP style-src self)', async () => {
    await start();
    const s = await signIn('6003');
    await post('/register/players', s, newPlayer('ag-one-01'));
    const page = await accountPage(s);
    expect(page).not.toMatch(/\sstyle=/);
    expect(page).not.toContain('<style');
  });

  it('labels every visible input and select (the rendered HTML, with a player listed)', async () => {
    await start();
    const s = await signIn('6004');
    await post('/register/players', s, newPlayer('ag-one-01'));
    const page = await accountPage(s);
    // Hidden fields need no label. Every other input or select must sit inside a label element.
    const unlabelled = page.replace(/<label[^>]*>[\s\S]*?<\/label>/g, '');
    expect(unlabelled).not.toMatch(/<input(?![^>]*type="hidden")/);
    expect(unlabelled).not.toMatch(/<select/);
  });
});

describe('account page v2 (C7-06): agent controls', () => {
  it('drops the repeated status line and keeps the plain visibility explanation', async () => {
    await start();
    const s = await signIn('6005');
    await post('/register/players', s, newPlayer('ag-one-01'));
    const page = await accountPage(s);
    expect(page).not.toContain('<p class="status">Status: active</p>');
    expect(page).toContain(', active)');
    expect(page).toContain(
      'Public camera: when on, the camera view of an agent may be shown to the public.',
    );
    expect(page).toContain(
      'Delayed public thoughts: when on, the thoughts of an agent may be shown to the public after a delay.',
    );
  });

  it('posts the thoughts form with the CSRF token, and accepts the owner own agent', async () => {
    await start();
    const s = await signIn('6006');
    await post('/register/players', s, newPlayer('ag-one-01'));
    const page = await accountPage(s);
    expect(page).toContain(
      '<form method="post" action="/register/players/ag-one-01/public-thoughts"><input type="hidden" name="csrf"',
    );
    const res = await post('/register/players/ag-one-01/public-thoughts', s, { value: 'on' });
    expect(await res.text()).toContain('Delayed public thoughts updated.');
  });

  it('refuses the thoughts form for another owner agent', async () => {
    await start();
    const owner = await signIn('6007');
    await post('/register/players', owner, newPlayer('ag-one-01'));
    const other = await signIn('6008');
    const res = await post('/register/players/ag-one-01/public-thoughts', other, { value: 'on' });
    const body = await res.text();
    expect(body).toContain('That player cannot be changed.');
    expect(body).not.toContain('Delayed public thoughts updated.');
  });

  it('does not list another owner agent, with a second owner signed in', async () => {
    await start();
    const a = await signIn('6009');
    await post('/register/players', a, newPlayer('ag-aaa-01'));
    const b = await signIn('6010');
    expect(await accountPage(b)).not.toContain('ag-aaa-01');
  });
});

describe('error pages (C7-06): HTML for the browser, JSON under /api/', () => {
  it('renders a 429 and a 503 as HTML with a retry hint', () => {
    const r429 = errorPage(429, 30);
    expect(r429).toContain('<!doctype html>');
    expect(r429).toContain('Try again in 30 seconds.');
    const r503 = errorPage(503, 60);
    expect(r503).toContain('<!doctype html>');
    expect(r503).toContain('Try again in 60 seconds.');
    expect(errorPage(503)).toContain('Try again later.');
  });

  it('renders 403 and 404 as HTML without a retry hint', () => {
    for (const status of [403, 404]) {
      const page = errorPage(status);
      expect(page).toContain('<!doctype html>');
      expect(page).not.toContain('Try again');
    }
  });

  it('keeps problem JSON for an unknown path under /api/', async () => {
    await start();
    const res = await fetch(`${h.base}/register/api/v1/no-such-route`);
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/problem+json');
  });
});
