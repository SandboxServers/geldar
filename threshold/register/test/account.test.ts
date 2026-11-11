import { afterEach, describe, expect, it } from 'vitest';
import { hashToken } from '../../mcp/src/store/token-hash.ts';
import { SESSION_TTL_MS } from '../src/account.ts';
import { identityHash } from '../src/identity.ts';
import { FakeStore } from './fake-store.ts';
import {
  config,
  EMAIL,
  HANDLE,
  type Harness,
  harness,
  NOW,
  PROVIDER_TOKEN,
  RAW_ID,
} from './fixture.ts';

let h: Harness;
let store: FakeStore;
afterEach(async () => {
  await h.close();
});

async function start(over = {}): Promise<void> {
  const clock = { at: NOW };
  store = new FakeStore(() => clock.at);
  h = await harness(over, store);
  // The store shares the harness clock.
  (store as { now: () => number }).now = () => h.clock.at;
}

interface Session {
  cookie: string;
  csrf: string;
}

/** Signs in with the fake GitHub as `userId`; returns the session cookie and the form token. */
async function signIn(userId = RAW_ID): Promise<{ res: Response; session: Session | null }> {
  h.idp.userId = userId;
  const { state, cookie } = await h.begin('github');
  const res = await fetch(`${h.base}/callback/github?code=c&state=${state}`, {
    headers: { cookie },
    redirect: 'manual',
  });
  const set = res.headers.getSetCookie().find((c) => c.startsWith('gr_session='));
  if (!set) return { res, session: null };
  const sc = set.split(';')[0] ?? '';
  const page = await (await fetch(`${h.base}/account`, { headers: { cookie: sc } })).text();
  return {
    res,
    session: { cookie: sc, csrf: /name="csrf" value="([^"]+)"/.exec(page)?.[1] ?? '' },
  };
}

function post(path: string, s: Session, fields: Record<string, string>, csrf = s.csrf, extra = {}) {
  return fetch(`${h.base}${path}`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      cookie: s.cookie,
      'content-type': 'application/x-www-form-urlencoded',
      ...extra,
    },
    body: new URLSearchParams({ csrf, ...fields }).toString(),
  });
}

const newPlayer = (id = 'ag-one-01') => ({ player_id: id, name: 'One', harness: 'claude-code' });
const tokenIn = (html: string) => /gmcp-[0-9a-f]{64}/.exec(html)?.[0] ?? '';

describe('session and account page', () => {
  it('sets a HttpOnly Secure SameSite=Lax session cookie, clears the state cookie, and creates the owner', async () => {
    await start();
    const { res, session } = await signIn();
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/account');
    const set = res.headers.getSetCookie();
    const sess = set.find((c) => c.startsWith('gr_session=')) ?? '';
    expect(sess).toMatch(/HttpOnly/);
    expect(sess).toMatch(/Secure/);
    expect(sess).toMatch(/SameSite=Lax/);
    expect(set.some((c) => c.startsWith('gr_state=;') && c.includes('Max-Age=0'))).toBe(true);
    expect(store.owners.size).toBe(1);
    expect(session?.csrf).not.toBe('');
  });

  it('sends a visitor without a session, or with an expired one, back to the start', async () => {
    await start();
    const none = await fetch(`${h.base}/account`, { redirect: 'manual' });
    expect(none.status).toBe(302);
    const { session } = await signIn();
    h.clock.at += SESSION_TTL_MS + 1;
    const old = await fetch(`${h.base}/account`, {
      headers: { cookie: session?.cookie ?? '' },
      redirect: 'manual',
    });
    expect(old.status).toBe(302);
    expect(old.headers.get('location')).toBe('/');
  });

  it('is off while the kill switch is on', async () => {
    await start({ killSwitch: true });
    expect((await fetch(`${h.base}/account`, { redirect: 'manual' })).status).toBe(503);
  });
});

describe('CSRF', () => {
  it('refuses a post with no token, a wrong token or a foreign origin, and writes nothing', async () => {
    await start();
    const { session } = await signIn();
    const s = session as Session;
    const before = store.writes.length;
    expect((await post('/players', s, newPlayer(), '')).status).toBe(403);
    expect((await post('/players', s, newPlayer(), 'wrong')).status).toBe(403);
    expect(
      (await post('/players', s, newPlayer(), s.csrf, { origin: 'https://evil.example.invalid' }))
        .status,
    ).toBe(403);
    expect(store.writes.length).toBe(before);
    expect(store.players.size).toBe(0);
  });

  it('refuses a token that belongs to another session', async () => {
    await start();
    const a = (await signIn('1001')).session as Session;
    const b = (await signIn('1002')).session as Session;
    expect((await post('/players', a, newPlayer(), b.csrf)).status).toBe(403);
  });
});

describe('player creation and the once-only token', () => {
  it('shows the token once, stores only its hash, and never shows it again', async () => {
    await start();
    const s = (await signIn()).session as Session;
    const res = await post('/players', s, newPlayer());
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const token = tokenIn(await res.text());
    expect(token).not.toBe('');
    const stored = store.mints[0];
    expect(stored?.tokenHash.equals(hashToken(config().tokenPepper, token))).toBe(true);
    for (const visit of ['/account', '/']) {
      const again = await fetch(`${h.base}${visit}`, { headers: { cookie: s.cookie } });
      expect(tokenIn(await again.text())).toBe('');
    }
  });

  it('keeps the token, the email, the raw id and the provider token out of every write and log', async () => {
    await start();
    const s = (await signIn()).session as Session;
    const token = tokenIn(await (await post('/players', s, newPlayer())).text());
    const all = [...store.writes, ...h.logs].join('\n');
    for (const secret of [token, EMAIL, PROVIDER_TOKEN, `"${RAW_ID}"`, `github:${RAW_ID}`]) {
      expect(all).not.toContain(secret);
    }
    // The handle is stored as the operator-only display, and nowhere in the logs.
    expect(store.writes.join('\n')).toContain(HANDLE);
    expect(h.logs.join('\n')).not.toContain(HANDLE);
    expect(h.logs.join('\n')).not.toContain(s.csrf);
  });

  it('allows three players per owner and refuses the fourth', async () => {
    await start();
    const s = (await signIn()).session as Session;
    for (const id of ['ag-a-01', 'ag-b-01', 'ag-c-01']) {
      expect(tokenIn(await (await post('/players', s, newPlayer(id))).text())).not.toBe('');
    }
    const fourth = await (await post('/players', s, newPlayer('ag-d-01'))).text();
    expect(tokenIn(fourth)).toBe('');
    expect(fourth).toContain('player limit');
    expect(store.players.size).toBe(3);
  });

  it('refuses a bad player id, name, harness and a taken id without a token', async () => {
    await start();
    const s = (await signIn()).session as Session;
    for (const bad of [
      { ...newPlayer(), player_id: 'AG-bad' },
      { ...newPlayer(), name: '<script>' },
      { ...newPlayer(), harness: 'other' },
    ]) {
      expect(tokenIn(await (await post('/players', s, bad)).text())).toBe('');
    }
    expect(store.writes.filter((w) => w.includes('tokenId')).length).toBe(0);
    await post('/players', s, newPlayer());
    expect(await (await post('/players', s, newPlayer())).text()).toContain('taken');
  });
});

describe('list, mint and retire', () => {
  it('mints a new token for the owner own player, and refuses another owner player', async () => {
    await start();
    const a = (await signIn('2001')).session as Session;
    const b = (await signIn('2002')).session as Session;
    await post('/players', a, newPlayer('ag-mine-01'));
    const ok = await post('/players/ag-mine-01/token', a, {});
    expect(tokenIn(await ok.text())).not.toBe('');
    const mintsBefore = store.mints.length;
    const stolen = await post('/players/ag-mine-01/token', b, {});
    expect(tokenIn(await stolen.text())).toBe('');
    expect(store.mints.length).toBe(mintsBefore);
  });

  it('lists only the owner own players', async () => {
    await start();
    const a = (await signIn('3001')).session as Session;
    const b = (await signIn('3002')).session as Session;
    await post('/players', a, newPlayer('ag-aaa-01'));
    const page = await (await fetch(`${h.base}/account`, { headers: { cookie: b.cookie } })).text();
    expect(page).not.toContain('ag-aaa-01');
  });

  it('retires an own player, refuses another owner player, and refuses a token for a retired one', async () => {
    await start();
    const a = (await signIn('4001')).session as Session;
    const b = (await signIn('4002')).session as Session;
    await post('/players', a, newPlayer('ag-ret-01'));
    expect(await (await post('/players/ag-ret-01/retire', b, {})).text()).toContain(
      'cannot be retired',
    );
    expect(store.players.get('ag-ret-01')?.status).toBe('active');
    expect(await (await post('/players/ag-ret-01/retire', a, {})).text()).toContain('retired');
    expect(store.players.get('ag-ret-01')?.status).toBe('retired');
    expect(tokenIn(await (await post('/players/ag-ret-01/token', a, {})).text())).toBe('');
  });
});

// Covers the page text and the FakeStore's own line only. The database rule is asserted by
// sql/test/check-schema.sql and threshold/mcp/test/it/register-gates.it.test.ts.
describe('lifetime player limit (R36)', () => {
  it('allows the 10th creation, refuses the 11th, and still refuses after a retire', async () => {
    await start({ perMinute: 1000 });
    const a = (await signIn('6001')).session as Session;
    for (let i = 1; i <= 10; i++) {
      const id = `ag-churn-${String(i).padStart(2, '0')}`;
      expect(tokenIn(await (await post('/players', a, newPlayer(id))).text())).not.toBe('');
      expect(await (await post(`/players/${id}/retire`, a, {})).text()).toContain('retired');
    }
    const eleventh = await (await post('/players', a, newPlayer('ag-churn-11'))).text();
    expect(tokenIn(eleventh)).toBe('');
    expect(eleventh).toContain('lifetime limit');
    expect(store.players.has('ag-churn-11')).toBe(false);
  });

  it('refuses a retire for a banned identity', async () => {
    await start();
    const a = (await signIn('6101')).session as Session;
    await post('/players', a, newPlayer('ag-ban-01'));
    store.ban(identityHash(config().pepper, 'github', '6101'));
    expect(await (await post('/players/ag-ban-01/retire', a, {})).text()).not.toContain(
      'Player retired',
    );
    expect(store.players.get('ag-ban-01')?.status).toBe('active');
  });
});
describe('controls on sign-in', () => {
  it('admits the 10th new owner of the day and refuses the 11th, but not a returning owner', async () => {
    await start({ perMinute: 1000 });
    for (let i = 0; i < 10; i++) expect((await signIn(String(5000 + i))).session).not.toBeNull();
    const eleventh = await signIn('5999');
    expect(eleventh.res.status).toBe(429);
    expect(await eleventh.res.json()).toMatchObject({ error: { code: 'rate_limited' } });
    expect(store.owners.size).toBe(10);
    expect((await signIn('5000')).session).not.toBeNull();
    // A day later the cap has room again.
    h.clock.at += 86_400_000 + 1;
    expect((await signIn('5999')).session).not.toBeNull();
  });

  it('refuses a banned identity at sign-in with the fixed page', async () => {
    await start();
    await signIn('6001');
    store.ban(identityHash(config().pepper, 'github', '6001'));
    const again = await signIn('6001');
    expect(again.res.status).toBe(403);
    expect(await again.res.text()).toContain('cannot register');
    expect(again.session).toBeNull();
  });

  it('ends a live session at the next write once the identity is banned', async () => {
    await start();
    const s = (await signIn('7001')).session as Session;
    store.ban(identityHash(config().pepper, 'github', '7001'));
    expect((await post('/players', s, newPlayer())).status).toBe(403);
    expect(store.players.size).toBe(0);
  });
});
