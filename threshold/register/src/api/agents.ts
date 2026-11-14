import type { IncomingMessage } from 'node:http';
import { SECURITY_HEADERS } from '../pages.ts';
import { sendProblem } from '../problem.ts';
import { agentView } from './agents-list.ts';
import { ownedAgent } from './guard.ts';
import type { AgentFlagStore, ApiContext, ApiRoute } from './route.ts';

/** The largest PATCH body read. The body is two booleans; anything bigger is refused as invalid. */
const MAX_BODY = 4096;
/** The camera and thoughts toggles change at most once per window; the account page shows the same refusal. */
const RETRY_AFTER_SECONDS = 10;
/** SQLSTATE 54000: the database refused a toggle that changes too often (0016, the thoughts toggle). */
const TOO_MANY_CHANGES = '54000';
/** SQLSTATE 42501: the database refused the write (the owner is banned, or the agent is not theirs; 0036). */
const DENIED = '42501';
const FLAG_FIELDS = ['publicCamera', 'thoughtsDelayedPublic'] as const;

interface FlagWrite {
  publicCamera?: boolean;
  thoughtsDelayedPublic?: boolean;
}

/**
 * Reads the PATCH body. Only the two flags are accepted, each a boolean, and at least one must be present. Any
 * other field (displayName is C7-07's rename), a non-boolean value, a non-object or an empty object is null (422).
 */
async function readFlagWrite(req: IncomingMessage): Promise<FlagWrite | null> {
  let text = '';
  for await (const chunk of req) {
    text += String(chunk);
    if (text.length > MAX_BODY) return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const fields = parsed as Record<string, unknown>;
  const keys = Object.keys(fields);
  if (keys.length === 0) return null;
  const out: FlagWrite = {};
  for (const key of keys) {
    if (!(FLAG_FIELDS as readonly string[]).includes(key)) return null;
    const value = fields[key];
    if (typeof value !== 'boolean') return null;
    out[key as keyof FlagWrite] = value;
  }
  return out;
}

function flagStore(ctx: ApiContext): AgentFlagStore {
  const flags = ctx.deps.flags;
  if (!flags) throw new Error('agent flag store is not wired');
  return flags;
}

function sqlState(err: unknown): unknown {
  return (err as { code?: unknown } | null)?.code;
}

function isTooManyChanges(err: unknown): boolean {
  return sqlState(err) === TOO_MANY_CHANGES;
}

/**
 * Applies the present flags, turn-offs first: a turn-off only narrows exposure, so a partial failure never leaves a
 * flag newly on that the request meant to clear. Ties keep the field order. A store false stops the writes.
 */
async function applyFlags(
  store: AgentFlagStore,
  identity: string,
  playerId: string,
  write: FlagWrite,
): Promise<boolean> {
  const steps: Array<[(typeof FLAG_FIELDS)[number], boolean]> = [];
  for (const field of FLAG_FIELDS) {
    const value = write[field];
    if (value !== undefined) steps.push([field, value]);
  }
  steps.sort((a, b) => Number(a[1]) - Number(b[1]));
  for (const [field, value] of steps) {
    const applied =
      field === 'publicCamera'
        ? await store.setPublicCamera(identity, playerId, value)
        : await store.setThoughtsDelayedPublic(identity, playerId, value);
    if (!applied) return false;
  }
  return true;
}

/**
 * PATCH /agents/{playerId} (C7-04e): sets publicCamera and/or thoughtsDelayedPublic on the owner's own agent. Cookie
 * session only (decision 0173), CSRF on the write. A foreign or missing agent is the guard's 404 before any write.
 * A store false (not the owner's) is 404. A database refusal for too many changes is 429 with Retry-After; a
 * database refusal for a banned owner (42501) is 401. Turn-offs are written before turn-ons. Any other store error is
 * thrown and the router answers 500 internal, so no success is reported.
 */
export const agentsPatchRoutes: readonly ApiRoute[] = [
  {
    method: 'PATCH',
    pattern: /^\/agents\/([^/]+)$/,
    scope: 'manage',
    write: true,
    cookieOnly: true,
    async handler(ctx) {
      const playerId = ctx.params[0] ?? '';
      if ((await ownedAgent(ctx.deps, ctx.ownerId, playerId)) === null) {
        return sendProblem(ctx.res, 'not_found');
      }
      const write = await readFlagWrite(ctx.req);
      if (write === null) return sendProblem(ctx.res, 'invalid');
      if (ctx.identityHash === null) return sendProblem(ctx.res, 'unauthenticated');
      const identity = ctx.identityHash;
      const store = flagStore(ctx);
      try {
        if (!(await applyFlags(store, identity, playerId, write))) {
          return sendProblem(ctx.res, 'not_found');
        }
      } catch (err) {
        if (isTooManyChanges(err)) {
          return sendProblem(ctx.res, 'rate_limited', {
            'retry-after': String(RETRY_AFTER_SECONDS),
          });
        }
        // The owner was banned between the guard and the write: the same refusal as the guard's.
        if (sqlState(err) === DENIED) return sendProblem(ctx.res, 'unauthenticated');
        throw err;
      }
      const agent = await ownedAgent(ctx.deps, ctx.ownerId, playerId);
      if (agent === null) throw new Error('agent missing after a flag write');
      ctx.res.writeHead(200, {
        'content-type': 'application/json',
        'cache-control': 'no-store',
        ...SECURITY_HEADERS,
      });
      ctx.res.end(JSON.stringify(agentView(agent)));
    },
  },
];
