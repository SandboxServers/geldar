import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ApiRoute } from '../src/api/route.ts';
import { OnboardingHandoff } from '../src/onboarding-pages.ts';
import { sessionHash } from '../src/session-store.ts';
import type { TokenDeps, TokenStore } from '../src/tokens-service.ts';
import { baseDeps, bearer, CSRF, cookie, KEY_ALL, SID, serve } from './owner-api-harness.ts';

const OLD = `gmcp-${'0a'.repeat(32)}`;
const NEW = `gmcp-${'7e'.repeat(32)}`;

/** A fake token store: the live secret is OLD until a renewal stores NEW. */
function fakeTokens(opts: { failRenew?: boolean } = {}) {
  const calls: string[] = [];
  const audits: unknown[] = [];
  const state = { current: OLD, revoked: false };
  const store: TokenStore = {
    renewToken: async (_identity, _playerId, token) => {
      calls.push('renew');
      if (opts.failRenew) throw new Error('db down');
      state.current = token.secret;
      state.revoked = false;
      return true;
    },
    revokeTokens: async () => {
      calls.push('revoke');
      state.revoked = true;
      return 1;
    },
    tokenInfo: async () => null,
  };
  const deps = (charge: TokenDeps['charge'], isAdmin: TokenDeps['isAdmin']): TokenDeps => ({
    store,
    isAdmin,
    charge,
    audit: async (e) => {
      audits.push(e);
    },
    issue: () => ({ tokenId: 't1', tokenHash: Buffer.alloc(32), secret: NEW }),
    now: () => new Date(0),
  });
  return { calls, audits, state, deps };
}

const RENEW = '/api/v1/agents/p1/tokens';
const REVOKE = '/api/v1/agents/p1/tokens/revoke';

describe('owner API player token routes (C7-04b)', () => {
  const t = fakeTokens();
  const h = baseDeps({
    tokens: t.deps(
      () => 0,
      async () => false,
    ),
  });
  let srv: Awaited<ReturnType<typeof serve>>;
  beforeAll(async () => {
    srv = await serve(h);
  });
  afterAll(() => srv.stop());

  it('answers 401 without credentials and writes nothing', async () => {
    const r = await srv.call('POST', RENEW);
    expect(r.status).toBe(401);
    expect(JSON.parse(r.body).code).toBe('unauthenticated');
    expect(t.calls).toEqual([]);
  });

  it('refuses a Bearer key with every scope at both token routes (401, nothing written)', async () => {
    for (const path of [RENEW, REVOKE]) {
      const r = await srv.call('POST', path, bearer(KEY_ALL));
      expect(r.status).toBe(401);
      expect(JSON.parse(r.body).code).toBe('unauthenticated');
    }
    expect(t.calls).toEqual([]);
  });

  it('refuses a Bearer key at a cookie-only route before the handler runs (401, handler not called)', async () => {
    let called = 0;
    const probe: ApiRoute = {
      method: 'POST',
      pattern: /^\/probe$/,
      scope: 'manage',
      write: true,
      cookieOnly: true,
      async handler(ctx) {
        called += 1;
        ctx.res.writeHead(200);
        ctx.res.end();
      },
    };
    const ps = await serve(baseDeps({ routes: [probe] }));
    try {
      const r = await ps.call('POST', '/api/v1/probe', bearer(KEY_ALL));
      expect(r.status).toBe(401);
      expect(JSON.parse(r.body).code).toBe('unauthenticated');
      expect(called).toBe(0);
    } finally {
      await ps.stop();
    }
  });

  it('refuses a cookie write without the CSRF token, or with a wrong one (403, nothing written)', async () => {
    const none = await srv.call('POST', RENEW, { cookie: cookie.cookie });
    expect(none.status).toBe(403);
    expect(JSON.parse(none.body).code).toBe('csrf_required');
    const wrong = await srv.call('POST', REVOKE, { ...cookie, 'x-csrf-token': `${CSRF}x` });
    expect(wrong.status).toBe(403);
    expect(JSON.parse(wrong.body).code).toBe('csrf_required');
    expect(t.calls).toEqual([]);
  });

  it("answers 404 for another owner's agent and for a missing one, byte-equal, writing nothing", async () => {
    const foreign = await srv.call('POST', '/api/v1/agents/p2/tokens', cookie);
    const missing = await srv.call('POST', '/api/v1/agents/p9/tokens', cookie);
    expect(foreign.status).toBe(404);
    expect(foreign.body).toBe(missing.body);
    const revoke = await srv.call('POST', '/api/v1/agents/p2/tokens/revoke', cookie);
    expect(revoke.status).toBe(404);
    expect(t.calls).toEqual([]);
  });

  it('renews with a 201 token shown once, no-store, and the secret never reaches an audit row', async () => {
    const r = await srv.call('POST', RENEW, cookie);
    expect(r.status).toBe(201);
    expect(r.cacheControl).toBe('no-store');
    const body = JSON.parse(r.body) as { token: string; expiresAt: string };
    expect(body.token).toMatch(/^gmcp-[0-9a-f]{64}$/);
    expect(Date.parse(body.expiresAt)).toBe(90 * 24 * 3600 * 1000);
    expect(t.state.current).toBe(NEW);
    expect(JSON.stringify(t.audits)).not.toContain(NEW);
  });

  it('holds the rotated token for the session onboarding page with a Link to it, taken once', async () => {
    const handoff = new OnboardingHandoff();
    const hs = await serve(
      baseDeps({
        tokens: fakeTokens().deps(
          () => 0,
          async () => false,
        ),
        handoff,
      }),
    );
    try {
      const r = await hs.call('POST', RENEW, cookie);
      expect(r.status).toBe(201);
      expect(r.link).toBe('</register/onboarding>; rel="next"');
      const key = sessionHash(SID).toString('hex');
      expect(handoff.take(key, 0)?.token).toBe((JSON.parse(r.body) as { token: string }).token);
      expect(handoff.take(key, 0)).toBeNull();
    } finally {
      await hs.stop();
    }
  });

  it('sends no Link and holds nothing when no onboarding slot is wired', async () => {
    const hs = await serve(
      baseDeps({
        tokens: fakeTokens().deps(
          () => 0,
          async () => false,
        ),
      }),
    );
    try {
      const r = await hs.call('POST', RENEW, cookie);
      expect(r.status).toBe(201);
      expect(r.link).toBeNull();
    } finally {
      await hs.stop();
    }
  });

  it('revokes with 204 and the token is refused afterwards by the store', async () => {
    const r = await srv.call('POST', REVOKE, cookie);
    expect(r.status).toBe(204);
    expect(t.state.revoked).toBe(true);
    expect(t.calls).toContain('revoke');
  });

  it('answers 500 internal when the store fails, and the previous token still works', async () => {
    const f = fakeTokens({ failRenew: true });
    const srv2 = await serve(
      baseDeps({
        tokens: f.deps(
          () => 0,
          async () => false,
        ),
      }),
    );
    try {
      const r = await srv2.call('POST', RENEW, cookie);
      expect(r.status).toBe(500);
      expect(JSON.parse(r.body).code).toBe('internal');
      expect(f.state.current).toBe(OLD);
    } finally {
      await srv2.stop();
    }
  });

  it('limits the second renewal with 429 and Retry-After; an admin is never limited', async () => {
    let n = 0;
    const lim = fakeTokens();
    const srv3 = await serve(
      baseDeps({
        tokens: lim.deps(
          () => 0,
          async () => false,
        ),
        charge: () => (n++ === 0 ? 0 : 30),
      }),
    );
    try {
      expect((await srv3.call('POST', RENEW, cookie)).status).toBe(201);
      const second = await srv3.call('POST', RENEW, cookie);
      expect(second.status).toBe(429);
      expect(second.retryAfter).toBe('30');
      expect(lim.calls).toHaveLength(1);
    } finally {
      await srv3.stop();
    }
    const adm = fakeTokens();
    const srv4 = await serve(
      baseDeps({
        tokens: adm.deps(
          () => 30,
          async () => true,
        ),
        isAdmin: async () => true,
        charge: () => 30,
      }),
    );
    try {
      expect((await srv4.call('POST', RENEW, cookie)).status).toBe(201);
      expect((await srv4.call('POST', RENEW, cookie)).status).toBe(201);
    } finally {
      await srv4.stop();
    }
  });
});
