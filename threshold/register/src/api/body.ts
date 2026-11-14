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
/** Retry-After for a quota refusal (the supervisor's hourly counter) and for an unreachable body. */
export const QUOTA_RETRY_SECONDS = 3600;
export const UNAVAILABLE_RETRY_SECONDS = 30;

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
      ctx.res.writeHead(422, { 'content-type': 'application/problem+json', ...SECURITY_HEADERS });
      ctx.res.end(
        JSON.stringify({
          type: 'about:blank',
          title: 'Invalid request',
          status: 422,
          code: 'invalid',
          detail: LOGIN_NAME_DETAIL,
        }),
      );
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
 * One supervisor op for the owner's agent. A timeout, no responders, a disconnect or an unreadable reply is 503.
 * Any other error is a register bug (500). No pending entry is kept: the call resolves or throws here.
 */
async function callSupervisor(
  ctx: ApiContext,
  body: BodyDeps,
  op: string,
  playerId: string,
  limit: number,
): Promise<void> {
  let reply: SupervisorReply;
  try {
    reply = await requestBodyOp(
      body.conn,
      op,
      body.shard,
      { ownerId: ctx.ownerId, playerName: playerId },
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

  /** A state-changing body op: owner check (404), then the in-flight slot, then the supervisor. */
  const write = (pattern: RegExp, op: 'start' | 'stop' | 'restart'): ApiRoute => ({
    method: 'POST',
    pattern,
    scope: 'body',
    write: true,
    async handler(ctx) {
      const playerId = ctx.params[0] ?? '';
      if ((await ownedAgent(ctx.deps, ctx.ownerId, playerId)) === null) {
        return sendProblem(ctx.res, 'not_found');
      }
      if (op === 'start') {
        const wait = startWait(playerId, ctx.deps.now());
        if (wait > 0) {
          return sendProblem(ctx.res, 'rate_limited', { 'retry-after': String(wait) });
        }
      }
      return withSlot(ctx, inFlight, () => callSupervisor(ctx, body, op, playerId, LOG_MAX_LINES));
    },
  });

  const read = (pattern: RegExp, op: 'status' | 'logtail'): ApiRoute => ({
    method: 'GET',
    pattern,
    scope: 'read',
    write: false,
    async handler(ctx) {
      const playerId = ctx.params[0] ?? '';
      if ((await ownedAgent(ctx.deps, ctx.ownerId, playerId)) === null) {
        return sendProblem(ctx.res, 'not_found');
      }
      if (op === 'status') return callSupervisor(ctx, body, op, playerId, LOG_MAX_LINES);
      const limit = parseLogLimit(
        new URL(ctx.req.url ?? '/', 'http://register.invalid').searchParams.get('limit'),
      );
      if (limit === null) return sendProblem(ctx.res, 'invalid');
      return callSupervisor(ctx, body, op, playerId, limit);
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
