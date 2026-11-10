/**
 * Reads a written book the Body carries (spec 5.2, 5.5; decision 0044). A book's title, author and
 * pages are world text written by a player or a bot. This module only turns them into plain text
 * with the contract's length caps: it never interprets them, never throws, and never touches the
 * bot. Nothing in the text is an instruction; the caller puts it in the untrusted part of a reply.
 *
 * Two shapes are read. The 1.20.5+ `written_book_content` data component is the shape of 26.1, but
 * it is not yet verified against a live server, so the shape of each book is logged for diagnostics.
 * The legacy NBT `nbt` tag (1.20.4 and earlier) is the fallback.
 */

export const TITLE_LIMIT = 64;
export const AUTHOR_LIMIT = 32;
export const TEXT_LIMIT = 8192;
/**
 * The text's cap in JSON-escaped UTF-8 bytes. A quote or a CJK character costs more than one byte
 * in a reply, so the text alone can outgrow the 16384-byte tool result cap; this budget keeps the
 * whole reply (title and author included) under it.
 */
export const TEXT_BYTES = 12_288;
const TRUNCATED = ' [book text cut short]';

/** A written book holds at most 100 pages in Minecraft; more are ignored. */
const MAX_PAGES = 100;
/** How deep a text component may nest before the rest of it is dropped. */
const MAX_DEPTH = 8;
const BOOK_NAME = 'written_book';
const CONTENT_KEYS = ['minecraft:written_book_content', 'written_book_content'];

export interface WrittenBook {
  title: string;
  author: string;
  text: string;
}

type Json = Record<string, unknown>;

/** True for an item stack of a written book (not a writable one). */
export function isWrittenBook(item: unknown): boolean {
  return record(item)?.name === BOOK_NAME;
}

/**
 * The book's title, author and text, or null when the item has no readable book content. A page
 * joins the text with a newline, and page text has no control characters, so a page cannot forge
 * a line break. `log` gets one line describing the item's shape (keys and names, never the text).
 */
export function readWrittenBook(item: unknown, log?: (line: string) => void): WrittenBook | null {
  try {
    const stack = record(item);
    if (stack === null) return null;
    log?.(`written book shape: ${shapeOf(stack)}`);
    const component = componentContent(stack);
    if (component !== null) {
      return fromParts(component.title, component.author, listOf(component.pages));
    }
    const legacy = nbtRoot(stack);
    if (legacy !== null) return fromParts(legacy.title, legacy.author, listOf(legacy.pages));
    return null;
  } catch {
    return null;
  }
}

function record(value: unknown): Json | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Json)
    : null;
}

/** The `written_book_content` data, from a components list (`{ name, data }`) or a map by name. */
function componentContent(stack: Json): Json | null {
  const components = stack.components;
  if (Array.isArray(components)) {
    for (const entry of components) {
      const component = record(entry);
      const kind = component?.name ?? component?.type;
      if (component !== null && typeof kind === 'string' && CONTENT_KEYS.includes(kind)) {
        return record(component.data);
      }
    }
    return null;
  }
  const map = record(components);
  if (map === null) return null;
  for (const key of CONTENT_KEYS) {
    if (key in map) return record(map[key]);
  }
  return null;
}

/** The legacy NBT root: a raw `compound` tag or a simplified object, when it has pages. */
function nbtRoot(stack: Json): Json | null {
  const nbt = record(stack.nbt);
  if (nbt === null) return null;
  const root = nbt.type === 'compound' ? record(nbt.value) : nbt;
  return root !== null && 'pages' in root ? root : null;
}

function fromParts(title: unknown, author: unknown, pages: unknown[]): WrittenBook {
  const text = pages
    .slice(0, MAX_PAGES)
    .map((page) => clean(plainText(rawOf(page))))
    .join('\n');
  return {
    title: clip(clean(plainText(rawOf(title))), TITLE_LIMIT),
    author: clip(clean(plainText(rawOf(author))), AUTHOR_LIMIT),
    text: fitBytes(clip(text, TEXT_LIMIT), TEXT_BYTES),
  };
}

/** A 1.20.5+ filtered value is `{ raw, filtered }`; the raw text is what was written. */
function rawOf(value: unknown): unknown {
  const wrapped = record(value);
  return wrapped !== null && 'raw' in wrapped ? wrapped.raw : value;
}

/** Unwraps an NBT tag (`{ type, value }`) up to twice: a list is a tag around a tag around an array. */
function untag(node: unknown): unknown {
  let value = node;
  for (let depth = 0; depth < 2; depth++) {
    const tag = record(value);
    if (tag === null || typeof tag.type !== 'string' || !('value' in tag)) break;
    value = tag.value;
  }
  return value;
}

function listOf(node: unknown): unknown[] {
  const value = untag(node);
  return Array.isArray(value) ? value : [];
}

/** The plain text of a text component: a string, a list of them, or `{ text, extra }`. */
function plainText(node: unknown, depth = 0): string {
  if (depth > MAX_DEPTH) return '';
  const value = untag(node);
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map((part) => plainText(part, depth + 1)).join('');
  const component = record(value);
  if (component === null) return '';
  const own = typeof component.text === 'string' ? component.text : '';
  const extra = Array.isArray(component.extra)
    ? component.extra.map((part) => plainText(part, depth + 1)).join('')
    : '';
  return own + extra;
}

/**
 * Drops C0 and C1 control characters and DEL, the newline and the tab among them; also the line and
 * paragraph separators (U+2028, U+2029) and the bidi embedding, override and isolate controls, so a
 * page cannot reorder or split the text the player reads.
 */
function clean(text: string): string {
  const codes = [...text].map((char) => char.codePointAt(0) ?? 0);
  let out = '';
  codes.forEach((code, at) => {
    if (isControl(code) || isHiddenControl(code)) return;
    if (isVariationSelector(code)) {
      if (isTextSelector(code) && isVisible(codes[at - 1])) out += String.fromCodePoint(code);
      return;
    }
    if (isJoiner(code)) {
      if (isLoneJoiner(codes, at)) out += String.fromCodePoint(code);
      return;
    }
    out += String.fromCodePoint(code);
  });
  return out;
}

/** A ZWNJ or ZWJ is kept only alone, between two visible characters: a run of joiners is a payload. */
function isLoneJoiner(codes: number[], at: number): boolean {
  if (isInvisible(codes[at - 1]) || isInvisible(codes[at + 1])) return false;
  let before = at - 1;
  while (before >= 0 && isVariationSelector(codes[before] ?? 0)) before--;
  let after = at + 1;
  while (after < codes.length && isVariationSelector(codes[after] ?? 0)) after++;
  return isVisible(codes[before]) && isVisible(codes[after]);
}

/** A visible character: not a space, a control, an invisible mark or a selector. */
function isVisible(code: number | undefined): boolean {
  if (code === undefined || isControl(code) || isInvisible(code) || isVariationSelector(code)) {
    return false;
  }
  return !/\s/u.test(String.fromCodePoint(code));
}

function isControl(code: number): boolean {
  return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
}

function isJoiner(code: number): boolean {
  return code === 0x200c || code === 0x200d;
}

function isInvisible(code: number | undefined): boolean {
  return code !== undefined && (isJoiner(code) || isHiddenControl(code));
}

/** The variation selectors: U+FE00-FE0F and the supplement U+E0100-E01EF. */
function isVariationSelector(code: number): boolean {
  return (code >= 0xfe00 && code <= 0xfe0f) || (code >= 0xe0100 && code <= 0xe01ef);
}

/** U+FE0E and U+FE0F pick text or emoji style; they are kept only after a visible character. */
function isTextSelector(code: number): boolean {
  return code === 0xfe0e || code === 0xfe0f;
}

/**
 * Zero-width and directional marks (U+200B, U+200E-U+200F, U+061C), the word joiner and invisible
 * operators (U+2060-U+2064, U+206A-U+206F), the soft hyphen, combining grapheme joiner, Mongolian
 * vowel separator and the Hangul and halfwidth fillers, the byte order mark (U+FEFF), the line and
 * paragraph separators, the bidi embedding, override and isolate controls, and the Unicode tag block
 * (U+E0000-U+E007F), which can carry invisible ASCII instructions to a model. The joiners are not
 * here: they are kept in some words and dropped by `isLoneJoiner`.
 */
function isHiddenControl(code: number): boolean {
  return (
    code === 0x200b ||
    (code >= 0x200e && code <= 0x200f) ||
    code === 0x061c ||
    (code >= 0x2028 && code <= 0x2029) ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2060 && code <= 0x206f) ||
    (code >= 0x2066 && code <= 0x2069) ||
    code === 0x00ad ||
    code === 0x034f ||
    code === 0x180e ||
    code === 0x115f ||
    code === 0x1160 ||
    code === 0x3164 ||
    code === 0xffa0 ||
    code === 0xfeff ||
    (code >= 0xe0000 && code <= 0xe007f)
  );
}

/** A string's size in a JSON reply: its JSON-escaped UTF-8 bytes, without the two quotes. */
function jsonBytes(text: string): number {
  return Buffer.byteLength(JSON.stringify(text)) - 2;
}

/** Cuts to at most `budget` JSON-escaped bytes, ending with a visible marker when it cuts. */
function fitBytes(text: string, budget: number): string {
  if (jsonBytes(text) <= budget) return text;
  const room = budget - jsonBytes(TRUNCATED);
  let out = '';
  let used = 0;
  for (const char of text) {
    const cost = jsonBytes(char);
    if (used + cost > room) break;
    out += char;
    used += cost;
  }
  return out + TRUNCATED;
}

/** Cuts to at most `limit` UTF-16 units, never leaving half of a surrogate pair. */
function clip(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}

/** The item's keys and component names, for the one-line diagnostic. */
function shapeOf(stack: Json): string {
  const keys = Object.keys(stack)
    .slice(0, 12)
    .map((key) => clip(key, 32))
    .join(',');
  const components = Array.isArray(stack.components)
    ? stack.components
        .slice(0, 8)
        .map((entry) => {
          const kind = record(entry)?.name ?? record(entry)?.type;
          return clip(typeof kind === 'string' ? kind : typeof entry, 48);
        })
        .join(',')
    : typeof stack.components;
  return `keys=${keys} components=${components} nbt=${typeof stack.nbt}`;
}
