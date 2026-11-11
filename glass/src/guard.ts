/**
 * The public guards for Glass: the client address and a per-client token bucket. The bucket table has a
 * fixed size; the least recently used client is dropped when a new one would pass it. The clock is
 * injected, so no test sleeps (0072 item 3; the header and refusal shapes are decision 0090).
 */
import type { IncomingMessage } from 'node:http';

/** The header Caddy sets to the client address. It is read only from a trusted peer (0090). */
export const CLIENT_IP_HEADER = 'x-geldar-client-ip';

/** A forwarded value must look like an IPv4 or IPv6 address; anything else is ignored. */
const ADDRESS_SHAPE = /^[0-9A-Fa-f:.]{1,45}$/;

/**
 * The address a request is charged to. The socket peer is used, unless the peer is in the trusted
 * list; then the forwarded address is used when it is well formed.
 */
export function clientAddress(req: IncomingMessage, trusted: ReadonlySet<string>): string {
  const peer = req.socket.remoteAddress ?? '';
  if (!trusted.has(peer)) return peer;
  const raw = req.headers[CLIENT_IP_HEADER];
  const forwarded = (Array.isArray(raw) ? raw[0] : raw)?.trim() ?? '';
  return ADDRESS_SHAPE.test(forwarded) ? forwarded : peer;
}

/** Expands an IPv6 text address to eight 16-bit groups, or null when it is not one. */
function ipv6Groups(address: string): number[] | null {
  let text = address.toLowerCase();
  const dotted = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
  if (dotted !== null) {
    const o = dotted.slice(1, 5).map(Number);
    if (o.some((n) => n > 255)) return null;
    const hi = (((o[0] as number) << 8) | (o[1] as number)).toString(16);
    const lo = (((o[2] as number) << 8) | (o[3] as number)).toString(16);
    text = `${text.slice(0, dotted.index)}${hi}:${lo}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const parse = (part: string): string[] => (part === '' ? [] : part.split(':'));
  const head = parse(halves[0] ?? '');
  const tail = halves.length === 2 ? parse(halves[1] ?? '') : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;
  const all = [
    ...head,
    ...Array.from({ length: halves.length === 2 ? missing : 0 }, () => '0'),
    ...tail,
  ];
  if (!all.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null;
  return all.map((g) => Number.parseInt(g, 16));
}

/**
 * The key a client is limited by. IPv4 is the address itself. An IPv4-mapped IPv6 address is its
 * IPv4 address. Any other IPv6 address is its /64 prefix (the first four groups), because one
 * subscriber holds a whole /64 and could otherwise take a fresh key per request.
 */
export function clientKey(address: string): string {
  if (!address.includes(':')) return address;
  const groups = ipv6Groups(address);
  if (groups === null) return address;
  const mapped = groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff;
  if (mapped) {
    const [a = 0, b = 0] = groups.slice(6);
    return `${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`;
  }
  return `${groups
    .slice(0, 4)
    .map((g) => g.toString(16))
    .join(':')}::/64`;
}

export interface RateLimitOptions {
  /** Tokens added per minute, so the sustained rate per client. */
  perMinute: number;
  /** The bucket size: the most requests a client can make at once. */
  burst: number;
  /** The most clients held in the table at once; the least recently seen is dropped beyond it. */
  maxClients: number;
  /** Milliseconds from an injected clock. */
  now: () => number;
}

/** The verdict for one request. `retryAfter` is whole seconds, at least 1. */
export type Verdict = { allowed: true } | { allowed: false; retryAfter: number };

interface Bucket {
  tokens: number;
  last: number;
}

/** A token bucket per client address, with a bounded table. */
export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly options: RateLimitOptions;

  constructor(options: RateLimitOptions) {
    this.options = options;
  }

  /** Takes one token for the client, or refuses with the seconds until one is back. */
  take(client: string): Verdict {
    const { perMinute, burst, maxClients, now } = this.options;
    const at = now();
    const bucket = this.buckets.get(client) ?? { tokens: burst, last: at };
    // Re-inserting moves the client to the newest end of the Map, so the first key is the least recent.
    this.buckets.delete(client);
    bucket.tokens = Math.min(burst, bucket.tokens + ((at - bucket.last) * perMinute) / 60_000);
    bucket.last = at;
    let verdict: Verdict;
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      verdict = { allowed: true };
    } else {
      const wait = Math.ceil(((1 - bucket.tokens) * 60) / perMinute);
      verdict = { allowed: false, retryAfter: Math.max(1, wait) };
    }
    this.buckets.set(client, bucket);
    while (this.buckets.size > maxClients) {
      const oldest = this.buckets.keys().next().value;
      if (oldest === undefined) break;
      this.buckets.delete(oldest);
    }
    return verdict;
  }

  /** How many clients the table holds now. */
  get size(): number {
    return this.buckets.size;
  }
}
