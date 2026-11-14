import { SECURITY_HEADERS } from '../pages.ts';
import { sendProblem } from '../problem.ts';
import {
  renewPlayerToken,
  revokePlayerTokens,
  type TokenActor,
  type TokenDeps,
  type TokenResult,
} from '../tokens-service.ts';
import { ownedAgent } from './guard.ts';
import type { ApiContext, ApiRoute } from './route.ts';

/**
 * The token services run with the router's owner window and admin flag. index.ts charges the window once
 * for every write, so the service's own charge is a no-op here (one charge per request, not two).
 */
function serviceDeps(ctx: ApiContext): TokenDeps {
  const deps = ctx.deps.tokens;
  if (!deps) throw new Error('token services are not wired');
  return { ...deps, charge: () => 0, isAdmin: async () => ctx.admin };
}

function actorOf(ctx: ApiContext): TokenActor | null {
  if (ctx.identityHash === null) return null;
  return { identityHash: ctx.identityHash, ownerId: ctx.ownerId };
}

/** The onboarding page's path (C7-05). The Link names it only when the token is held for that page. */
const ONBOARDING_LINK = { link: '</register/onboarding>; rel="next"' };

/**
 * Holds a rotated token in the session's onboarding slot (the account page's OnboardingHandoff: one slot per
 * session, taken once) and returns the Link header. With no slot wired or no cookie session nothing is held
 * and no Link is sent.
 */
function holdForOnboarding(
  ctx: ApiContext,
  playerId: string,
  token: string,
  expiresAt: Date,
): Record<string, string> {
  const { handoff } = ctx.deps;
  if (!handoff || ctx.sessionKey === null) return {};
  handoff.put(ctx.sessionKey, { playerId, token, expiresAt }, ctx.deps.now());
  return ONBOARDING_LINK;
}

/** The refusal of a token action that changed nothing: a limit (429 with Retry-After) or not found. */
function sendRefusal(ctx: ApiContext, result: TokenResult): void {
  if (result.status === 'limited') {
    sendProblem(ctx.res, 'rate_limited', { 'retry-after': String(result.retryAfter) });
    return;
  }
  sendProblem(ctx.res, 'not_found');
}

/**
 * Player token routes (C7-04b). Cookie session only (decision 0173). A foreign or missing agent is the
 * same 404 (the guard), before any token is made. The new token is shown once and never logged or stored
 * in an audit row; the response is no-store.
 */
export const tokenRoutes: readonly ApiRoute[] = [
  {
    method: 'POST',
    pattern: /^\/agents\/([^/]+)\/tokens$/,
    scope: 'manage',
    write: true,
    cookieOnly: true,
    async handler(ctx) {
      const actor = actorOf(ctx);
      if (actor === null) return sendProblem(ctx.res, 'unauthenticated');
      const playerId = ctx.params[0] ?? '';
      if ((await ownedAgent(ctx.deps, ctx.ownerId, playerId)) === null) {
        return sendProblem(ctx.res, 'not_found');
      }
      const result = await renewPlayerToken(serviceDeps(ctx), actor, playerId);
      if (result.status !== 'renewed') return sendRefusal(ctx, result);
      const link = holdForOnboarding(ctx, playerId, result.secret, result.expiresAt);
      ctx.res.writeHead(201, {
        'content-type': 'application/json',
        'cache-control': 'no-store',
        ...SECURITY_HEADERS,
        ...link,
      });
      ctx.res.end(
        JSON.stringify({ token: result.secret, expiresAt: result.expiresAt.toISOString() }),
      );
    },
  },
  {
    method: 'POST',
    pattern: /^\/agents\/([^/]+)\/tokens\/revoke$/,
    scope: 'manage',
    write: true,
    cookieOnly: true,
    async handler(ctx) {
      const actor = actorOf(ctx);
      if (actor === null) return sendProblem(ctx.res, 'unauthenticated');
      const playerId = ctx.params[0] ?? '';
      if ((await ownedAgent(ctx.deps, ctx.ownerId, playerId)) === null) {
        return sendProblem(ctx.res, 'not_found');
      }
      const result = await revokePlayerTokens(serviceDeps(ctx), actor, playerId);
      if (result.status !== 'revoked') return sendRefusal(ctx, result);
      ctx.res.writeHead(204, { 'cache-control': 'no-store', ...SECURITY_HEADERS });
      ctx.res.end();
    },
  },
];
