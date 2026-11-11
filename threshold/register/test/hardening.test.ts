import type { ServerResponse } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { Account, SESSION_TTL_MS } from '../src/account.ts';
import { loadConfig } from '../src/config.ts';
import type { Identity } from '../src/identity.ts';
import { clientAddress, FixedWindow, LIMITER_MAX_KEYS, limiterKey } from '../src/server.ts';
import { FakeStore } from './fake-store.ts';
import { config, type Harness, harness, NOW } from './fixture.ts';

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

function stubRes(): { res: ServerResponse; status: () => number } {
  let code = 0;
  const res = {
    writeHead: (c: number) => {
      code = c;
      return res;
    },
    end: () => res,
  } as unknown as ServerResponse;
  return { res, status: () => code };
}

const identity = (n: number): Identity => ({
  provider: 'microsoft',
  identityHash: n.toString(16).padStart(64, '0'),
  display: `u${n}`,
});

describe('the refusal page (F7b)', () => {
  it('the sign-in refusal page sends referrer-policy no-referrer', async () => {
    h = await harness();
    const res = await h.callback(undefined, 'nope', '');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
  });
});

describe('the limiter (F8)', () => {
  it('keys an IPv6 address by its /64', () => {
    expect(limiterKey('2001:db8:1:2:aaaa:bbbb:cccc:dddd')).toBe(limiterKey('2001:db8:1:2::1'));
    expect(limiterKey('2001:db8:1:2::1')).not.toBe(limiterKey('2001:db8:1:3::1'));
    expect(limiterKey('203.0.113.7')).toBe('203.0.113.7');
  });

  it('charges every address of a /64 to one bucket', () => {
    const w = new FixedWindow(1, () => 0);
    expect(w.charge('2001:db8:1:2::1')).toBe(0);
    expect(w.charge('2001:db8:1:2:f::9')).toBeGreaterThan(0);
  });

  it('evicts the oldest key over the cap and does not reset a live counter', () => {
    let t = 0;
    const w = new FixedWindow(2, () => t);
    expect(w.charge('victim')).toBe(0);
    expect(w.charge('victim')).toBe(0);
    for (let i = 0; i < LIMITER_MAX_KEYS - 1; i++) w.charge(`k${i}`);
    // Within the cap nothing was flushed: the third hit is still refused.
    expect(w.charge('victim')).toBeGreaterThan(0);
    t = 1;
    expect(w.charge('recent')).toBe(0);
    expect(w.charge('recent')).toBe(0);
    for (let i = 0; i < 50; i++) w.charge(`flood${i}`);
    expect(w.charge('recent')).toBeGreaterThan(0);
    // The oldest keys went, one by one; a recent key keeps its count.
    expect(w.charge('flood49')).toBe(0);
    expect(w.charge('flood49')).toBeGreaterThan(0);
    // The oldest key (victim) was evicted individually, so it starts afresh.
    expect(w.charge('victim')).toBe(0);
  });
});

describe('sessions (F8)', () => {
  it('sweeps expired sessions at sign-in and ends a session at POST /logout', async () => {
    const clock = { at: NOW };
    const store = new FakeStore(() => clock.at);
    h = await harness({}, store);
    (store as { now: () => number }).now = () => h?.clock.at ?? 0;
    const login = async (id: string) => {
      h!.idp.userId = id;
      const b = await h!.begin('github');
      const r = await fetch(`${h!.base}/register/callback?code=c&state=${b.state}`, {
        headers: { cookie: b.cookie },
        redirect: 'manual',
      });
      return (
        (r.headers.getSetCookie().find((c) => c.startsWith('gr_session=')) ?? '').split(';')[0] ??
        ''
      );
    };
    const sc = await login('3001');
    const page = await (
      await fetch(`${h.base}/register/account`, { headers: { cookie: sc } })
    ).text();
    const csrf = /name="csrf" value="([^"]+)"/.exec(page)?.[1] ?? '';
    const out = await fetch(`${h.base}/register/logout`, {
      method: 'POST',
      redirect: 'manual',
      headers: { cookie: sc, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ csrf }).toString(),
    });
    expect(out.status).toBe(302);
    expect(out.headers.get('set-cookie')).toContain('Max-Age=0');
    const again = await fetch(`${h.base}/register/account`, {
      headers: { cookie: sc },
      redirect: 'manual',
    });
    expect(again.status).toBe(302);
    h.clock.at += SESSION_TTL_MS + 1;
    expect(await login('3002')).toContain('gr_session=');
  });
});

describe('session sweep (F8)', () => {
  it('drops expired sessions when another user signs in', async () => {
    const clock = { at: NOW };
    const store = new FakeStore(() => clock.at);
    const account = new Account({ config: config(), store, now: () => clock.at, log: () => {} });
    await account.signedIn(identity(1), stubRes().res);
    expect(account.sessionCount).toBe(1);
    clock.at += SESSION_TTL_MS + 1;
    await account.signedIn(identity(2), stubRes().res);
    expect(account.sessionCount).toBe(1);
  });
});

describe('the token pepper (F9)', () => {
  const base = {
    REGISTER_PEPPER_FILE: 'p',
    REGISTER_TOKEN_PEPPER_FILE: 't',
    REGISTER_MS_CLIENT_ID: 'ms-id',
    REGISTER_MS_CLIENT_SECRET_FILE: 'm',
    REGISTER_SESSION_KEY_FILE: 's',
    REGISTER_PUBLIC_URL: 'https://glass.example.invalid',
    REGISTER_SHARD: 'colo',
  };
  const read = (token: string) => (p: string) =>
    p === 't' ? token : p === 'p' || p === 's' ? 'p'.repeat(40) : 'x';
  const pepper = 'q'.repeat(32);

  it('strips one trailing newline only and keeps edge spaces', () => {
    expect(loadConfig(base, read(`${pepper}\n`)).tokenPepper).toBe(pepper);
    expect(loadConfig(base, read(`${pepper}\r\n`)).tokenPepper).toBe(pepper);
    expect(loadConfig(base, read(` ${pepper} \n`)).tokenPepper).toBe(` ${pepper} `);
    expect(loadConfig(base, read(`${pepper}\n\n`)).tokenPepper).toBe(`${pepper}\n`);
  });

  it('refuses a byte-order mark and a pepper under 32 bytes', () => {
    expect(() => loadConfig(base, read(`﻿${pepper}`))).toThrow(/byte-order mark/);
    expect(() => loadConfig(base, read('short\n'))).toThrow(/32 bytes/);
  });

  it('F27: 31 bytes is refused, 32 accepted (counted in bytes, not characters)', () => {
    expect(() => loadConfig(base, read('q'.repeat(31)))).toThrow(/32 bytes/);
    expect(loadConfig(base, read('q'.repeat(32))).tokenPepper).toHaveLength(32);
    expect(() => loadConfig(base, read('é'.repeat(15)))).toThrow(/32 bytes/);
    expect(loadConfig(base, read('é'.repeat(16))).tokenPepper).toHaveLength(16);
  });

  it('F26: trusted peers are IP literals; a CIDR range is refused at startup', () => {
    expect(
      loadConfig({ ...base, REGISTER_TRUSTED_PEERS: '192.0.2.1, ::1' }, read(pepper)).trustedPeers,
    ).toEqual(['192.0.2.1', '::1']);
    expect(() =>
      loadConfig({ ...base, REGISTER_TRUSTED_PEERS: '192.0.2.0/24' }, read(pepper)),
    ).toThrow(/not an IP literal/);
    expect(() => loadConfig({ ...base, REGISTER_TRUSTED_PEERS: 'caddy' }, read(pepper))).toThrow(
      /not an IP literal/,
    );
  });
});

describe('clientAddress and limiterKey forms (F26, F27)', () => {
  const req = (peer: string, header?: string) =>
    ({ socket: { remoteAddress: peer }, headers: { 'x-geldar-client-ip': header } }) as never;

  it('reads the header from a trusted peer only', () => {
    expect(clientAddress(req('192.0.2.1', '203.0.113.9'), ['192.0.2.1'])).toBe('203.0.113.9');
    expect(clientAddress(req('192.0.2.2', '203.0.113.9'), ['192.0.2.1'])).toBe('192.0.2.2');
  });

  it('lower-cases and strips leading zeros in the canonical form', () => {
    expect(limiterKey('2001:0DB8:0001:0002::1')).toBe(limiterKey('2001:db8:1:2::1'));
    expect(limiterKey('2001:0DB8:0001:0002::1')).toBe('2001:db8:1:2::/64');
  });
});
