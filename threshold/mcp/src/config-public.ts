import {
  bool,
  type ClientIpHeader,
  headerName,
  map,
  optionalInt,
  proxyList,
} from './config-read.ts';

/** The `public` block of the shard file: the settings the public surfaces read (decision 0090). */
export interface PublicConfig {
  /** Peers allowed to set the client-address header (exact IPs or CIDR ranges). Empty trusts none. */
  trustedProxies: string[];
  /** The header a trusted proxy's client address is read from. */
  clientIpHeader: ClientIpHeader;
  /** The per-client token bucket on every public request; null (no `public:` block) means no per-client limit. */
  rateLimit: { perMinute: number; burst: number } | null;
  /**
   * True refuses every public request with the 503 kill-switch body. Read from the shard file at start:
   * it takes effect on restart. The immediate cut is `deploy/colo-public.sh off mcp` (Caddy swap + reload).
   */
  killSwitch: boolean;
}

/**
 * Used when a `public:` block leaves `rate_limit` out (ruling R23): one owner's pool is 600 a minute
 * in the shard's sovereign rate limits, so the per-client default is not below it.
 */
export const PUBLIC_RATE_DEFAULTS = { perMinute: 600, burst: 120 } as const;

/** The settings a front door uses when its caller passes none: no kill switch, default rate limit. */
export const PUBLIC_DEFAULTS: PublicConfig = {
  trustedProxies: [],
  clientIpHeader: 'x-geldar-client-ip',
  rateLimit: { ...PUBLIC_RATE_DEFAULTS },
  killSwitch: false,
};

/**
 * Reads the `public` block. Each key the block leaves out falls back to the `sovereign.mcp` value
 * (`trusted_proxies`, `client_ip_header`), which existing shard files still use, and then to the default.
 */
export function publicConfig(
  block: unknown,
  fallback: { trustedProxies: string[]; clientIpHeader: ClientIpHeader },
): PublicConfig {
  const pub = block === undefined ? {} : map(block, 'public');
  return {
    // No `public:` block means no per-client limit (decision 0091 point 5).
    rateLimit: block === undefined ? null : rateLimitConfig(pub.rate_limit),
    trustedProxies:
      pub.trusted_proxies === undefined
        ? fallback.trustedProxies
        : proxyList(pub, 'trusted_proxies', 'public'),
    clientIpHeader:
      pub.client_ip_header === undefined
        ? fallback.clientIpHeader
        : headerName(pub.client_ip_header, 'public.client_ip_header'),
    killSwitch: pub.kill_switch === undefined ? false : bool(pub, 'kill_switch', 'public'),
  };
}

/** `public.rate_limit`: per_minute 1 to 10000 and burst 1 to 1000, each defaulted when absent. */
function rateLimitConfig(value: unknown): { perMinute: number; burst: number } {
  if (value === undefined) return { ...PUBLIC_RATE_DEFAULTS };
  const block = map(value, 'public.rate_limit');
  return {
    perMinute: optionalInt(
      block,
      'per_minute',
      'public.rate_limit',
      1,
      10_000,
      PUBLIC_RATE_DEFAULTS.perMinute,
    ),
    burst: optionalInt(block, 'burst', 'public.rate_limit', 1, 1000, PUBLIC_RATE_DEFAULTS.burst),
  };
}
