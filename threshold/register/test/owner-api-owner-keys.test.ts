import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { KeyDbRefusal } from '../src/owner-keys-pg.ts';
import type { SessionKeyDeps } from '../src/owner-keys-service.ts';
import {
  baseDeps,
  bearer,
  CSRF,
  cookie,
  hash,
  IDENT,
  KEY_ALL,
  serve,
} from './owner-api-harness.ts';

interface Row {
  keyId: string;
  owner: string;
  scopes: string[];
  createdAt: Date;
  expiresAt: Date;
  revoked: boolean;
  keyHash: Buffer;
}

/** A fake session key store: rows keyed by key id, the live cap counted per owner (the SQL does it in 0035). */
function fakeKeys(opts: { cap?: number; mintError?: unknown } = {}) {
  const rows = new Map<string, Row>();
  const writes: string[] = [];
  let seq = 0;
  const live = (owner: string) => [...rows.values()].filter((r) => r.owner === owner && !r.revoked);
  const session: SessionKeyDeps['session'] = {
    mintBySession: async (_identity, keyId, keyHash, scopes) => {
      writes.push('mint');
      if (opts.mintError) throw opts.mintError;
      if (live('alice').length >= (opts.cap ?? 10)) throw new KeyDbRefusal('conflict', '53400');
      const expiresAt = new Date(90 * 24 * 3600 * 1000);
      rows.set(keyId, {
        keyId,
        owner: 'alice',
        scopes,
        createdAt: new Date(0),
        expiresAt,
        revoked: false,
        keyHash,
      });
      return expiresAt;
    },
    revokeBySession: async (_identity, keyId) => {
      writes.push('revoke');
      const r = rows.get(keyId);
      if (r === undefined || r.owner !== 'alice' || r.revoked) return false;
      r.revoked = true;
      return true;
    },
    listBySession: async () =>
      live('alice').map((r) => ({
        keyId: r.keyId,
        scopes: r.scopes,
        createdAt: r.createdAt,
        expiresAt: r.expiresAt,
        revokedAt: null,
        lastUsedAt: null,
      })),
  };
  const deps = (extra: Partial<SessionKeyDeps> = {}): SessionKeyDeps => ({
    session,
    resolveOwner: async (id) =>
      id.equals(Buffer.from(IDENT, 'hex')) ? { ownerId: 'alice', banned: false } : null,
    isAdmin: async () => false,
    charge: () => 0,
    hash,
    issue: () => {
      seq += 1;
      return { keyId: `k${seq}`, value: `gowner-${seq.toString(16).padStart(64, '0')}` };
    },
    audit: async () => undefined,
    now: () => new Date(0),
    ...extra,
  });
  return { rows, writes, deps };
}

const KEYS = '/api/v1/owner-keys';
const JSON_TYPE = { 'content-type': 'application/json' };
const scopesBody = (scopes: unknown) => JSON.stringify({ scopes });

describe('owner API owner-key routes (C7-04b)', () => {
  const keys = fakeKeys();
  let srv: Awaited<ReturnType<typeof serve>>;
  let minted = '';
  beforeAll(async () => {
    srv = await serve(baseDeps({ ownerKeySessions: keys.deps() }));
  });
  afterAll(() => srv.stop());

  it('answers 401 without credentials on all three routes and writes nothing', async () => {
    for (const [method, path] of [
      ['GET', KEYS],
      ['POST', KEYS],
      ['POST', `${KEYS}/k1/revoke`],
    ] as const) {
      const r = await srv.call(method, path);
      expect(r.status).toBe(401);
      expect(JSON.parse(r.body).code).toBe('unauthenticated');
    }
    expect(keys.writes).toEqual([]);
  });

  it('refuses a Bearer key with every scope on all three routes (401, nothing written)', async () => {
    for (const [method, path] of [
      ['GET', KEYS],
      ['POST', KEYS],
      ['POST', `${KEYS}/k1/revoke`],
    ] as const) {
      const body = method === 'GET' ? undefined : scopesBody(['read']);
      const r = await srv.call(method, path, bearer(KEY_ALL), body);
      expect(r.status).toBe(401);
      expect(JSON.parse(r.body).code).toBe('unauthenticated');
    }
    expect(keys.writes).toEqual([]);
  });

  it('refuses a cookie write without the CSRF token or with a wrong one (403, nothing written)', async () => {
    const none = await srv.call(
      'POST',
      KEYS,
      { cookie: cookie.cookie, ...JSON_TYPE },
      scopesBody(['read']),
    );
    expect(none.status).toBe(403);
    expect(JSON.parse(none.body).code).toBe('csrf_required');
    const wrong = await srv.call('POST', `${KEYS}/k1/revoke`, {
      ...cookie,
      'x-csrf-token': `${CSRF}x`,
    });
    expect(wrong.status).toBe(403);
    expect(keys.writes).toEqual([]);
  });

  it('mints one gowner- key with 201, no-store, and the requested scopes', async () => {
    const r = await srv.call(
      'POST',
      KEYS,
      { ...cookie, ...JSON_TYPE },
      scopesBody(['read', 'body']),
    );
    expect(r.status).toBe(201);
    expect(r.cacheControl).toBe('no-store');
    const body = JSON.parse(r.body) as { keyId: string; key: string; scopes: string[] };
    expect(body.key).toMatch(/^gowner-[0-9a-f]{64}$/);
    expect(body.scopes).toEqual(['read', 'body']);
    minted = body.keyId;
  });

  it('lists the key without its value, and a second list never shows it (show once)', async () => {
    for (let i = 0; i < 2; i += 1) {
      const r = await srv.call('GET', KEYS, cookie);
      expect(r.status).toBe(200);
      expect(r.cacheControl).toBe('no-store');
      expect(r.body).not.toContain('gowner-');
      expect(JSON.parse(r.body).map((k: { keyId: string }) => k.keyId)).toContain(minted);
    }
  });

  it('refuses a scope outside read, body, manage and a non-JSON body with 422, writing nothing', async () => {
    const before = keys.writes.length;
    const bad = await srv.call('POST', KEYS, { ...cookie, ...JSON_TYPE }, scopesBody(['admin']));
    expect(bad.status).toBe(422);
    expect(JSON.parse(bad.body).code).toBe('invalid');
    const junk = await srv.call('POST', KEYS, { ...cookie, ...JSON_TYPE }, 'not json');
    expect(junk.status).toBe(422);
    expect(keys.writes.length).toBe(before);
  });

  it('revokes own key with 204; a key of another owner is 404 and stays live', async () => {
    const r = await srv.call('POST', `${KEYS}/${minted}/revoke`, cookie);
    expect(r.status).toBe(204);
    const listed = await srv.call('GET', KEYS, cookie);
    expect(listed.body).not.toContain(minted);
    keys.rows.set('kb', {
      keyId: 'kb',
      owner: 'bob',
      scopes: ['read'],
      createdAt: new Date(0),
      expiresAt: new Date(0),
      revoked: false,
      keyHash: Buffer.alloc(32),
    });
    const foreign = await srv.call('POST', `${KEYS}/kb/revoke`, cookie);
    expect(foreign.status).toBe(404);
    expect(keys.rows.get('kb')?.revoked).toBe(false);
  });

  it('allows the 10th live key and refuses the 11th with 409 conflict, leaving no row', async () => {
    const capped = fakeKeys({ cap: 10 });
    const s2 = await serve(baseDeps({ ownerKeySessions: capped.deps() }));
    try {
      for (let i = 0; i < 10; i += 1) {
        expect(
          (await s2.call('POST', KEYS, { ...cookie, ...JSON_TYPE }, scopesBody(['read']))).status,
        ).toBe(201);
      }
      const eleventh = await s2.call(
        'POST',
        KEYS,
        { ...cookie, ...JSON_TYPE },
        scopesBody(['read']),
      );
      expect(eleventh.status).toBe(409);
      expect(JSON.parse(eleventh.body).code).toBe('conflict');
      expect([...capped.rows.values()].filter((r) => !r.revoked)).toHaveLength(10);
    } finally {
      await s2.stop();
    }
  });

  it('maps SQLSTATE 42501 to 403 scope_missing and writes no key', async () => {
    const denied = fakeKeys({ mintError: new KeyDbRefusal('scope_missing', '42501') });
    const s3 = await serve(baseDeps({ ownerKeySessions: denied.deps() }));
    try {
      const r = await s3.call('POST', KEYS, { ...cookie, ...JSON_TYPE }, scopesBody(['read']));
      expect(r.status).toBe(403);
      expect(JSON.parse(r.body).code).toBe('scope_missing');
      expect(denied.rows.size).toBe(0);
    } finally {
      await s3.stop();
    }
  });

  it('refuses an unknown identity on the list with 401, never an empty list', async () => {
    const k = fakeKeys();
    const deps = k.deps({ resolveOwner: async () => null });
    const s4 = await serve(baseDeps({ ownerKeySessions: deps }));
    try {
      const r = await s4.call('GET', KEYS, cookie);
      expect(r.status).toBe(401);
      expect(JSON.parse(r.body).code).toBe('unauthenticated');
    } finally {
      await s4.stop();
    }
  });

  it('limits the second mint with 429 and Retry-After; an admin is never limited', async () => {
    let n = 0;
    const lim = fakeKeys();
    const s5 = await serve(
      baseDeps({ ownerKeySessions: lim.deps(), charge: () => (n++ === 0 ? 0 : 30) }),
    );
    try {
      expect(
        (await s5.call('POST', KEYS, { ...cookie, ...JSON_TYPE }, scopesBody(['read']))).status,
      ).toBe(201);
      const second = await s5.call('POST', KEYS, { ...cookie, ...JSON_TYPE }, scopesBody(['read']));
      expect(second.status).toBe(429);
      expect(second.retryAfter).toBe('30');
      expect(lim.writes).toEqual(['mint']);
    } finally {
      await s5.stop();
    }
    const adm = fakeKeys();
    const s6 = await serve(
      baseDeps({ ownerKeySessions: adm.deps(), isAdmin: async () => true, charge: () => 30 }),
    );
    try {
      expect(
        (await s6.call('POST', KEYS, { ...cookie, ...JSON_TYPE }, scopesBody(['read']))).status,
      ).toBe(201);
      expect(
        (await s6.call('POST', KEYS, { ...cookie, ...JSON_TYPE }, scopesBody(['read']))).status,
      ).toBe(201);
    } finally {
      await s6.stop();
    }
  });
});
