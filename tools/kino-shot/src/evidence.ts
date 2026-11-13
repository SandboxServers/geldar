// Pure evidence helpers: pixel fractions, token redaction, status parsing and the stdout summary.

export interface PixelFractions {
  magenta: number;
  black: number;
  pixels: number;
}

const NEAR = 40;

/** Fractions of near-magenta (255,0,255) and near-black pixels in an RGBA buffer. */
export function pixelFractions(rgba: Uint8Array | Uint8ClampedArray): PixelFractions {
  const pixels = Math.floor(rgba.length / 4);
  let magenta = 0;
  let black = 0;
  for (let i = 0; i < pixels; i++) {
    const r = rgba[i * 4] as number;
    const g = rgba[i * 4 + 1] as number;
    const b = rgba[i * 4 + 2] as number;
    if (r >= 255 - NEAR && g <= NEAR && b >= 255 - NEAR) magenta++;
    else if (r <= NEAR && g <= NEAR && b <= NEAR) black++;
  }
  if (pixels === 0) return { magenta: 0, black: 0, pixels: 0 };
  return { magenta: magenta / pixels, black: black / pixels, pixels };
}

/** Canvas is usable when it is not mostly magenta (missing texture) and not mostly black (nothing drawn). */
export function canvasLooksRendered(f: PixelFractions): boolean {
  return f.pixels > 0 && f.magenta < 0.5 && f.black < 0.98;
}

const TOKEN_PATTERNS: readonly RegExp[] = [
  /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /\b(token|secret|password|passwd|session|sid|cookie|authorization|api[_-]?key)(["']?\s*[:=]\s*["']?)[^\s"'&;,]{4,}/gi,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]*/g,
  /\b[A-Fa-f0-9]{32,}\b/g,
  /\b[A-Za-z0-9_-]{40,}\b/g,
];

/** Replace anything that resembles a credential before text is written to disk. */
export function redact(text: string): string {
  let out = text;
  out = out.replace(TOKEN_PATTERNS[0] as RegExp, '$1 [redacted]');
  out = out.replace(TOKEN_PATTERNS[1] as RegExp, '$1$2[redacted]');
  out = out.replace(TOKEN_PATTERNS[2] as RegExp, '[redacted]');
  out = out.replace(TOKEN_PATTERNS[3] as RegExp, '[redacted]');
  out = out.replace(TOKEN_PATTERNS[4] as RegExp, '[redacted]');
  return out;
}

export interface ParsedStatus {
  connected: boolean;
  chunks: number;
  entities: number;
}

/** Parses the Kino status line ("connected | chunks 12 | entities 3 | atlas ready (9)"). */
export function parseStatus(line: string): ParsedStatus | null {
  const m = /^(connected|not connected) \| chunks (\d+) \| entities (\d+)/.exec(line.trim());
  if (!m) return null;
  return { connected: m[1] === 'connected', chunks: Number(m[2]), entities: Number(m[3]) };
}

export interface Checks {
  pickerPopulated: boolean;
  connected: boolean;
  chunks: number;
  canvasRendered: boolean;
}

export function checksFrom(
  pickerOptions: number,
  statusTexts: readonly string[],
  fractions: PixelFractions | null,
): Checks {
  const parsed = statusTexts.map(parseStatus).filter((p): p is ParsedStatus => p !== null);
  return {
    pickerPopulated: pickerOptions > 0,
    connected: parsed.some((p) => p.connected),
    chunks: parsed.reduce((n, p) => Math.max(n, p.chunks), 0),
    canvasRendered: fractions !== null && canvasLooksRendered(fractions),
  };
}

export function passed(c: Checks): boolean {
  return c.pickerPopulated && c.connected && c.chunks > 0 && c.canvasRendered;
}

export interface Summary {
  ok: boolean;
  checks: Checks;
  fractions: PixelFractions | null;
  files: Record<string, string>;
  count429: number;
}

export function buildSummary(
  checks: Checks,
  fractions: PixelFractions | null,
  files: Record<string, string>,
  count429: number,
): Summary {
  return { ok: passed(checks), checks, fractions, files, count429 };
}

/** Counts by key, for status codes and WebSocket message types. */
export function tally(keys: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of keys) out[k] = (out[k] ?? 0) + 1;
  return out;
}

/**
 * The position of `wanted` in the page's camera list: an exact id first, then an exact label; -1 when
 * neither matches. Never a substring, so asking for "Moss" never picks "Mossy".
 */
export function agentIndex(
  agents: readonly { id?: unknown; label?: unknown }[],
  wanted: string,
): number {
  const byId = agents.findIndex((a) => a.id === wanted);
  return byId >= 0 ? byId : agents.findIndex((a) => a.label === wanted);
}
