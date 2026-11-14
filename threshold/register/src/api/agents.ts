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

function isTooManyChanges(err: unknown): boolean {
  return (err as { code?: unknown } | null)?.code === TOO_MANY_CHANGES;
}

/**
 * PATCH /agents/{playerId} (C7-04e): sets publicCamera and/or thoughtsDelayedPublic on the owner's own agent. Cookie
 * session only (decision 0173), CSRF on the write. A foreign or missing agent is the guard's 404 before any write.
 * A store false (not the owner's) is 404. A database refusal for too many changes is 429 with Retry-After. Any
 * other store error is thrown and the router answers 500 internal, so no success is reported.
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
        if (
          write.publicCamera !== undefined &&
          !(await store.setPublicCamera(identity, playerId, write.publicCamera))
        ) {
          return sendProblem(ctx.res, 'not_found');
        }
        if (
          write.thoughtsDelayedPublic !== undefined &&
          !(await store.setThoughtsDelayedPublic(identity, playerId, write.thoughtsDelayedPublic))
        ) {
          return sendProblem(ctx.res, 'not_found');
        }
      } catch (err) {
        if (isTooManyChanges(err)) {
          return sendProblem(ctx.res, 'rate_limited', {
            'retry-after': String(RETRY_AFTER_SECONDS),
          });
        }
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
