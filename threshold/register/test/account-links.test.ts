import { afterEach, describe, expect, it } from 'vitest';
import { FakeStore } from './fake-store.ts';
import { type Harness, harness, NOW } from './fixture.ts';

let h: Harness;
afterEach(async () => {
  await h.close();
});

async function start(): Promise<FakeStore> {
  const clock = { at: NOW };
  const store = new FakeStore(() => clock.at);
  h = await harness({}, store);
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
  const set = res.headers.getSetCookie().find((c) => c.startsWith('gr_session='));
  const sc = (set ?? '').split(';')[0] ?? '';
  const page = await (
    await fetch(`${h.base}/register/account`, { headers: { cookie: sc } })
  ).text();
  return { cookie: sc, csrf: /name="csrf" value="([^"]+)"/.exec(page)?.[1] ?? '' };
}

async function accountPage(s: Session): Promise<string> {
  return (await fetch(`${h.base}/register/account`, { headers: { cookie: s.cookie } })).text();
}

/** An owner with one player, and the store the player lives in. */
async function ownerWithPlayer(userId: string, playerId: string): Promise<[FakeStore, Session]> {
  const store = await start();
  const s = await signIn(userId);
  const res = await fetch(`${h.base}/register/players`, {
    method: 'POST',
    redirect: 'manual',
    headers: { cookie: s.cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      csrf: s.csrf,
      player_id: playerId,
      name: 'One',
      harness: 'claude-code',
    }).toString(),
  });
  expect(res.status).not.toBe(403);
  expect(store.players.has(playerId)).toBe(true);
  return [store, s];
}

function setFlags(store: FakeStore, playerId: string, flags: Record<string, boolean>): void {
  const p = store.players.get(playerId);
  if (p === undefined) throw new Error('no player');
  store.players.set(playerId, { ...p, ...flags });
}

describe('account page view links (C7-06b)', () => {
  it('shows both links to the owner while both flags are off (0138 rule 1, 0075)', async () => {
    const [, s] = await ownerWithPlayer('7201', 'ag-links-off');
    const page = await accountPage(s);
    expect(page).toContain('<a href="/">View in Glass</a>');
    expect(page).toContain('<a href="/kino/">View in Kino</a>');
  });

  it('shows both links to the owner whatever the flags say, on or off', async () => {
    const [store, s] = await ownerWithPlayer('7202', 'ag-links-glass');
    setFlags(store, 'ag-links-glass', { thoughtsDelayedPublic: true });
    const on = await accountPage(s);
    expect(on).toContain('<a href="/">View in Glass</a>');
    expect(on).toContain('<a href="/kino/">View in Kino</a>');
    setFlags(store, 'ag-links-glass', { thoughtsDelayedPublic: false, publicCamera: false });
    const off = await accountPage(s);
    expect(off).toContain('<a href="/">View in Glass</a>');
    expect(off).toContain('<a href="/kino/">View in Kino</a>');
  });

  it('hides both links for a retired agent, and keeps the retired row', async () => {
    const [store, s] = await ownerWithPlayer('7203', 'ag-links-retired');
    setFlags(store, 'ag-links-retired', { publicCamera: true, thoughtsDelayedPublic: true });
    const p = store.players.get('ag-links-retired');
    if (p === undefined) throw new Error('no player');
    store.players.set('ag-links-retired', { ...p, status: 'retired' });
    const page = await accountPage(s);
    expect(page).not.toContain('Status: retired');
    expect(page).toContain(', retired)');
    expect(page).not.toContain('View in Glass');
    expect(page).not.toContain('View in Kino');
  });

  it('keeps the agent id out of the view links', async () => {
    const [store, s] = await ownerWithPlayer('7204', 'ag-links-id');
    setFlags(store, 'ag-links-id', { publicCamera: true, thoughtsDelayedPublic: true });
    const page = await accountPage(s);
    const hrefs = [...page.matchAll(/<a href="([^"]*)">View in (Glass|Kino)<\/a>/g)].map(
      (m) => m[1],
    );
    expect(hrefs).toEqual(['/', '/kino/']);
    expect(hrefs.join(' ')).not.toContain('ag-links-id');
  });
});
