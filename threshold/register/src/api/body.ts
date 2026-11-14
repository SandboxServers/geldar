import { randomUUID } from 'node:crypto';
import { BodyUnavailable, type CtlConnection, MalformedReply, requestBodyOp } from '../nats-ctl.ts';
import { SECURITY_HEADERS } from '../pages.ts';
import { sendProblem } from '../problem.ts';
import { LOG_MAX_LINES, logTail, parseLogLimit, type SupervisorEvent } from './body-log.ts';
import { ownedAgent } from './guard.ts';
import type { ApiContext, ApiRoute } from './route.ts';

/** The supervisor link the body routes use: the NATS connection, the shard and the reply wait. */
export interface BodyDeps {
  readonly conn: CtlConnection;
  readonly shard: string;
  readonly timeoutMs: number;
}

/** A supervisor reply as the wire carries it (nats-ctl parses ok and code; the log reply adds events). */
interface SupervisorReply {
  ok: boolean;
  code: string;
  events?: SupervisorEvent[];
}

/** The repeat-start window: at most START_WINDOW_MAX start requests per agent in START_WINDOW_MS. */
export const START_WINDOW_MS = 60_000;
export const START_WINDOW_MAX = 5;
/**
 * Retry-After for a quota refusal and for an unreachable body. 3600 is a floor for the quota: the owner-day cap
 * can need up to 24 h, and the reply does not say which cap was hit.
 */
export const QUOTA_RETRY_SECONDS = 3600;
export const UNAVAILABLE_RETRY_SECONDS = 30;

/** The login name the supervisor can use: the Minecraft player name shape, 3 to 16 characters. */
const LOGIN_NAME = /^[A-Za-z0-9_]{3,16}$/;
const LOGIN_NAME_DETAIL = "The player's name must be 3 to 16 letters, digits or underscore.";

function sendJsonBody(
  ctx: ApiContext,
  status: number,
  body: unknown,
  extra: Record<string, string> = {},
): void {
  ctx.res.writeHead(status, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
    ...SECURITY_HEADERS,
    ...extra,
  });
  ctx.res.end(JSON.stringify(body));
}

function unavailable(ctx: ApiContext): void {
  sendProblem(ctx.res, 'body_unavailable', { 'retry-after': String(UNAVAILABLE_RETRY_SECONDS) });
}

/**
 * The reply table (C7-04c). Success codes map to their route answer, refusals to their problem, and any code
 * not in the table (including `error` and `busy`) is 503 body_unavailable. No reply maps to 200 unless listed.
 */
function mapReply(ctx: ApiContext, reply: SupervisorReply, limit: number, now: number): void {
  if (reply.ok) {
    switch (reply.code) {
      case 'started':
      case 'restarted':
      case 'stopped':
        sendJsonBody(ctx, 202, { opId: randomUUID(), state: 'done' });
        return;
      case 'running':
      case 'idle':
        sendJsonBody(ctx, 200, { state: reply.code === 'running' ? 'running' : 'stopped' });
        return;
      case 'logs':
        sendJsonBody(ctx, 200, { lines: logTail(reply.events ?? [], now, limit) });
        return;
      default:
        unavailable(ctx);
        return;
    }
  }
  switch (reply.code) {
    case 'quota':
      sendProblem(ctx.res, 'quota', { 'retry-after': String(QUOTA_RETRY_SECONDS) });
      return;
    case 'unknown':
      sendProblem(ctx.res, 'not_found');
      return;
    case 'login_name':
      // A fixed text: the supervisor's own error text never reaches the owner.
      sendProblem(ctx.res, 'invalid', {}, LOGIN_NAME_DETAIL);
      return;
    case 'invalid':
      sendProblem(ctx.res, 'internal');
      return;
    default:
      unavailable(ctx);
      return;
  }
}

/**
 * The owner's agent as the supervisor's player name. A missing, another owner's or a retired agent is 404 with no
 * supervisor call (the retired check runs before the name check). The supervisor keys a body by the agent's display
 * name (the Minecraft name), never by the `ag-` player id; a display name outside the 3 to 16 player-name shape is
 * 422 with the fixed text, and no supervisor call is made.
 */
async function targetName(ctx: ApiContext, playerId: string): Promise<string | null> {
  const agent = await ownedAgent(ctx.deps, ctx.ownerId, playerId);
  if (agent === null || agent.status === 'retired') {
    sendProblem(ctx.res, 'not_found');
    return null;
  }
  const name = agent.displayName;
  if (typeof name !== 'string' || !LOGIN_NAME.test(name)) {
    sendProblem(ctx.res, 'invalid', {}, LOGIN_NAME_DETAIL);
    return null;
  }
  return name;
}

/**
 * One supervisor op for the owner's agent. A timeout, no responders, a disconnect or an unreadable reply is 503.
 * Any other error is a register bug (500). No pending entry is kept: the call resolves or throws here.
 */
async function callSupervisor(
  ctx: ApiContext,
  body: BodyDeps,
  op: string,
  playerName: string,
  limit: number,
): Promise<void> {
  let reply: SupervisorReply;
  try {
    reply = await requestBodyOp(
      body.conn,
      op,
      body.shard,
      { ownerId: ctx.ownerId, playerName },
      { timeoutMs: body.timeoutMs },
    );
  } catch (error) {
    if (error instanceof BodyUnavailable || error instanceof MalformedReply) {
      unavailable(ctx);
      return;
    }
    sendProblem(ctx.res, 'internal');
    return;
  }
  mapReply(ctx, reply, limit, ctx.deps.now());
  return;
}

/** One body request in flight per owner (fix J): the slot is taken before the supervisor call and freed in finally. */
async function withSlot(
  ctx: ApiContext,
  inFlight: Set<string>,
  run: () => Promise<void>,
): Promise<void> {
  if (inFlight.has(ctx.ownerId)) return sendProblem(ctx.res, 'conflict');
  inFlight.add(ctx.ownerId);
  try {
    await run();
  } finally {
    inFlight.delete(ctx.ownerId);
  }
}

/**
 * The body routes (C7-04c): start, stop, restart, status and log, each a thin mapping over requestBodyOp. The
 * in-flight slot and the repeat-start window are per call of bodyRoutes, so each router has its own state.
 */
export function bodyRoutes(body: BodyDeps): readonly ApiRoute[] {
  const inFlight = new Set<string>();
  const starts = new Map<string, number[]>();

  /** Seconds to wait when the agent has used its starts in the window, or 0 and the start is recorded. */
  function startWait(playerId: string, now: number): number {
    const recent = (starts.get(playerId) ?? []).filter((t) => t > now - START_WINDOW_MS);
    if (recent.length >= START_WINDOW_MAX) {
      starts.set(playerId, recent);
      return Math.ceil(((recent[0] ?? now) + START_WINDOW_MS - now) / 1000);
    }
    recent.push(now);
    starts.set(playerId, recent);
    return 0;
  }

  /** A state-changing body op: owner and name check (404 or 422), then the start window, the slot and the supervisor. */
  const write = (pattern: RegExp, op: 'start' | 'stop' | 'restart'): ApiRoute => ({
    method: 'POST',
    pattern,
    scope: 'body',
    write: true,
    async handler(ctx) {
      const playerId = ctx.params[0] ?? '';
      const name = await targetName(ctx, playerId);
      if (name === null) return;
      if (op === 'start') {
        const wait = startWait(playerId, ctx.deps.now());
        if (wait > 0) {
          return sendProblem(ctx.res, 'rate_limited', { 'retry-after': String(wait) });
        }
      }
      return withSlot(ctx, inFlight, () => callSupervisor(ctx, body, op, name, LOG_MAX_LINES));
    },
  });

  const read = (pattern: RegExp, op: 'status' | 'logtail'): ApiRoute => ({
    method: 'GET',
    pattern,
    scope: 'read',
    write: false,
    async handler(ctx) {
      const playerId = ctx.params[0] ?? '';
      const name = await targetName(ctx, playerId);
      if (name === null) return;
      if (op === 'status') return callSupervisor(ctx, body, op, name, LOG_MAX_LINES);
      const limit = parseLogLimit(
        new URL(ctx.req.url ?? '/', 'http://register.invalid').searchParams.get('limit'),
      );
      if (limit === null) return sendProblem(ctx.res, 'invalid');
      return callSupervisor(ctx, body, op, name, limit);
    },
  });

  return [
    write(/^\/agents\/([^/]+)\/body\/start$/, 'start'),
    write(/^\/agents\/([^/]+)\/body\/stop$/, 'stop'),
    write(/^\/agents\/([^/]+)\/body\/restart$/, 'restart'),
    read(/^\/agents\/([^/]+)\/body\/status$/, 'status'),
    read(/^\/agents\/([^/]+)\/body\/log$/, 'logtail'),
  ];
}
