import { createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { BlockList, isIP } from 'node:net';
import type { MissReason, PlayerRecord, RefusalReason, TokenStore } from '../ports.ts';

/** `ok` with the token and player it resolved to, or the refusal with its log-only reason. */
export type BearerVerdict =
  | { outcome: 'ok'; tokenId: string; player: PlayerRecord }
  | { outcome: 'unauthorized' | 'forbidden'; reason: RefusalReason };

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
 * player, or the answer is `forbidden`. An unknown player is `unauthorized`, as before. A digest
 * the `misses` cache remembers as refused is answered without a store lookup.
 */
export async function verifyBearer(
  store: TokenStore,
  pepper: Uint8Array,
  playerId: string,
  header: string | undefined,
  nowMs: number,
  misses: MissCache,
): Promise<BearerVerdict> {
  const token = parseBearer(header);
  if (token === null) return { outcome: 'unauthorized', reason: shapeReason(header) };
  const digest = tokenDigest(pepper, token);
  const remembered = misses.get(digest, nowMs);
  if (remembered !== undefined) return { outcome: 'unauthorized', reason: remembered };
  const resolved = await store.resolve(digest, nowMs);
  if (resolved === null) {
    // The store is asked why only for some misses (see MissCache), and the answer is remembered.
    const reason = misses.shouldExplain()
      ? await explainMiss(store, digest, nowMs)
      : 'unknown_token';
    misses.remember(digest, reason, nowMs);
    return { outcome: 'unauthorized', reason };
  }
  if (!sameText(resolved.player.playerId, playerId)) {
    return { outcome: 'forbidden', reason: 'wrong_player' };
  }
  await store.touch(resolved.tokenId, nowMs).catch(() => undefined);
  return { outcome: 'ok', tokenId: resolved.tokenId, player: resolved.player };
}

/** Why a header holds no usable bearer: none at all, another scheme, or a token of a wrong shape. */
function shapeReason(header: string | undefined): RefusalReason {
  if (header === undefined) return 'no_header';
  return header.startsWith('Bearer ') ? 'token_shape' : 'malformed_scheme';
}

/** The store's reason for a miss. A store without `explainMiss` says `unknown_token`; a failure is `internal`. */
async function explainMiss(
  store: TokenStore,
  digest: Uint8Array,
  nowMs: number,
): Promise<MissReason> {
  if (store.explainMiss === undefined) return 'unknown_token';
  try {
    return await store.explainMiss(digest, nowMs);
  } catch {
    return 'internal';
  }
}

/** How long a refused digest is remembered: a repeat within it skips the store (spec 5.15.3). */
export const MISS_CACHE_MS = 5_000;
/** Most refused digests remembered at once; the table is cleared when it is full. */
const MISS_CACHE_MAX = 1024;
/** One uncached miss in this many asks the store why, so a flood of bad bearers costs about one query each. */
const EXPLAIN_EVERY = 8;

/**
 * Refused bearers the front door remembers for a few seconds, keyed by token digest. A repeated
 * bad bearer is answered from here, with the reason it got the first time, so it costs no lookup.
 * A token issued during the window is refused until it expires from here. Holds at most
 * MISS_CACHE_MAX digests. Only the first of every EXPLAIN_EVERY uncached misses asks the store
 * why; the others log `unknown_token`. The reason is for the log only, never the answer.
 */
export class MissCache {
  private readonly entries = new Map<string, { reason: MissReason; untilMs: number }>();
  private uncached = 0;

  /** The reason remembered for the digest, or undefined when it is not remembered or has expired. */
  get(digest: Uint8Array, nowMs: number): MissReason | undefined {
    const key = Buffer.from(digest).toString('hex');
    const entry = this.entries.get(key);
    if (entry === undefined) return undefined;
    if (entry.untilMs > nowMs) return entry.reason;
    this.entries.delete(key);
    return undefined;
  }

  /** Whether this uncached miss should ask the store why. Counts every call. */
  shouldExplain(): boolean {
    const explain = this.uncached % EXPLAIN_EVERY === 0;
    this.uncached += 1;
    return explain;
  }

  /** Remembers a refused digest for MISS_CACHE_MS. */
  remember(digest: Uint8Array, reason: MissReason, nowMs: number): void {
    if (this.entries.size >= MISS_CACHE_MAX) this.entries.clear();
    this.entries.set(Buffer.from(digest).toString('hex'), {
      reason,
      untilMs: nowMs + MISS_CACHE_MS,
    });
  }
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

/** The mode that reads `X-Forwarded-For` rightmost-untrusted-hop style; any other name is single-valued. */
export const FORWARDED_FOR = 'x-forwarded-for';

/** The effective client address, and a warning when a trusted proxy sent no usable address. */
export interface ClientAddress {
  address: string;
  warning?: 'header_missing' | 'header_malformed';
}

/**
 * The address a request is judged by. The TCP peer, unless the peer is a trusted proxy: then the
 * named header (one IP literal), or `X-Forwarded-For` walked from the right past trusted hops. A
 * header from any other peer is ignored. A trusted peer whose header is absent or not an IP
 * literal gets the peer address and a warning, so a misconfigured proxy shows in the log.
 */
export function clientAddress(
  req: IncomingMessage,
  trusted: ProxyTrust,
  header: string,
): ClientAddress {
  const peer = req.socket.remoteAddress ?? 'unknown';
  if (!trusted(peer)) return { address: peer };
  const raw = req.headers[header];
  if (raw === undefined) return { address: peer, warning: 'header_missing' };
  if (header === FORWARDED_FOR) return forwardedAddress(String(raw), peer, trusted);
  const claimed = typeof raw === 'string' ? raw.trim() : '';
  return isIP(claimed) === 0
    ? { address: peer, warning: 'header_malformed' }
    : { address: claimed };
}

/** The first hop from the right that is not a trusted proxy; malformed hops fall back to the peer. */
function forwardedAddress(value: string, peer: string, trusted: ProxyTrust): ClientAddress {
  const hops = value
    .split(',')
    .map((hop) => hop.trim())
    .filter((hop) => hop !== '');
  if (hops.length === 0) return { address: peer, warning: 'header_missing' };
  for (let index = hops.length - 1; index >= 0; index--) {
    const hop = hops[index] ?? '';
    if (isIP(hop) === 0) return { address: peer, warning: 'header_malformed' };
    if (!trusted(hop)) return { address: hop };
  }
  // Every hop is a trusted proxy: the client is the leftmost one.
  return { address: hops[0] ?? peer };
}
