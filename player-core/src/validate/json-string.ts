// Verbatim copy of animus/src/prompts/world-text.ts: MAX_ITEM_CHARS, the risky-code-point tables,
// isRiskyCodePoint, escapeCodePoint and jsonString. Keep identical; animus keeps its copy under
// prompts/** (frozen). threshold/mcp/src/json-string-parity.test.ts pins both.

export const MAX_ITEM_CHARS = 512;

// Code point ranges JSON leaves raw that still need escaping: the angle brackets, DEL and the C1
// controls, the soft hyphen, zero-width and bidirectional formatting, the line and paragraph
// separators, the byte order mark and the invisible fillers, marks and tag characters. Numbers, not
// characters, so no editor can alter them. {@link IGNORABLE} covers the same classes by property.
const RISKY_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x3c, 0x3c],
  [0x3e, 0x3e],
  [0x7f, 0x9f],
  [0xad, 0xad],
  [0x200b, 0x200f],
  [0x2028, 0x202e],
  [0x2060, 0x206f],
  [0xfeff, 0xfeff],
  [0x34f, 0x34f],
  [0x61c, 0x61c],
  [0x115f, 0x1160],
  [0x180b, 0x180f],
  [0x17b4, 0x17b5],
  [0x3164, 0x3164],
  [0xffa0, 0xffa0],
  [0xfff0, 0xfffb],
  [0xfe00, 0xfe0f],
  [0x1bca0, 0x1bca3],
  [0x1d173, 0x1d17a],
  [0xe0000, 0xe0fff],
];

/** Default-ignorable and format (Cf) code points, whatever Unicode version the runtime has. */
const IGNORABLE = /[\p{Default_Ignorable_Code_Point}\p{Cf}]/u;

const ELLIPSIS = String.fromCodePoint(0x2026);

/** True when the code point must be written as a unicode escape inside a prompt string. */
export function isRiskyCodePoint(cp: number): boolean {
  return (
    RISKY_RANGES.some(([lo, hi]) => cp >= lo && cp <= hi) ||
    IGNORABLE.test(String.fromCodePoint(cp))
  );
}

/** One code point as it sits inside a JSON string of a prompt: risky ones as UTF-16 unit escapes. */
function escapeCodePoint(ch: string): string {
  if (!isRiskyCodePoint(ch.codePointAt(0) ?? 0)) return JSON.stringify(ch).slice(1, -1);
  let out = '';
  for (let i = 0; i < ch.length; i++) {
    out += `\\u${ch.charCodeAt(i).toString(16).padStart(4, '0')}`;
  }
  return out;
}

/** `value` as a JSON string literal on one line, cut to `max` characters. */
export function jsonString(value: string, max: number = MAX_ITEM_CHARS): string {
  const chars = Array.from(value);
  const cut = chars.length > max ? `${chars.slice(0, max - 1).join('')}${ELLIPSIS}` : value;
  let out = '';
  for (const ch of cut) out += escapeCodePoint(ch);
  return `"${out}"`;
}
