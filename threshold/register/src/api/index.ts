import type { IncomingMessage, ServerResponse } from 'node:http';
import { hasScope } from '../owner-keys-policy.ts';
import { sendProblem } from '../problem.ts';
import { agentsReadRoutes } from './agents-read.ts';
import { authenticate, sameText } from './auth.ts';
import type { ApiContext, ApiDeps, ApiRoute } from './route.ts';

const PREFIX = '/api/v1';

/** Thrown when an audit row could not be written; the request then ends 500 internal. */
class AuditLost extends Error {}

/** Reads the admin flag. A throw, or no hook, is not admin (the owner keeps the limit). */
async function readAdmin(deps: ApiDeps, ownerId: string): Promise<boolean> {
  if (!deps.isAdmin) return false;
  try {
    return (await deps.isAdmin(ownerId)) === true;
  } catch {
    return false;
  }
}

/**
 * The owner API router. Returns false for any path outside /api/v1/ (the caller answers 404 problem).
 * Order: the path (unknown is 404, a known path with another method is 405), the credential (401),
 * the CSRF token for a cookie write (403), the scope (403), the owner window for a write (429, not for
 * an admin), then the handler. A handler error is 500 internal.
 */
export async function handleApi(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  deps: ApiDeps,
): Promise<boolean> {
  if (!url.pathname.startsWith(`${PREFIX}/`)) return false;
  const sub = url.pathname.slice(PREFIX.length);
  const routes: readonly ApiRoute[] = [...agentsReadRoutes, ...(deps.routes ?? [])];
  let pathSeen = false;
  let found: { route: ApiRoute; params: string[] } | null = null;
  for (const route of routes) {
    const m = route.pattern.exec(sub);
    if (m === null) continue;
    pathSeen = true;
    if (route.method === req.method) {
      found = { route, params: m.slice(1).map((p) => p ?? '') };
      break;
    }
  }
  if (found === null) {
    sendProblem(res, pathSeen ? 'method_not_allowed' : 'not_found');
    return true;
  }
  const { route, params } = found;

  const cred = await authenticate(req, deps);
  if (cred === null) {
    sendProblem(res, 'unauthenticated');
    return true;
  }
  const sent = req.headers['x-csrf-token'];
  if (
    route.write &&
    cred.csrf !== null &&
    (typeof sent !== 'string' || !sameText(sent, cred.csrf))
  ) {
    sendProblem(res, 'csrf_required');
    return true;
  }
  if (!hasScope(cred.scopes, route.scope)) {
    sendProblem(res, 'scope_missing');
    return true;
  }
  const admin = await readAdmin(deps, cred.ownerId);
  if (route.write && !admin && deps.charge) {
    const wait = deps.charge(cred.ownerId);
    if (wait > 0) {
      sendProblem(res, 'rate_limited', { 'retry-after': String(wait) });
      return true;
    }
  }

  const ctx: ApiContext = {
    req,
    res,
    deps,
    params,
    ownerId: cred.ownerId,
    admin,
    async audit(entry) {
      const full = { ...entry, ownerId: cred.ownerId, admin };
      try {
        if (!deps.audit) throw new AuditLost('no audit sink');
        await deps.audit(full);
      } catch {
        deps.onAuditLost?.(full);
        throw new AuditLost('audit write failed');
      }
    },
  };
  try {
    await route.handler(ctx);
  } catch {
    if (res.headersSent) res.end();
    else sendProblem(res, 'internal');
  }
  return true;
}
