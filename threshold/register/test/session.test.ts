import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { Account, SESSION_COOKIE } from '../src/account.ts';
import type { Identity } from '../src/identity.ts';
import { PgStore } from '../src/pg-store.ts';
import { SESSION_CAP_MS, SESSION_IDLE_MS, slideExpiry } from '../src/session-store.ts';
import { FakeSessionStore } from './fake-session-store.ts';
import { FakeStore } from './fake-store.ts';
import { config } from './fixture.ts';

const MIN = 60_000;
const T0 = Date.parse('2026-11-11T00:00:00Z');
const identity: Identity = {
  provider: 'microsoft',
  identityHash: 'ab'.repeat(32),
  display: 'someone',
};

interface Captured {
  status: number;
  headers: Record<string, string | string[]>;
  body: string;
}

/** A response that records what the handler wrote. */
function stubRes(): { res: ServerResponse; out: Captured } {
  const out: Captured = { status: 0, headers: {}, body: '' };
  const res = {
    writeHead(code: number, headers: Record<string, string | string[]> = {}) {
      out.status = code;
      out.headers = { ...headers };
      return res;
    },
    end(body?: string) {
      out.body = body ?? '';
      return res;
    },
  } as unknown as ServerResponse;
  return { res, out };
}

function request(method: string, cookie: string, body = ''): IncomingMessage {
  return Object.assign(Readable.from(body ? [Buffer.from(body)] : []), {
    method,
    headers: {
      cookie,
      'content-type': 'application/x-www-form-urlencoded',
    },
  }) as unknown as IncomingMessage;
}

/** One request through the account routes, as the server would route it. */
async function call(
  account: Account,
  method: string,
  path: string,
  cookie: string,
  body = '',
): Promise<Captured> {
  const { res, out } = stubRes();
  await account.handle(
    request(method, cookie, body),
    res,
    new URL(`https://glass.example.invalid${path}`),
  );
  return out;
}

const csrfOf = (page: string): string => /name="csrf" value="([^"]+)"/.exec(page)?.[1] ?? '';

/** A world with one clock, one owner table and one session table; each Account is a process. */
function world() {
  const clock = { at: T0 };
  const store = new FakeStore(() => clock.at);
  const sessions = new FakeSessionStore();
  const process = () =>
    new Account({ config: config(), store, sessions, now: () => clock.at, log: () => {} });
  return { clock, store, sessions, process };
}

/** Signs in and returns the gr_session cookie as the browser sends it back. */
async function signIn(account: Account): Promise<string> {
  const { res, out } = stubRes();
  await account.signedIn(identity, res);
  const set = (out.headers['set-cookie'] as string[]).find((c) =>
    c.startsWith(`${SESSION_COOKIE}=`),
  );
  return (set ?? '').split(';')[0] ?? '';
}

describe('register sessions survive a restart (C7-01)', () => {
  it('a session created on one process still works on a new process over the same table', async () => {
    const w = world();
    const cookie = await signIn(w.process());
    const restarted = w.process();
    const page = await call(restarted, 'GET', '/account', cookie);
    expect(page.status).toBe(200);
    expect(csrfOf(page.body)).not.toBe('');
  });
});

describe('sliding renewal and the 12 hour cap (C7-01)', () => {
  it('activity at minute 25 extends the session to minute 55; no activity to minute 31 expires it', async () => {
    const w = world();
    const a = w.process();
    const active = await signIn(a);
    const idle = await signIn(a);
    w.clock.at = T0 + 25 * MIN;
    expect((await call(a, 'GET', '/account', active)).status).toBe(200);
    w.clock.at = T0 + 31 * MIN;
    expect((await call(a, 'GET', '/account', idle)).status).toBe(401);
    // The active session was last seen at minute 25, so it ends exactly at minute 55.
    w.clock.at = T0 + 55 * MIN;
    expect((await call(a, 'GET', '/account', active)).status).toBe(401);
  });

  it('activity at hour 11 does not extend a session past 12 hours from sign-in', async () => {
    const w = world();
    const a = w.process();
    const cookie = await signIn(a);
    // Activity every 20 minutes keeps the idle window open all the way to the cap.
    for (let t = 20 * MIN; t <= 11 * 60 * MIN + 40 * MIN; t += 20 * MIN) {
      w.clock.at = T0 + t;
      expect((await call(a, 'GET', '/account', cookie)).status).toBe(200);
    }
    w.clock.at = T0 + SESSION_CAP_MS - 1;
    expect((await call(a, 'GET', '/account', cookie)).status).toBe(200);
    w.clock.at = T0 + SESSION_CAP_MS;
    expect((await call(a, 'GET', '/account', cookie)).status).toBe(401);
  });

  it('the session at its expiry second is refused; the second before it is served', async () => {
    const w = world();
    const a = w.process();
    // Two sessions signed in at the same instant expire at the same instant.
    const served = await signIn(a);
    const refused = await signIn(a);
    w.clock.at = T0 + SESSION_IDLE_MS - 1;
    expect((await call(a, 'GET', '/account', served)).status).toBe(200);
    w.clock.at = T0 + SESSION_IDLE_MS;
    expect((await call(a, 'GET', '/account', refused)).status).toBe(401);
  });

  it('computes the slid expiry from the idle window and the cap', () => {
    expect(slideExpiry(T0, T0)).toBe(T0 + SESSION_IDLE_MS);
    expect(slideExpiry(T0, T0 + 11 * 60 * MIN + 45 * MIN)).toBe(T0 + SESSION_CAP_MS);
    expect(slideExpiry(T0, T0 + SESSION_CAP_MS - 1)).toBe(T0 + SESSION_CAP_MS);
  });
});

describe('logout and the expired page (C7-01)', () => {
  it('logout deletes the row, and the old cookie is refused afterwards with the expired page', async () => {
    const w = world();
    const a = w.process();
    const cookie = await signIn(a);
    const csrf = csrfOf((await call(a, 'GET', '/account', cookie)).body);
    const out = await call(a, 'POST', '/logout', cookie, new URLSearchParams({ csrf }).toString());
    expect(out.status).toBe(302);
    expect(w.sessions.size()).toBe(0);
    const again = await call(a, 'GET', '/account', cookie);
    expect(again.status).toBe(401);
    expect(again.body).toContain('Your session has ended');
    expect(again.headers['set-cookie']).toContain(
      `${SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`,
    );
  });
});

describe('fail closed on a database error (C7-01)', () => {
  it('a lookup error refuses the request with the expired page, and the row survives the outage', async () => {
    const w = world();
    const a = w.process();
    const cookie = await signIn(a);
    w.sessions.fail = true;
    const refused = await call(a, 'GET', '/account', cookie);
    expect(refused.status).toBe(401);
    expect(refused.body).toContain('Your session has ended');
    expect(refused.body).not.toContain('database');
    w.sessions.fail = false;
    expect(w.sessions.size()).toBe(1);
    expect((await call(a, 'GET', '/account', cookie)).status).toBe(200);
  });

  it('a write error at sign-in issues no cookie and leaves no session row', async () => {
    const w = world();
    const a = w.process();
    w.sessions.fail = true;
    const { res, out } = stubRes();
    await expect(a.signedIn(identity, res)).rejects.toThrow('database unavailable');
    expect(out.headers['set-cookie']).toBeUndefined();
    w.sessions.fail = false;
    expect(w.sessions.size()).toBe(0);
  });
});

describe('the Postgres session row (C7-01)', () => {
  it('reads a slid row back with numbers and a hex identity', async () => {
    const store = new PgStore('postgres://user@127.0.0.1:1/none', { shard: 's1' });
    (store as unknown as { pool: unknown }).pool = {
      query: async () => ({
        rows: [
          {
            owner_id: 'reg-1',
            identity_hash: Buffer.from('cd'.repeat(32), 'hex'),
            signed_in_ms: '1000',
            last_seen_ms: '2000',
            expires_ms: '3000',
          },
        ],
      }),
    };
    const row = await store.touch(Buffer.alloc(32), 2000);
    expect(row).toEqual({
      sessionHash: Buffer.alloc(32),
      ownerId: 'reg-1',
      identityHash: 'cd'.repeat(32),
      signedInMs: 1000,
      lastSeenMs: 2000,
      expiresMs: 3000,
    });
  });

  it('returns null for a session the table does not hold or that has ended', async () => {
    const store = new PgStore('postgres://user@127.0.0.1:1/none', { shard: 's1' });
    (store as unknown as { pool: unknown }).pool = { query: async () => ({ rows: [] }) };
    expect(await store.touch(Buffer.alloc(32), 2000)).toBeNull();
  });
});
