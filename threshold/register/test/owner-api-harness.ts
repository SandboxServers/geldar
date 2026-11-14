import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { csrfFor } from '../src/api/auth.ts';
import { handleApi } from '../src/api/index.ts';
import type { ApiDeps } from '../src/api/route.ts';
import { sendProblem } from '../src/problem.ts';
import type { SessionStore } from '../src/session-store.ts';
import { sessionHash } from '../src/session-store.ts';

/** Shared fixtures for the cookie-session route tests (C7-04b-4). */
export const hash = (v: string): Buffer => createHash('sha256').update(v).digest();
export const KEY_ALL = `gowner-${'a1'.repeat(32)}`; // alice, read body manage (a Bearer key)
export const SID = 'sid-alice';
export const IDENT = 'cd'.repeat(32);
export const CSRF = csrfFor('session-key', SID);
export const bearer = (k: string) => ({ authorization: `Bearer ${k}` });
export const cookie = { cookie: `gr_session=${SID}`, 'x-csrf-token': CSRF };

export const sessions: SessionStore = {
  create: async () => undefined,
  touch: async (h) =>
    h.equals(sessionHash(SID))
      ? {
          sessionHash: h,
          ownerId: 'alice',
          identityHash: IDENT,
          signedInMs: 0,
          lastSeenMs: 0,
          expiresMs: 1e15,
        }
      : null,
  delete: async () => undefined,
  sweep: async () => undefined,
};

/** The base deps: alice owns agent p1 only; p2 and p9 are not alice's (p9 does not exist). */
export function baseDeps(extra: Partial<ApiDeps> = {}): ApiDeps {
  return {
    now: () => 0,
    csrfKey: 'session-key',
    sessions,
    ownerKeys: {
      hash,
      store: {
        resolve: async (h) =>
          h.equals(hash(KEY_ALL)) ? { ownerId: 'alice', scopes: ['read', 'body', 'manage'] } : null,
        mint: async () => null,
        revoke: async () => null,
        list: async () => null,
      },
    },
    agents: async (owner, player) =>
      player === 'p1' && owner === 'alice' ? { ownerId: 'alice', playerId: 'p1' } : null,
    audit: async () => undefined,
    isAdmin: async () => false,
    charge: () => 0,
    ...extra,
  };
}

export interface Reply {
  status: number;
  type: string;
  retryAfter: string | null;
  cacheControl: string | null;
  link: string | null;
  body: string;
}

/** Starts a server over handleApi on a random loopback port. */
export async function serve(deps: ApiDeps) {
  const server: Server = createServer((req, res) => {
    void handleApi(req, res, new URL(req.url ?? '/', 'http://local'), deps).then((handled) => {
      if (!handled) sendProblem(res, 'not_found');
    });
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', () => ok()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    call: (
      method: string,
      path: string,
      headers: Record<string, string> = {},
      body?: string,
    ): Promise<Reply> =>
      fetch(`${base}${path}`, { method, headers, body }).then(async (r) => ({
        status: r.status,
        type: r.headers.get('content-type') ?? '',
        retryAfter: r.headers.get('retry-after'),
        cacheControl: r.headers.get('cache-control'),
        link: r.headers.get('link'),
        body: await r.text(),
      })),
    stop: () => new Promise<void>((ok) => server.close(() => ok())),
  };
}
