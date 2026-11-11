import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Verifies the gk_session cookie that the register service signs (R42). Glass never imports
 * threshold code, so this is the read side only; threshold/register/test/glass-cookie.test.ts signs
 * with the register code and checks that this verifier agrees. Glass never signs or sets the cookie.
 */
export const KINO_COOKIE = 'gk_session';

/** The register service refuses a session key shorter than this (threshold/register/src/config.ts); Glass does too, so an empty file cannot sign cookies. */
export const MIN_SESSION_KEY_LENGTH = 32;

export interface KinoSession {
  readonly identityHash: string;
  readonly expiresAt: number;
}

const mac = (key: string, body: string): Buffer =>
  createHmac('sha256', key).update(`kino-session-v1:${body}`).digest();

/** The session behind a cookie value, or null when it is malformed, forged or expired. Never throws. */
export function verifyKinoSession(key: string, value: string, nowMs: number): KinoSession | null {
  if (key.length < MIN_SESSION_KEY_LENGTH) return null; // fail closed: a weak key is a key anyone can sign with
  const [body, sig, extra] = value.split('.');
  if (!body || !sig || extra !== undefined) return null;
  const given = Buffer.from(sig, 'base64url');
  const want = mac(key, body);
  if (given.length !== want.length || !timingSafeEqual(given, want)) return null;
  try {
    const o = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as {
      h?: unknown;
      exp?: unknown;
    };
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
