import { randomUUID } from 'node:crypto';
import { BodyUnavailable, MalformedReply, requestBodyOp } from '../nats-ctl.ts';
import { SECURITY_HEADERS } from '../pages.ts';
import { sendProblem } from '../problem.ts';
import {
  revokePlayerTokens,
  type TokenActor,
  type TokenDeps,
  type TokenResult,
} from '../tokens-service.ts';
import { type BodyDeps, UNAVAILABLE_RETRY_SECONDS } from './body.ts';
import type { BodySlot } from './body-slot.ts';
import { ownedAgent } from './guard.ts';
import type { ApiContext, ApiRoute } from './route.ts';

/** The retire deps: the body link of C7-04c, the slot of C7-04c2 (required, never a copy), and the database retire. */
export interface BodyRetireDeps extends Omit<BodyDeps, 'slot'> {
  readonly slot: BodySlot;
  /** PgStore.retirePlayer: false when the player is not the owner's or is not live (the database checks the owner). */
  readonly retirePlayer: (identityHash: string, playerId: string) => Promise<boolean>;
}

/** The same display-name rule as the body routes (body.ts): the Minecraft player name, 3 to 16 characters. */
export const LOGIN_NAME = /^[A-Za-z0-9_]{3,16}$/;
const LOGIN_NAME_DETAIL = "The player's name must be 3 to 16 letters, digits or underscore.";

/**
 * The token service runs with the router's owner window and admin flag, and the window is charged once by the
 * router (the same rule as tokens.ts), so the service's own charge is a no-op here.
 */
function serviceDeps(ctx: ApiContext): TokenDeps {
  const deps = ctx.deps.tokens;
  if (!deps) throw new Error('token services are not wired');
  return { ...deps, charge: () => 0, isAdmin: async () => ctx.admin };
}

/**
 * The stop through the supervisor. `stopped` continues, and so does `unknown`: the supervisor has no body of this owner
 * under that name, so there is nothing to stop and the retire may go on. A timeout, no responders, an unreadable reply or
 * any other refusal (busy, error) is 503 body_unavailable with Retry-After, and the agent is not retired. Returns true when
 * the retire may continue; otherwise the answer is sent.
 */
/** The body link and slot a stop needs (C7-09a shares it with the account delete). */
export type BodyStopLink = Pick<BodyRetireDeps, 'conn' | 'shard' | 'timeoutMs' | 'slot'>;

/**
 * The stop of one player's body with no response written (C7-09a): true when the stop is `stopped` or `unknown`, false on
 * a timeout, no responders, an unreadable reply or any other refusal. A non-timeout throw is rethrown.
 */
export async function stopPlayerBody(
  link: BodyStopLink,
  ownerId: string,
  playerName: string,
): Promise<boolean> {
  let reply: { ok: boolean; code: string };
  try {
    reply = await requestBodyOp(
      link.conn,
      'stop',
      link.shard,
      { ownerId, playerName },
      { timeoutMs: link.timeoutMs },
    );
  } catch (error) {
    if (error instanceof BodyUnavailable || error instanceof MalformedReply) return false;
    throw error;
  }
  return (reply.ok && reply.code === 'stopped') || (!reply.ok && reply.code === 'unknown');
}

export async function stopBody(
  ctx: ApiContext,
  deps: BodyRetireDeps,
  playerName: string,
): Promise<boolean> {
  if (await stopPlayerBody(deps, ctx.ownerId, playerName)) return true;
  sendProblem(ctx.res, 'body_unavailable', { 'retry-after': String(UNAVAILABLE_RETRY_SECONDS) });
  return false;
}

/** The refusal of a token revoke that changed nothing: a limit (429 with Retry-After) or not found. */
function sendRevokeRefusal(ctx: ApiContext, result: TokenResult): void {
  if (result.status === 'limited') {
    sendProblem(ctx.res, 'rate_limited', { 'retry-after': String(result.retryAfter) });
    return;
  }
  sendProblem(ctx.res, 'not_found');
}

/**
 * POST /agents/{playerId}/retire (C7-04d). Cookie session only with CSRF (decision 0173). Order: stop the body through
 * the supervisor, revoke the agent's tokens through the token service, then retire the player. 202 BodyOp on success.
 * A foreign, missing or retired agent is 404 before any supervisor call. A display name outside the player-name shape
 * is 422 before any supervisor call. The owner's body slot (shared with the body routes) is held for the whole run, so
 * a retire and a stop cannot both reach the supervisor (409 conflict). A failure after the stop leaves the agent not
 * retired, and a retry is safe.
 */
export function bodyRetireRoutes(deps: BodyRetireDeps): readonly ApiRoute[] {
  return [
    {
      method: 'POST',
      pattern: /^\/agents\/([^/]+)\/retire$/,
      scope: 'manage',
      write: true,
      cookieOnly: true,
      async handler(ctx) {
        const playerId = ctx.params[0] ?? '';
        const agent = await ownedAgent(ctx.deps, ctx.ownerId, playerId);
        if (agent === null || agent.status === 'retired') {
          return sendProblem(ctx.res, 'not_found');
        }
        const name = agent.displayName;
        if (typeof name !== 'string' || !LOGIN_NAME.test(name)) {
          return sendProblem(ctx.res, 'invalid', {}, LOGIN_NAME_DETAIL);
        }
        const identityHash = ctx.identityHash;
        if (identityHash === null) return sendProblem(ctx.res, 'unauthenticated');
        const actor: TokenActor = { identityHash, ownerId: ctx.ownerId };
        const svc = serviceDeps(ctx);
        if (deps.slot.has(ctx.ownerId)) return sendProblem(ctx.res, 'conflict');
        deps.slot.add(ctx.ownerId);
        try {
          if (!(await stopBody(ctx, deps, name))) return;
          const revoked = await revokePlayerTokens(svc, actor, playerId);
          if (revoked.status !== 'revoked') return sendRevokeRefusal(ctx, revoked);
          if (!(await deps.retirePlayer(identityHash, playerId))) {
            return sendProblem(ctx.res, 'not_found');
          }
        } finally {
          deps.slot.delete(ctx.ownerId);
        }
        ctx.res.writeHead(202, {
          'content-type': 'application/json',
          'cache-control': 'no-store',
          ...SECURITY_HEADERS,
        });
        ctx.res.end(JSON.stringify({ opId: randomUUID(), state: 'done' }));
      },
    },
  ];
}
