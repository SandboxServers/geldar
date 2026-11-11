/**
 * Origin handling for the Kino WebSocket allow-list. One normal form (WHATWG `URL.origin`: lower-case
 * scheme and host, default port dropped, no trailing slash) is used for the configured entries and for the
 * request's Origin header, so `https://Glass.Example.test:443/` and `https://glass.example.test` are equal.
 */

/** The normal form of an http(s) origin, or null when `value` is not exactly an origin (host-only, path, query, wildcard, credentials). */
export function normalizeOrigin(value: string): string | null {
  const v = value.trim();
  if (!/^https?:\/\/[^/?#@\s*]+\/?$/i.test(v)) return null;
  try {
    const u = new URL(v);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.origin;
  } catch {
    return null;
  }
}

/** Normalises every entry; throws, naming the first entry that is not a valid http(s) origin. */
export function parseAllowedOrigins(entries: readonly string[]): string[] {
  return entries.map((e) => {
    const n = normalizeOrigin(e);
    if (n === null)
      throw new Error(
        `GELDAR_KINO_ALLOWED_ORIGINS entry "${e}" is not an http(s) origin: use scheme and host such as https://glass.example.test (no path, no wildcard)`,
      );
    return n;
  });
}
