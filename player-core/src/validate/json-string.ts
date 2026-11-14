// copy of animus/src/prompts/world-text.ts jsonString; must stay identical.
// GX-04a: animus keeps its copy under prompts/** (frozen). threshold/mcp/src/json-string-parity.test.ts pins both.
const MAX_ITEM_CHARS = 512;

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
