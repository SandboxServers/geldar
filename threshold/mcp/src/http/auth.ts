import { createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { BlockList, isIP } from 'node:net';
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

/** Says whether a TCP peer address is a trusted proxy. */
export type ProxyTrust = (peer: string) => boolean;

/** An IPv4 address in its `::ffff:` mapped IPv6 form, unwrapped; any other address unchanged. */
function unmapped(address: string): string {
  const mapped = address.toLowerCase().startsWith('::ffff:') ? address.slice(7) : '';
  return isIP(mapped) === 4 ? mapped : address;
}

/**
 * The key a client's failed-auth bucket and open-request slots are kept under. An IPv6 address is
 * keyed by its /64, since one network holds a whole /64 of addresses; an IPv4 address, or an IPv4
 * address in its `::ffff:` mapped form, is keyed as the plain IPv4 address.
 */
export function clientKey(address: string): string {
  const bare = unmapped(address);
  if (isIP(bare) !== 6) return bare;
  const hextets = expandIPv6(bare).slice(0, 4);
  return `${hextets.map((hextet) => hextet.toString(16)).join(':')}::/64`;
}

/** The eight 16-bit groups of an IPv6 literal, with `::` filled in and an embedded IPv4 tail split. */
function expandIPv6(address: string): number[] {
  const text = address.replace(/(\d+)\.(\d+)\.(\d+)\.(\d+)$/, (_, a, b, c, d) => {
    const high = (Number(a) << 8) | Number(b);
    const low = (Number(c) << 8) | Number(d);
    return `${high.toString(16)}:${low.toString(16)}`;
  });
  const [head = '', tail = ''] = text.split('::');
  const left = head === '' ? [] : head.split(':');
  const right = tail === '' ? [] : tail.split(':');
  const zeros = new Array<string>(8 - left.length - right.length).fill('0');
  return [...left, ...zeros, ...right].map((group) => Number.parseInt(group, 16));
}

/**
 * A matcher over the `trusted_proxies` entries: exact IPs or CIDR ranges. An empty list trusts
 * no peer, so no forwarded header is ever read.
 */
export function trustedProxies(entries: readonly string[]): ProxyTrust {
  const list = new BlockList();
  for (const entry of entries) {
    const [ip = '', bits] = entry.split('/');
    const family = isIP(ip) === 6 ? 'ipv6' : 'ipv4';
    if (bits === undefined) list.addAddress(ip, family);
    else list.addSubnet(ip, Number(bits), family);
  }
  return (peer) => {
    const address = unmapped(peer);
    const family = isIP(address);
    if (family === 0) return false;
    return list.check(address, family === 6 ? 'ipv6' : 'ipv4');
  };
}

/**
 * The address a request is judged by: the TCP peer, unless the peer is a trusted proxy and sent
 * a `CF-Connecting-IP` that is an IP literal. A header from any other peer is ignored.
 */
export function clientAddress(req: IncomingMessage, trusted: ProxyTrust): string {
  const peer = req.socket.remoteAddress ?? 'unknown';
  if (!trusted(peer)) return peer;
  const header = req.headers['cf-connecting-ip'];
  const claimed = typeof header === 'string' ? header.trim() : '';
  return isIP(claimed) === 0 ? peer : claimed;
}
