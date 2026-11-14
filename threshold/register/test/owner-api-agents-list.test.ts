import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { handleApi } from '../src/api/index.ts';
import type { ApiDeps } from '../src/api/route.ts';
import { sendProblem } from '../src/problem.ts';

const hash = (v: string): Buffer => createHash('sha256').update(v).digest();
const KEY_READ = `gowner-${'a1'.repeat(32)}`; // alice: read, body, manage
const KEY_BODY = `gowner-${'b1'.repeat(32)}`; // bob: body only

const KEYS = new Map<string, { ownerId: string; scopes: string[] }>([
  [hash(KEY_READ).toString('hex'), { ownerId: 'alice', scopes: ['read', 'body', 'manage'] }],
  [hash(KEY_BODY).toString('hex'), { ownerId: 'bob', scopes: ['body'] }],
]);

/** Two owners' agents; the stored rows carry a token hash that must never leave the server. */
const ROWS = [
  {
    ownerId: 'alice',
    playerId: 'p1',
    displayName: 'Ada',
    status: 'live',
    tokenHash: 'SECRET-HASH',
  },
  { ownerId: 'bob', playerId: 'p2', displayName: 'Bo', status: 'live', tokenHash: 'OTHER-HASH' },
];

function deps(extra: Partial<ApiDeps> = {}): ApiDeps {
  return {
    now: () => 0,
    csrfKey: 'session-key',
    ownerKeys: {
      hash,
      store: {
        resolve: async (h) => KEYS.get(h.toString('hex')) ?? null,
        mint: async () => null,
        revoke: async () => null,
        list: async () => null,
      },
    },
    // The loader returns every owner's rows, so the route's own owner filter is the guard under test.
    listAgents: async () => ROWS,
    ...extra,
  };
}

function serve(d: ApiDeps): Server {
  return createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://register.test');
    void handleApi(req, res, url, d).then((handled) => {
      if (!handled) sendProblem(res, 'not_found');
    });
  });
}

let server: Server;
let base = '';

beforeAll(async () => {
  server = serve(deps());
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', () => done()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
});

afterAll(async () => {
  await new Promise<void>((done) => server.close(() => done()));
});

const bearer = (key: string) => ({ authorization: `Bearer ${key}` });

describe('GET /api/v1/agents', () => {
  it('lists only the caller agents, and never a token hash', async () => {
    const res = await fetch(`${base}/agents`, { headers: bearer(KEY_READ) });
    expect(res.status).toBe(200);
    const text = await res.text();
    const body = JSON.parse(text) as { agents: { playerId: string }[] };
    expect(body.agents.map((a) => a.playerId)).toEqual(['p1']);
    expect(text).not.toContain('SECRET-HASH');
    expect(text).not.toContain('OTHER-HASH');
  });

  it('answers 401 unauthenticated without credentials', async () => {
    const res = await fetch(`${base}/agents`);
    expect(res.status).toBe(401);
    expect(res.headers.get('content-type')).toBe('application/problem+json');
    expect(await res.json()).toMatchObject({ code: 'unauthenticated', status: 401 });
  });

  it('answers 403 scope_missing for a body-only key (needs read)', async () => {
    const res = await fetch(`${base}/agents`, { headers: bearer(KEY_BODY) });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'scope_missing' });
  });

  it('answers 500 internal, never an empty list, when the list loader is not wired', async () => {
    const bare = serve(deps({ listAgents: undefined }));
    await new Promise<void>((done) => bare.listen(0, '127.0.0.1', () => done()));
    const port = (bare.address() as AddressInfo).port;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/v1/agents`, {
        headers: bearer(KEY_READ),
      });
      expect(res.status).toBe(500);
      expect(await res.json()).toMatchObject({ code: 'internal' });
    } finally {
      await new Promise<void>((done) => bare.close(() => done()));
    }
  });
});
