import { createHmac } from 'node:crypto';

/** Signs a gk_session value the way the register service does; the register tests check the two agree. */
export function signKinoSession(
  key: string,
  session: { identityHash: string; expiresAt: number },
): string {
  const body = Buffer.from(
    JSON.stringify({ h: session.identityHash, exp: session.expiresAt }),
  ).toString('base64url');
  const mac = createHmac('sha256', key).update(`kino-session-v1:${body}`).digest('base64url');
  return `${body}.${mac}`;
}
