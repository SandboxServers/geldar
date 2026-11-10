/** The longest chat line the Body hears, stores or speaks (spec 5.8, `chat.max_chars`). */
export const MAX_LINE_CHARS = 256;
/** The longest speaker name kept (the contract's `from` limit). */
export const MAX_NAME_CHARS = 32;

/**
 * True for a code point that is never text a person typed on purpose and that can forge or hide a
 * line: control characters (newline and tab are handled before this), DEL and the C1 controls, zero
 * width and direction marks, the line and paragraph separators, bidirectional overrides and
 * isolates, the word joiner, the byte order mark, soft hyphens, fillers, variation selectors and
 * tag characters (invisible text a model can still read).
 */
function isHidden(code: number): boolean {
  return (
    code <= 0x1f ||
    (code >= 0x7f && code <= 0x9f) ||
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x2028 && code <= 0x202e) ||
    (code >= 0x2060 && code <= 0x206f) ||
    code === 0xfeff ||
    code === 0x00ad || // soft hyphen
    code === 0x034f || // combining grapheme joiner
    code === 0x061c || // Arabic letter mark
    code === 0x115f ||
    code === 0x1160 || // Hangul fillers
    code === 0x180e || // Mongolian vowel separator
    (code >= 0x180b && code <= 0x180d) || // Mongolian free variation selectors
    code === 0x180f || // Mongolian free variation selector four
    (code >= 0x17b4 && code <= 0x17b5) || // Khmer vowel inherent marks
    code === 0x3164 || // Hangul filler
    code === 0xffa0 || // halfwidth Hangul filler
    (code >= 0xfff0 && code <= 0xfffb) || // specials and interlinear annotation
    (code >= 0xfe00 && code <= 0xfe0f) || // variation selectors
    (code >= 0xe0000 && code <= 0xe007f) || // tag characters
    (code >= 0xe0100 && code <= 0xe01ef) || // variation selectors supplement
    (code >= 0x1bca0 && code <= 0x1bca3) || // shorthand format controls
    (code >= 0x1d173 && code <= 0x1d17a) // musical symbol format controls
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
