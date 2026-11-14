import { createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { isOwnerKeyShape, type OwnerKeyScope, parseScopes } from '../owner-keys-policy.ts';
import { sessionHash } from '../session-store.ts';
import type { ApiDeps } from './route.ts';

/** A web session is the owner in the browser: it holds every scope, and a state change needs the CSRF token. */
const SESSION_SCOPES: OwnerKeyScope[] = ['read', 'body', 'manage'];

export interface Credential {
  readonly ownerId: string;
  readonly scopes: OwnerKeyScope[];
  /** The CSRF token a state-changing cookie request must echo. Null for a key, which needs none. */
  readonly csrf: string | null;
}

/** The CSRF token of a session (the same derivation as the web account page). */
export const csrfFor = (key: string, sessionId: string): string =>
  createHmac('sha256', key).update(`register-csrf-v1:${sessionId}`).digest('base64url');

/** Compares two strings in constant time; a length mismatch is a mismatch. */
export function sameText(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function cookieOf(req: IncomingMessage, name: string): string | null {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

/**
 * Resolves the caller. A gr_session cookie decides when present (an unknown or unreadable session is
 * refused, and a Bearer header is not tried). Otherwise a Bearer owner key is resolved through the
 * C7-02b store. A player token, a banned owner's key, or no credentials is null (401 upstream).
 */
export async function authenticate(
  req: IncomingMessage,
  deps: ApiDeps,
): Promise<Credential | null> {
  const sid = cookieOf(req, 'gr_session');
  if (sid !== null) {
    if (!deps.sessions || sid === '') return null;
    try {
      const row = await deps.sessions.touch(sessionHash(sid), deps.now());
      if (row === null) return null;
      return { ownerId: row.ownerId, scopes: SESSION_SCOPES, csrf: csrfFor(deps.csrfKey, sid) };
    } catch {
      return null;
    }
  }
  const token = /^Bearer (\S+)$/.exec(req.headers.authorization ?? '')?.[1];
  if (token === undefined || !deps.ownerKeys || !isOwnerKeyShape(token)) return null;
  try {
    const found = await deps.ownerKeys.store.resolve(deps.ownerKeys.hash(token));
    if (found === null) return null;
    return { ownerId: found.ownerId, scopes: parseScopes(found.scopes) ?? [], csrf: null };
  } catch {
    return null;
  }
}
