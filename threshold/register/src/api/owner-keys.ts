import type { IncomingMessage } from 'node:http';
import { KeyDbRefusal } from '../owner-keys-pg.ts';
import {
  listOwnerKeysBySession,
  mintOwnerKeyBySession,
  type OwnerKeyResult,
  revokeOwnerKeyBySession,
  type SessionKeyDeps,
} from '../owner-keys-service.ts';
import { SECURITY_HEADERS } from '../pages.ts';
import { type ProblemCode, sendProblem } from '../problem.ts';
import type { ApiContext, ApiRoute } from './route.ts';

const MAX_BODY = 4096;

/** The session services with the router's owner window and admin flag (index.ts charges the window once). */
function sessionDeps(ctx: ApiContext): { deps: SessionKeyDeps; identity: Buffer } | null {
  const deps = ctx.deps.ownerKeySessions;
  if (!deps) throw new Error('owner key services are not wired');
  if (ctx.identityHash === null) return null;
  return {
    deps: { ...deps, charge: () => 0, isAdmin: async () => ctx.admin },
    identity: Buffer.from(ctx.identityHash, 'hex'),
  };
}

/** A refused or limited outcome that changed nothing. The success outcomes are written by each route. */
function sendRefusal(ctx: ApiContext, result: OwnerKeyResult): void {
  if (result.status === 'limited') {
    sendProblem(ctx.res, 'rate_limited', { 'retry-after': String(result.retryAfter) });
    return;
  }
  const codes: Partial<Record<OwnerKeyResult['status'], ProblemCode>> = {
    refused: 'unauthenticated',
    bad_scopes: 'invalid',
    not_found: 'not_found',
    scope_missing: 'scope_missing',
  };
  sendProblem(ctx.res, codes[result.status] ?? 'internal');
}

/**
 * A SQLSTATE refusal from the database: 42501 (a scope escalation or a missing scope) is 403 scope_missing,
 * 53400 (the live key cap) is 409 conflict. Any other error is not ours and is rethrown (500 internal).
 */
function sendDbRefusal(ctx: ApiContext, error: unknown): void {
  if (!(error instanceof KeyDbRefusal)) throw error;
  sendProblem(ctx.res, error.code === 'scope_missing' ? 'scope_missing' : 'conflict');
}

/** The mint body `{"scopes": [...]}`. Null for anything else (422 invalid, nothing written). */
async function readScopes(req: IncomingMessage): Promise<string[] | null> {
  let text = '';
  for await (const chunk of req) {
    text += String(chunk);
    if (text.length > MAX_BODY) return null;
  }
  try {
    const parsed = JSON.parse(text) as { scopes?: unknown } | null;
    const scopes = parsed?.scopes;
    return Array.isArray(scopes) && scopes.every((s) => typeof s === 'string') ? scopes : null;
  } catch {
    return null;
  }
}

/**
 * Owner key routes (C7-04b, decision 0173). Cookie session only: a Bearer owner key is refused 401 before
 * the scope check. The key value is shown once (mint) and is never in a list; every key response is no-store.
 */
export const ownerKeyRoutes: readonly ApiRoute[] = [
  {
    method: 'GET',
    pattern: /^\/owner-keys$/,
    scope: 'manage',
    write: false,
    cookieOnly: true,
    async handler(ctx) {
      const session = sessionDeps(ctx);
      if (session === null) return sendProblem(ctx.res, 'unauthenticated');
      let result: OwnerKeyResult;
      try {
        result = await listOwnerKeysBySession(session.deps, session.identity);
      } catch (error) {
        return sendDbRefusal(ctx, error);
      }
      if (result.status !== 'listed') return sendRefusal(ctx, result);
      const meta = result.keys.map((k) => ({
        keyId: k.keyId,
        scopes: k.scopes,
        createdAt: k.createdAt.toISOString(),
        expiresAt: k.expiresAt.toISOString(),
        lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
      }));
      ctx.res.writeHead(200, {
        'content-type': 'application/json',
        'cache-control': 'no-store',
        ...SECURITY_HEADERS,
      });
      ctx.res.end(JSON.stringify(meta));
    },
  },
  {
    method: 'POST',
    pattern: /^\/owner-keys$/,
    scope: 'manage',
    write: true,
    cookieOnly: true,
    async handler(ctx) {
      const session = sessionDeps(ctx);
      if (session === null) return sendProblem(ctx.res, 'unauthenticated');
      const scopes = await readScopes(ctx.req);
      if (scopes === null) return sendProblem(ctx.res, 'invalid');
      let result: OwnerKeyResult;
      try {
        result = await mintOwnerKeyBySession(session.deps, session.identity, scopes);
      } catch (error) {
        return sendDbRefusal(ctx, error);
      }
      if (result.status !== 'minted') return sendRefusal(ctx, result);
      ctx.res.writeHead(201, {
        'content-type': 'application/json',
        'cache-control': 'no-store',
        ...SECURITY_HEADERS,
      });
      ctx.res.end(
        JSON.stringify({
          keyId: result.keyId,
          key: result.value,
          scopes: result.scopes,
          expiresAt: result.expiresAt.toISOString(),
        }),
      );
    },
  },
  {
    method: 'POST',
    pattern: /^\/owner-keys\/([^/]+)\/revoke$/,
    scope: 'manage',
    write: true,
    cookieOnly: true,
    async handler(ctx) {
      const session = sessionDeps(ctx);
      if (session === null) return sendProblem(ctx.res, 'unauthenticated');
      let result: OwnerKeyResult;
      try {
        result = await revokeOwnerKeyBySession(session.deps, session.identity, ctx.params[0] ?? '');
      } catch (error) {
        return sendDbRefusal(ctx, error);
      }
      if (result.status !== 'revoked') return sendRefusal(ctx, result);
      ctx.res.writeHead(204, { 'cache-control': 'no-store', ...SECURITY_HEADERS });
      ctx.res.end();
    },
  },
];
