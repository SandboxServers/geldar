import { createHmac, timingSafeEqual } from 'node:crypto';
import type { PlayerRecord, TokenStore } from '../ports.ts';

/** `ok` with the token and player it resolved to, or the refusal. */
export type BearerVerdict =
  | { outcome: 'ok'; tokenId: string; player: PlayerRecord }
  | { outcome: 'unauthorized' | 'forbidden' };

/**
 * Exactly `Bearer `, one space, then a token of the allowed shape. A lowercase scheme, a double
 * space or a trailing space is refused: the stricter reading of RFC 7235.
 */
const BEARER = /^Bearer ([A-Za-z0-9._~+/=-]{16,200})$/;

/** The token in an `Authorization` header, or null. The query string is never read. */
export function parseBearer(header: string | undefined): string | null {
  if (header === undefined) return null;
  return BEARER.exec(header)?.[1] ?? null;
}

/** HMAC-SHA256 of a token under the pepper: the digest the token store holds (spec 5.15.3). */
export function tokenDigest(pepper: Uint8Array, token: string): Uint8Array {
  return createHmac('sha256', pepper).update(token, 'utf8').digest();
}

/** Two player ids compared in constant time. Unequal lengths differ at once. */
function sameText(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Verifies a presented bearer for the player named in the URL. The store matches the digest and
 * refuses revoked, expired or inactive tokens (null). The token must then resolve to the URL's
 * player, or the answer is `forbidden`. An unknown player is `unauthorized`, as before.
 */
export async function verifyBearer(
  store: TokenStore,
  pepper: Uint8Array,
  playerId: string,
  header: string | undefined,
  nowMs: number,
): Promise<BearerVerdict> {
  const token = parseBearer(header);
  if (token === null) return { outcome: 'unauthorized' };
  const resolved = await store.resolve(tokenDigest(pepper, token), nowMs);
  if (resolved === null) return { outcome: 'unauthorized' };
  if (!sameText(resolved.player.playerId, playerId)) return { outcome: 'forbidden' };
  await store.touch(resolved.tokenId, nowMs).catch(() => undefined);
  return { outcome: 'ok', tokenId: resolved.tokenId, player: resolved.player };
}
