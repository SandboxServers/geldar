import { afterEach, describe, expect, it } from 'vitest';
import { identityHash } from '../src/identity.ts';
import { challengeOf } from '../src/pkce.ts';
import { DAY, EMAIL, HANDLE, type Harness, harness, PROVIDER_TOKEN, RAW_ID } from './fixture.ts';

let h: Harness;
afterEach(async () => {
  await h.close();
});

describe.each(['github', 'discord'] as const)('sign-in with %s', (p) => {
  it('admits a verified, old-enough account', async () => {
    h = await harness();
    const { state, cookie } = await h.begin(p);
    const res = await h.callback(p, state, cookie);
    expect(res.status).toBe(200);
    expect(h.signedIn).toHaveLength(1);
    expect(h.signedIn[0]?.display).toBe(HANDLE);
    expect(h.signedIn[0]?.identityHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('refuses an unverified account with the fixed page', async () => {
    h = await harness();
    h.idp.verified = false;
    const { state, cookie } = await h.begin(p);
    const res = await h.callback(p, state, cookie);
    expect(res.status).toBe(403);
    expect(await res.text()).toContain('cannot register');
    expect(h.signedIn).toHaveLength(0);
  });

  it('applies the age floor at 29 and 30 days', async () => {
    h = await harness();
    h.idp.createdAtMs = h.clock.at - 29 * DAY;
    let b = await h.begin(p);
    expect((await h.callback(p, b.state, b.cookie)).status).toBe(403);
    h.idp.createdAtMs = h.clock.at - 30 * DAY;
    b = await h.begin(p);
    expect((await h.callback(p, b.state, b.cookie)).status).toBe(200);
  });

  it('refuses a replayed state and never calls the provider twice', async () => {
    h = await harness();
    const { state, cookie } = await h.begin(p);
    expect((await h.callback(p, state, cookie)).status).toBe(200);
    const calls = h.idp.tokenCalls;
    expect((await h.callback(p, state, cookie)).status).toBe(403);
    expect(h.idp.tokenCalls).toBe(calls);
  });

  it('refuses an expired state at 10 minutes, accepts just under', async () => {
    h = await harness();
    let b = await h.begin(p);
    h.clock.at += 10 * 60_000 - 1;
    expect((await h.callback(p, b.state, b.cookie)).status).toBe(200);
    b = await h.begin(p);
    h.clock.at += 10 * 60_000;
    expect((await h.callback(p, b.state, b.cookie)).status).toBe(403);
  });

  it('refuses a state that does not match the cookie, or a missing cookie', async () => {
    h = await harness();
    const { state } = await h.begin(p);
    expect((await h.callback(p, state, 'gr_state=other')).status).toBe(403);
    expect((await h.callback(p, state, '')).status).toBe(403);
  });

  it('refuses when the PKCE verifier does not match the challenge', async () => {
    h = await harness();
    const { state, cookie } = await h.begin(p);
    h.idp.tamperChallenge = true;
    expect((await h.callback(p, state, cookie)).status).toBe(403);
    expect(h.signedIn).toHaveLength(0);
  });

  it('sends an S256 challenge and a Secure HttpOnly Lax cookie', async () => {
    h = await harness();
    const res = await fetch(`${h.base}/login/${p}`, { redirect: 'manual' });
    const loc = new URL(res.headers.get('location') ?? '');
    expect(loc.searchParams.get('code_challenge_method')).toBe('S256');
    expect(loc.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const cookie = res.headers.get('set-cookie') ?? '';
    for (const f of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Max-Age=600'])
      expect(cookie).toContain(f);
  });

  it('keeps email, raw id, handle and provider token out of logs', async () => {
    h = await harness();
    const { state, cookie } = await h.begin(p);
    await h.callback(p, state, cookie);
    h.idp.verified = false;
    const b = await h.begin(p);
    await h.callback(p, b.state, b.cookie);
    const all = h.logs.join('\n');
    expect(h.logs.length).toBeGreaterThan(0);
    for (const secret of [EMAIL, RAW_ID, HANDLE, PROVIDER_TOKEN]) expect(all).not.toContain(secret);
  });
});

describe('identity and controls', () => {
  it('derives HMAC-SHA256(pepper, provider:id) and differs by provider and pepper', () => {
    const a = identityHash('pep', 'github', '1');
    expect(identityHash('pep', 'discord', '1')).not.toBe(a);
    expect(identityHash('pep2', 'github', '1')).not.toBe(a);
    expect(a).toHaveLength(64);
    expect(challengeOf('abc')).toBe('ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0');
  });

  it('matches a known HMAC vector', async () => {
    const { createHmac } = await import('node:crypto');
    expect(identityHash('pep', 'github', '1')).toBe(
      createHmac('sha256', 'pep').update('github:1').digest('hex'),
    );
  });

  it('answers 503 on every route while the kill switch is on (the default)', async () => {
    h = await harness({ killSwitch: true });
    for (const path of ['/', '/login/github', '/callback/discord?code=a&state=b']) {
      const res = await fetch(`${h.base}${path}`, { redirect: 'manual' });
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({
        error: { code: 'unavailable', message: 'Service unavailable' },
      });
    }
  });

  it('rate-limits per address with the 0090 shape, and honours the header only from a trusted peer', async () => {
    h = await harness({ perMinute: 2, trustedPeers: ['127.0.0.1'] });
    const get = (ip: string) => fetch(`${h.base}/`, { headers: { 'x-geldar-client-ip': ip } });
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

  it('sets the strict CSP, HSTS and no-store, with no inline script', async () => {
    h = await harness();
    const res = await fetch(`${h.base}/`);
    expect(res.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(res.headers.get('strict-transport-security')).toContain('max-age=');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.text()).not.toContain('<script');
  });
});
