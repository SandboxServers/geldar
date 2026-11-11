import { afterEach, describe, expect, it } from 'vitest';
import { identityHash } from '../src/identity.ts';
import { challengeOf } from '../src/pkce.ts';
import { EMAIL, type Harness, harness, PROVIDER_TOKEN, RAW_ID } from './fixture.ts';

let h: Harness;
afterEach(async () => {
  await h.close();
});

describe('Microsoft sign-in (mocked endpoints)', () => {
  it('admits a valid id token and keys the identity on the subject, not the email', async () => {
    h = await harness();
    const { state, cookie } = await h.begin();
    const res = await h.callback(undefined, state, cookie);
    expect(res.status).toBe(200);
    expect(h.signedIn).toHaveLength(1);
    expect(h.signedIn[0]?.provider).toBe('microsoft');
    expect(h.signedIn[0]?.identityHash).toBe(identityHash('p'.repeat(40), 'microsoft', RAW_ID));
  });

  it('refuses an id token for another audience or another tenant', async () => {
    h = await harness();
    h.idp.aud = 'someone-else';
    let b = await h.begin();
    expect((await h.callback(undefined, b.state, b.cookie)).status).toBe(403);
    h.idp.aud = 'ms-id';
    h.idp.tid = 'a-work-tenant';
    b = await h.begin();
    expect((await h.callback(undefined, b.state, b.cookie)).status).toBe(403);
    expect(h.signedIn).toHaveLength(0);
  });

  it('refuses a replayed state and never calls the provider twice', async () => {
    h = await harness();
    const { state, cookie } = await h.begin();
    expect((await h.callback(undefined, state, cookie)).status).toBe(200);
    const calls = h.idp.tokenCalls;
    expect((await h.callback(undefined, state, cookie)).status).toBe(403);
    expect(h.idp.tokenCalls).toBe(calls);
  });

  it('refuses an expired state at 10 minutes, accepts just under', async () => {
    h = await harness();
    let b = await h.begin();
    h.clock.at += 10 * 60_000 - 1;
    expect((await h.callback(undefined, b.state, b.cookie)).status).toBe(200);
    b = await h.begin();
    h.clock.at += 10 * 60_000;
    expect((await h.callback(undefined, b.state, b.cookie)).status).toBe(403);
  });

  it('refuses a state that does not match the cookie, or a missing cookie', async () => {
    h = await harness();
    const { state } = await h.begin();
    expect((await h.callback(undefined, state, 'gr_state=other')).status).toBe(403);
    expect((await h.callback(undefined, state, '')).status).toBe(403);
  });

  it('refuses when the PKCE verifier does not match the challenge', async () => {
    h = await harness();
    const { state, cookie } = await h.begin();
    h.idp.tamperChallenge = true;
    expect((await h.callback(undefined, state, cookie)).status).toBe(403);
    expect(h.signedIn).toHaveLength(0);
  });

  it('sends an S256 challenge, scope openid, the Glass-host redirect and a Secure HttpOnly Lax cookie', async () => {
    h = await harness();
    const res = await fetch(`${h.base}/register/login`, { redirect: 'manual' });
    const loc = new URL(res.headers.get('location') ?? '');
    expect(loc.origin + loc.pathname).toBe(
      'https://login.microsoftonline.com/consumers/v2.0/authorize',
    );
    expect(loc.searchParams.get('code_challenge_method')).toBe('S256');
    expect(loc.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(loc.searchParams.get('scope')).toBe('openid');
    expect(loc.searchParams.get('redirect_uri')).toBe(
      'https://glass.example.invalid/register/callback',
    );
    const cookie = res.headers.get('set-cookie') ?? '';
    for (const f of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Max-Age=600'])
      expect(cookie).toContain(f);
  });

  it('serves under /register and answers the bare path the same way', async () => {
    h = await harness();
    expect((await fetch(`${h.base}/register`)).status).toBe(200);
    expect((await fetch(`${h.base}/register/`)).status).toBe(200);
    expect((await fetch(`${h.base}/registerx`)).status).toBe(404);
    expect((await fetch(`${h.base}/nope`)).status).toBe(404);
  });

  it('keeps email, raw id and provider token out of logs', async () => {
    h = await harness();
    const { state, cookie } = await h.begin();
    await h.callback(undefined, state, cookie);
    h.idp.tid = 'x';
    const b = await h.begin();
    await h.callback(undefined, b.state, b.cookie);
    const all = h.logs.join('\n');
    expect(h.logs.length).toBeGreaterThan(0);
    for (const secret of [EMAIL, RAW_ID, PROVIDER_TOKEN]) expect(all).not.toContain(secret);
  });
});

describe('identity and controls', () => {
  it('derives HMAC-SHA256(pepper, provider:id) and differs by provider and pepper', async () => {
    const a = identityHash('pep', 'microsoft', '1');
    expect(identityHash('pep', 'github' as never, '1')).not.toBe(a);
    expect(identityHash('pep2', 'microsoft', '1')).not.toBe(a);
    expect(a).toHaveLength(64);
    expect(challengeOf('abc')).toBe('ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0');
    const { createHmac } = await import('node:crypto');
    expect(a).toBe(createHmac('sha256', 'pep').update('microsoft:1').digest('hex'));
  });

  it('answers 503 on every route while the kill switch is on (the default)', async () => {
    h = await harness({ killSwitch: true });
    for (const path of ['/register', '/register/login', '/register/callback?code=a&state=b']) {
      const res = await fetch(`${h.base}${path}`, { redirect: 'manual' });
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({
        error: { code: 'unavailable', message: 'Service unavailable' },
      });
    }
  });

  it('rate-limits per address with the 0090 shape, and honours the header only from a trusted peer', async () => {
    h = await harness({ perMinute: 2, trustedPeers: ['127.0.0.1'] });
    const get = (ip: string) =>
      fetch(`${h.base}/register`, { headers: { 'x-geldar-client-ip': ip } });
    expect((await get('192.0.2.9')).status).toBe(200);
    expect((await get('192.0.2.9')).status).toBe(200);
    const refused = await get('192.0.2.9');
    expect(refused.status).toBe(429);
    expect(await refused.json()).toMatchObject({ error: { code: 'rate_limited' }, retryAfter: 60 });
    expect(refused.headers.get('retry-after')).toBe('60');
    expect((await get('192.0.2.8')).status).toBe(200);
    await h.close();
    h = await harness({ perMinute: 1, trustedPeers: [] });
    expect((await get('192.0.2.7')).status).toBe(200);
    expect((await get('192.0.2.6')).status).toBe(429);
  });

  it('limits sign-in separately and tighter: the last allowed attempt passes, the next is 429, the window reopens', async () => {
    h = await harness({ signInPerMinute: 3, perMinute: 1000 });
    for (let i = 0; i < 3; i++)
      expect((await fetch(`${h.base}/register/login`, { redirect: 'manual' })).status).toBe(302);
    const refused = await fetch(`${h.base}/register/login`, { redirect: 'manual' });
    expect(refused.status).toBe(429);
    expect(await refused.json()).toMatchObject({ error: { code: 'rate_limited' } });
    // The callback shares the sign-in window; the home page does not.
    expect((await fetch(`${h.base}/register/callback?code=a&state=b`)).status).toBe(429);
    expect((await fetch(`${h.base}/register`)).status).toBe(200);
    h.clock.at += 60_000;
    expect((await fetch(`${h.base}/register/login`, { redirect: 'manual' })).status).toBe(302);
  });

  it('judges an IPv6 sign-in by its /64', async () => {
    h = await harness({ signInPerMinute: 1, perMinute: 1000, trustedPeers: ['127.0.0.1'] });
    const login = (ip: string) =>
      fetch(`${h.base}/register/login`, {
        redirect: 'manual',
        headers: { 'x-geldar-client-ip': ip },
      });
    expect((await login('2001:db8:1:2::1')).status).toBe(302);
    expect((await login('2001:db8:1:2:ffff::9')).status).toBe(429);
    expect((await login('2001:db8:1:3::1')).status).toBe(302);
  });

  it('sets the strict CSP, HSTS and no-store, with no inline script', async () => {
    h = await harness();
    const res = await fetch(`${h.base}/register`);
    expect(res.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(res.headers.get('strict-transport-security')).toContain('max-age=');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.text()).not.toContain('<script');
  });
});
