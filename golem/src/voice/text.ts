/** The longest chat line the Body hears, stores or speaks (spec 5.8, `chat.max_chars`). */
export const MAX_LINE_CHARS = 256;
/** The longest speaker name kept (the contract's `from` limit). */
export const MAX_NAME_CHARS = 32;

/**
 * True for a code point that is never text a person typed on purpose and that can forge or hide a
 * line: control characters (newline and tab are handled before this), DEL and the C1 controls, zero
 * width and direction marks, the line and paragraph separators, bidirectional overrides and
 * isolates, the word joiner and the byte order mark.
 */
function isHidden(code: number): boolean {
  return (
    code <= 0x1f ||
    (code >= 0x7f && code <= 0x9f) ||
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x2028 && code <= 0x202e) ||
    (code >= 0x2060 && code <= 0x2069) ||
    code === 0xfeff
  );
}

/**
 * Makes untrusted chat text safe to store and to say: newlines and tabs become one space, hidden and
 * control characters go, runs of spaces collapse, the ends are trimmed and the result is cut to
 * `max` characters (by code point, so no surrogate pair is split). A text with nothing left is the
 * empty string.
 */
export function cleanLine(text: string, max: number = MAX_LINE_CHARS): string {
  const flat = text.replace(/[\r\n\t]+/g, ' ');
  const visible = [...flat].filter((ch) => !isHidden(ch.codePointAt(0) ?? 0)).join('');
  const squeezed = visible.replace(/ {2,}/g, ' ').trim();
  return [...squeezed].slice(0, max).join('').trim();
}
