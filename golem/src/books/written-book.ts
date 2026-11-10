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
    text: clip(text, TEXT_LIMIT),
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

/** Drops C0 and C1 control characters and DEL, the newline and the tab among them. */
function clean(text: string): string {
  let out = '';
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code > 0x1f && (code < 0x7f || code > 0x9f)) out += char;
  }
  return out;
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
