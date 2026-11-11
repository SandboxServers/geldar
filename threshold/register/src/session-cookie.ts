import { createHmac, timingSafeEqual } from 'node:crypto';

/** The signed session cookie register issues after the Microsoft sign-in and Glass verifies read-only (R42). */
export const KINO_COOKIE = 'gk_session';
export const KINO_COOKIE_TTL_MS = 30 * 60 * 1000;

export interface KinoSession {
  /** The identity hash, hex (HMAC of the Microsoft sub; never the email). */
  readonly identityHash: string;
  readonly expiresAt: number;
}

const mac = (key: string, body: string): Buffer =>
  createHmac('sha256', key).update(`kino-session-v1:${body}`).digest();

/** The cookie value: base64url(JSON) "." base64url(HMAC). Both sides hold the same key file. */
export function signKinoSession(key: string, session: KinoSession): string {
  const body = Buffer.from(
    JSON.stringify({ h: session.identityHash, exp: session.expiresAt }),
  ).toString('base64url');
  return `${body}.${mac(key, body).toString('base64url')}`;
}

/** The session behind a cookie value, or null when it is malformed, forged or expired. Never throws. */
export function verifyKinoSession(key: string, value: string, nowMs: number): KinoSession | null {
  const [body, sig, extra] = value.split('.');
  if (!body || !sig || extra !== undefined) return null;
  const given = Buffer.from(sig, 'base64url');
  const want = mac(key, body);
  if (given.length !== want.length || !timingSafeEqual(given, want)) return null;
  try {
    const p: unknown = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    const o = p as { h?: unknown; exp?: unknown };
    if (typeof o.h !== 'string' || !/^[0-9a-f]{64}$/.test(o.h)) return null;
    if (typeof o.exp !== 'number' || !Number.isFinite(o.exp) || nowMs >= o.exp) return null;
    return { identityHash: o.h, expiresAt: o.exp };
  } catch {
    return null;
  }
}

/** Reads the session from a Cookie header. */
export function kinoSessionFromHeader(
  key: string,
  header: string | undefined,
  nowMs: number,
): KinoSession | null {
  for (const part of (header ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === KINO_COOKIE) return verifyKinoSession(key, v.join('='), nowMs);
  }
  return null;
}

export const kinoCookieHeader = (value: string, maxAgeS: number): string =>
  `${KINO_COOKIE}=${value}; Max-Age=${maxAgeS}; Path=/; HttpOnly; Secure; SameSite=Lax`;
