/**
 * The public policy Glass applies to each request: the client guard (0072 item 3), the thought delay
 * (item 5), and, in later steps, the sovereign rule and the kill switch. The defaults admit a request
 * with no guard and show every thought at once.
 */
import { RateLimiter } from './guard.ts';
import type { Visibility } from './query.ts';
import { STATIC_FILES } from './static-files.ts';

export interface PublicPolicy {
  /** Peers whose forwarded client address is believed. Empty: the socket address is used. */
  trustedProxies: ReadonlySet<string>;
  /** Exact host names (lower case, no port) answered besides the local ones. No wildcards. */
  publicHosts: ReadonlySet<string>;
  /** The per-client token bucket, or null when rate limiting is off (tests only). */
  limiter: RateLimiter | null;
  /**
   * The Thought Stream page's own files (markup, styles, modules, typefaces, the worker): a generous bucket
   * apart from the general one. One cold load asks for each file twice (the page, then the service worker's
   * copy), which is more than the general burst allows. Null: use `limiter`.
   */
  pageStaticLimiter: RateLimiter | null;
  /** Kino's static files (page, modules, vendor): a generous bucket apart from the general one. Null: use `limiter`. */
  kinoStaticLimiter: RateLimiter | null;
  /** Kino's /kino/targets: its own bucket. Null: use `limiter`. */
  kinoTargetsLimiter: RateLimiter | null;
  /** Seconds a thought waits before Glass shows it (0072 item 5). Zero shows it at once. */
  delaySeconds: number;
  /** True only when the owner rules that a living sovereign agent's thoughts and receipts may show. */
  showLivingSovereign: boolean;
  /** False: every request gets 503 and open streams close at the next heartbeat (0072 item 6). */
  enabled: () => boolean;
  /** The clock the delay reads, in epoch milliseconds. */
  now: () => number;
}

/** The policy a handler uses when the caller gives none. */
export const OPEN_POLICY: PublicPolicy = {
  trustedProxies: new Set(),
  publicHosts: new Set(),
  limiter: null,
  pageStaticLimiter: null,
  kinoStaticLimiter: null,
  kinoTargetsLimiter: null,
  delaySeconds: 0,
  showLivingSovereign: false,
  enabled: () => true,
  now: () => Date.now(),
};

/** What a reader may see at the policy's clock: thoughts at or before `now - delaySeconds`. */
export function visibilityAt(policy: PublicPolicy): Visibility {
  const showLivingSovereign = policy.showLivingSovereign;
  if (policy.delaySeconds <= 0) return { shownUntil: null, showLivingSovereign };
  const cut = policy.now() - policy.delaySeconds * 1000;
  return { shownUntil: new Date(cut).toISOString(), showLivingSovereign };
}

/**
 * The bucket a request path is charged to. The page's files have their own, so loading the page cannot
 * starve the API it then calls. Kino's static files and its targets list each have their own,
 * so a page load (about a dozen modules) cannot starve the picker's list. /kino/ws is an upgrade and has its
 * own per-client limits in the relay. Everything else is the general bucket.
 */
export function limiterFor(policy: PublicPolicy, path: string): RateLimiter | null {
  if (STATIC_FILES.has(path)) return policy.pageStaticLimiter ?? policy.limiter;
  if (path === '/kino/targets') return policy.kinoTargetsLimiter ?? policy.limiter;
  if (path.startsWith('/kino/') && path !== '/kino/ws') {
    return policy.kinoStaticLimiter ?? policy.limiter;
  }
  return policy.limiter;
}

/** The general bucket's size, as configured: GELDAR_GLASS_RATE_PER_MINUTE, _BURST and _MAX_CLIENTS. */
export interface RateSettings {
  perMinute: number;
  burst: number;
  maxClients: number;
}

/** The static buckets' size. Fixed in code: 200 files at once, then ten a second, for each client. */
export const STATIC_RATE = { perMinute: 600, burst: 200 } as const;

/**
 * The four buckets of the public policy. The general one is configured; the two static ones are fixed and
 * generous, because a page load is many small files from memory; Kino's targets list is small and slow.
 */
export function buildLimiters(
  general: RateSettings,
  now: () => number = () => Date.now(),
): Pick<
  PublicPolicy,
  'limiter' | 'pageStaticLimiter' | 'kinoStaticLimiter' | 'kinoTargetsLimiter'
> {
  const { maxClients } = general;
  return {
    limiter: new RateLimiter({ ...general, now }),
    pageStaticLimiter: new RateLimiter({ ...STATIC_RATE, maxClients, now }),
    kinoStaticLimiter: new RateLimiter({ ...STATIC_RATE, maxClients, now }),
    kinoTargetsLimiter: new RateLimiter({ perMinute: 30, burst: 10, maxClients, now }),
  };
}
