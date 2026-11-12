/** Time helpers. Every parser returns epoch milliseconds, or null when a line carries no usable time. */

/** An ISO string, epoch ms (> 1e11) or epoch seconds. */
export function parseTime(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v > 1e11 ? v : v * 1000;
  if (typeof v === 'string' && v.length > 0) {
    if (/^\d+(\.\d+)?$/.test(v)) return parseTime(Number(v));
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

const DOCKER_PREFIX = /^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\s+(.*)$/;

/** Splits the `docker logs --timestamps` prefix (RFC 3339, nanoseconds allowed) from a line. */
export function splitDockerPrefix(line: string): { at: number | null; rest: string } {
  const m = DOCKER_PREFIX.exec(line);
  if (!m) return { at: null, rest: line };
  // Date.parse accepts at most millisecond digits reliably: trim the fraction.
  const iso = (m[1] as string).replace(/(\.\d{3})\d*Z$/, '$1Z');
  return { at: parseTime(iso), rest: m[2] as string };
}
