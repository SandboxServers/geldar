import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { csrfFor } from '../src/api/auth.ts';
import { handleApi } from '../src/api/index.ts';
import type { ApiDeps, ApiRoute } from '../src/api/route.ts';
import { PROBLEM_CODES, sendProblem } from '../src/problem.ts';
import type { SessionStore } from '../src/session-store.ts';
import { sessionHash } from '../src/session-store.ts';

const hash = (v: string): Buffer => createHash('sha256').update(v).digest();
const KEY_ALL = `gowner-${'a1'.repeat(32)}`; // alice, read body manage
const KEY_BODY = `gowner-${'b1'.repeat(32)}`; // bob, body only
const KEY_BANNED = `gowner-${'c1'.repeat(32)}`; // resolve refuses (not in the table)
const OWNERS = new Map<string, { ownerId: string; scopes: string[] }>([
  [hash(KEY_ALL).toString('hex'), { ownerId: 'alice', scopes: ['read', 'body', 'manage'] }],
  [hash(KEY_BODY).toString('hex'), { ownerId: 'bob', scopes: ['body'] }],
]);
const SID = 'sid-alice';
const CSRF = csrfFor('session-key', SID);

const session: SessionStore = {
  create: async () => undefined,
  touch: async (h) =>
    h.equals(sessionHash(SID))
      ? {
          sessionHash: h,
          ownerId: 'alice',
          identityHash: 'x',
          signedInMs: 0,
          lastSeenMs: 0,
          expiresMs: 1e15,
        }
      : null,
  delete: async () => undefined,
  sweep: async () => undefined,
};

const writeRoute: ApiRoute = {
  method: 'POST',
  pattern: /^\/write$/,
  scope: 'body',
  write: true,
  async handler(ctx) {
    await ctx.audit({ action: 'test.write', target: 'x', outcome: 'ok' });
    ctx.res.writeHead(200, { 'content-type': 'text/plain' });
    ctx.res.end('ok');
  },
};

function harness(extra: Partial<ApiDeps> = {}) {
  const audits: unknown[] = [];
  const lost: unknown[] = [];
  const deps: ApiDeps = {
    now: () => 0,
    csrfKey: 'session-key',
    sessions: session,
    ownerKeys: {
      hash,
      store: {
        resolve: async (h) => OWNERS.get(h.toString('hex')) ?? null,
        mint: async () => null,
        revoke: async () => null,
        list: async () => null,
      },
    },
    agents: async (owner, player) => {
      if (player === 'p1' && owner === 'alice') return { ownerId: 'alice', playerId: 'p1' };
      if (player === 'p2') return { ownerId: 'bob', playerId: 'p2' };
      return null;
    },
    audit: async (e) => {
      audits.push(e);
    },
    onAuditLost: (e) => {
      lost.push(e);
    },
    routes: [writeRoute],
    ...extra,
  };
  let server: Server;
  let base = '';
  return {
    audits,
    lost,
    async start() {
      server = createServer((req, res) => {
        void handleApi(req, res, new URL(req.url ?? '/', 'http://local'), deps).then((handled) => {
          if (!handled) sendProblem(res, 'not_found');
        });
      });
      await new Promise<void>((ok) => server.listen(0, '127.0.0.1', () => ok()));
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    },
    stop: () => new Promise<void>((ok) => server.close(() => ok())),
    call: (method: string, path: string, headers: Record<string, string> = {}) =>
      fetch(`${base}${path}`, { method, headers }).then(async (r) => ({
        status: r.status,
        type: r.headers.get('content-type') ?? '',
        retryAfter: r.headers.get('retry-after'),
        body: await r.text(),
      })),
  };
}

const bearer = (k: string) => ({ authorization: `Bearer ${k}` });
const cookie = { cookie: `gr_session=${SID}`, 'x-csrf-token': CSRF };

describe('owner API route tree (C7-04a)', () => {
  const h = harness();
  beforeAll(() => h.start());
  afterAll(() => h.stop());

  it('answers an unknown path under v1 with a 404 not_found problem', async () => {
    const r = await h.call('GET', '/api/v1/nope', bearer(KEY_ALL));
    expect(r.status).toBe(404);
    expect(r.type).toBe('application/problem+json');
    expect(JSON.parse(r.body).code).toBe('not_found');
  });

  it('leaves a /api/v2 path to the caller, which answers 404', async () => {
    const handled = await handleApi(
      { method: 'GET', headers: {} } as never,
      { headersSent: false } as never,
      new URL('http://local/api/v2/x'),
      { now: () => 0, csrfKey: 'k' },
    );
    expect(handled).toBe(false);
  });

  it('answers 405 for a known path with another method', async () => {
    const r = await h.call('DELETE', '/api/v1/write', bearer(KEY_ALL));
    expect(r.status).toBe(405);
    expect(JSON.parse(r.body).code).toBe('method_not_allowed');
  });
});

describe('owner API credentials and scope (C7-04a)', () => {
  const h = harness();
  beforeAll(() => h.start());
  afterAll(() => h.stop());

  it('answers 401 without credentials', async () => {
    const r = await h.call('GET', '/api/v1/agents/p1');
    expect(r.status).toBe(401);
    expect(JSON.parse(r.body).code).toBe('unauthenticated');
  });

  it('answers 401 for a player token in a Bearer header', async () => {
    const r = await h.call('GET', '/api/v1/agents/p1', bearer(`gmcp-${'a1'.repeat(32)}`));
    expect(r.status).toBe(401);
  });

  it('answers 401 for a banned owner key (the resolve refuses it)', async () => {
    const r = await h.call('GET', '/api/v1/agents/p1', bearer(KEY_BANNED));
    expect(r.status).toBe(401);
  });

  it('answers 403 scope_missing for a body-only key on a read route', async () => {
    const r = await h.call('GET', '/api/v1/agents/p2', bearer(KEY_BODY));
    expect(r.status).toBe(403);
    expect(JSON.parse(r.body).code).toBe('scope_missing');
  });

  it('answers 401 for a session cookie whose session is unknown', async () => {
    const r = await h.call('GET', '/api/v1/agents/p1', { cookie: 'gr_session=unknown' });
    expect(r.status).toBe(401);
  });
});

describe('owner API CSRF (C7-04a)', () => {
  const h = harness();
  beforeAll(() => h.start());
  afterAll(() => h.stop());

  it('refuses a cookie write without the token with 403 csrf_required', async () => {
    const r = await h.call('POST', '/api/v1/write', { cookie: `gr_session=${SID}` });
    expect(r.status).toBe(403);
    expect(JSON.parse(r.body).code).toBe('csrf_required');
  });

  it('refuses a cookie write with a wrong token', async () => {
    const r = await h.call('POST', '/api/v1/write', {
      cookie: `gr_session=${SID}`,
      'x-csrf-token': 'wrong',
    });
    expect(r.status).toBe(403);
    expect(JSON.parse(r.body).code).toBe('csrf_required');
  });

  it('accepts a cookie write with the token', async () => {
    const r = await h.call('POST', '/api/v1/write', cookie);
    expect(r.status).toBe(200);
  });

  it('accepts a Bearer write without any CSRF token', async () => {
    const r = await h.call('POST', '/api/v1/write', bearer(KEY_BODY));
    expect(r.status).toBe(200);
  });
});

describe('owner API ownership (C7-04a)', () => {
  const h = harness();
  beforeAll(() => h.start());
  afterAll(() => h.stop());

  it('answers the same 404 for another owner agent and a missing one', async () => {
    const foreign = await h.call('GET', '/api/v1/agents/p2', bearer(KEY_ALL));
    const missing = await h.call('GET', '/api/v1/agents/p9', bearer(KEY_ALL));
    expect(foreign.status).toBe(404);
    expect(foreign.body).toBe(missing.body);
    expect(foreign.type).toBe(missing.type);
  });

  it('returns the owner own agent', async () => {
    const r = await h.call('GET', '/api/v1/agents/p1', bearer(KEY_ALL));
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body).playerId).toBe('p1');
  });
});

describe('owner API problem bodies (C7-04a)', () => {
  it('produces application/problem+json with a code from the enum on every error path', async () => {
    const h = harness();
    await h.start();
    const paths: Array<[string, string, Record<string, string>]> = [
      ['GET', '/api/v1/nope', bearer(KEY_ALL)],
      ['GET', '/api/v1/agents/p1', {}],
      ['POST', '/api/v1/write', { cookie: `gr_session=${SID}` }],
      ['GET', '/api/v1/agents/p2', bearer(KEY_BODY)],
      ['DELETE', '/api/v1/write', bearer(KEY_ALL)],
    ];
    for (const [method, path, headers] of paths) {
      const r = await h.call(method, path, headers);
      expect(r.type).toBe('application/problem+json');
      expect(PROBLEM_CODES).toContain(JSON.parse(r.body).code);
    }
    await h.stop();
  });
});

describe('owner API admin exemption and owner window (C7-04a)', () => {
  const calls: string[] = [];
  const window = (owner: string) => {
    calls.push(owner);
    return calls.filter((o) => o === owner).length > 2 ? 7 : 0;
  };

  it('lets an admin write past the window and records admin = true; a normal owner gets 429', async () => {
    calls.length = 0;
    const h = harness({
      isAdmin: async (o) => o === 'alice',
      charge: window,
    });
    await h.start();
    for (let i = 0; i < 5; i += 1) {
      expect((await h.call('POST', '/api/v1/write', bearer(KEY_ALL))).status).toBe(200);
    }
    expect(h.audits.at(-1)).toMatchObject({ ownerId: 'alice', admin: true });
    expect((await h.call('POST', '/api/v1/write', bearer(KEY_BODY))).status).toBe(200);
    expect((await h.call('POST', '/api/v1/write', bearer(KEY_BODY))).status).toBe(200);
    const limited = await h.call('POST', '/api/v1/write', bearer(KEY_BODY));
    expect(limited.status).toBe(429);
    expect(limited.retryAfter).toBe('7');
    expect(JSON.parse(limited.body).code).toBe('rate_limited');
    await h.stop();
  });

  it('treats a failing admin lookup as not admin, so the limit applies', async () => {
    calls.length = 0;
    const h = harness({
      isAdmin: async () => {
        throw new Error('db down');
      },
      charge: window,
    });
    await h.start();
    await h.call('POST', '/api/v1/write', bearer(KEY_ALL));
    await h.call('POST', '/api/v1/write', bearer(KEY_ALL));
    expect((await h.call('POST', '/api/v1/write', bearer(KEY_ALL))).status).toBe(429);
    await h.stop();
  });

  it('keeps an admin on the ownership rule: a foreign agent is still 404', async () => {
    const h = harness({ isAdmin: async () => true });
    await h.start();
    expect((await h.call('GET', '/api/v1/agents/p2', bearer(KEY_ALL))).status).toBe(404);
    await h.stop();
  });
});

describe('owner API audit-lost wiring (C7-04a)', () => {
  it('calls onAuditLost once and answers 500 internal when the audit write fails', async () => {
    const h = harness({
      audit: async () => {
        throw new Error('insert failed');
      },
    });
    await h.start();
    const r = await h.call('POST', '/api/v1/write', bearer(KEY_ALL));
    expect(r.status).toBe(500);
    expect(JSON.parse(r.body).code).toBe('internal');
    expect(h.lost).toHaveLength(1);
    expect(h.lost[0]).toMatchObject({ ownerId: 'alice', action: 'test.write', outcome: 'ok' });
    await h.stop();
  });

  it('answers 500 internal and reports the loss when no audit sink is wired', async () => {
    const h = harness({ audit: undefined });
    await h.start();
    expect((await h.call('POST', '/api/v1/write', bearer(KEY_ALL))).status).toBe(500);
    expect(h.lost).toHaveLength(1);
    await h.stop();
  });
});

describe('owner API OpenAPI source (C7-04a)', () => {
  it('lists the same problem codes as problem.ts', () => {
    const text = readFileSync(new URL('../src/api/owner-api-v1.yaml', import.meta.url), 'utf8');
    const line = text.split('\n').find((l) => l.includes('enum: [') && l.includes('not_found'));
    const listed = (line ?? '')
      .replace(/.*enum: \[/, '')
      .replace(/\].*/, '')
      .split(', ');
    expect([...listed].sort()).toEqual([...PROBLEM_CODES].sort());
  });
});
