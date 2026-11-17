// Shared redaction for captured content (T-06d1): key-based and value-based. MCP, Body and
// eventsink all pass what they capture through here before it becomes a span event or log record.

import { hasForbiddenSegment } from './attributes.ts';

/** The value that replaces a secret-named key's value and any secret-shaped text. */
export const REDACTED = '[redacted]';

/** The deepest level copied; an object below it is replaced by TRUNCATED_MARK. */
const MAX_REDACT_DEPTH = 32;
const TRUNCATED_MARK = '[truncated]';
const CYCLE_MARK = '[cycle]';
/** The most entries copied from one Map or Set; the rest is replaced by TRUNCATED_MARK. */
const MAX_COLLECTION_ENTRIES = 1000;
/** The most objects visited in one redactContent call, so a shared sub-object (a DAG) cannot blow up the copy. */
const MAX_REDACT_NODES = 100_000;

interface Walk {
  ancestors: WeakSet<object>;
  nodes: number;
}
const UNREADABLE_MARK = '[unreadable]';

// Mirrors TOKEN_PATTERN in threshold/mcp/src/store/token-hash.ts (`^gmcp-[0-9a-f]{64}$`), unanchored
// so it finds a token inside text. Not imported: this package does not depend on threshold.
const MCP_TOKEN = /gmcp-[0-9a-f]{64}/g;
// An Authorization or Proxy-Authorization header (also as a quoted JSON pair, `"Authorization":"..."`).
// Group 1 is the head up to the value. The value is either a scheme (Basic, Bearer, Token, Digest,
// Negotiate, NTLM) and the rest up to a quote or the end of the line, or a bare run of 16 or more
// token characters with at least one digit or symbol. Prose such as `authorization: grants access` stays.
const AUTH_HEADER =
  /\b((?:Proxy-)?Authorization["']?[ \t]*[:=][ \t]*["']?)(?:(?:Basic|Bearer|Token|Digest|Negotiate|NTLM)[ \t]+[^\r\n"']*|(?=[A-Za-z0-9._~+/=-]{16})(?=[A-Za-z0-9._~+/=-]*[\d._~+/=-])[A-Za-z0-9._~+/=-]+)/gi;
// `bearer <run>` (also `Bearer: <run>` and `Bearer "<run>"`), case-insensitive because HTTP schemes are.
// The run is 6 or more characters and ends at a space, quote, comma or semicolon. `Bearer` or `BEARER`
// redacts any such run; another case redacts only a run with a digit or `_~+/=` or one of 20+ characters,
// so `the bearer of bad news` and `bearer wisdom` stay.
// `{6}` then `*`, not `{6,}`: V8 pushes a backtrack frame per iteration of a counted greedy loop, so
// `{6,}` throws RangeError (regex stack) on a run of about 5.5 MiB.
const BEARER = /\b(bearer)(?:[ \t]*[:=][ \t]*|[ \t]+)(["']?)([^\s"',;]{6}[^\s"',;]*)/gi;
const BEARER_PROOF = /[\d_~+/=]/;
// URL userinfo: `scheme://user:pass@`. The password part is required, so a plain `a@b` is untouched, and
// it runs to the last `@` before the next `/` or space, so `u:p@ss@host` hides `ss` too. The scheme is
// left-anchored (no letter, digit, + . - before it) and at most 32 characters, so a long run with no
// `://` is rejected in constant time per start instead of rescanned from every position.
const URL_USERINFO = /(?<![a-z0-9+.-])([a-z][a-z0-9+.-]{0,31}:\/\/)[^\s/@:]*:[^\s/]*@/gi;

// Free-text `key=value` and `key: value` (also `"key":"value"`). The key starts at a key boundary (no
// word character, dot or hyphen before it) and is at most 64 characters, so a long run is rejected in
// constant time per start. The key is judged by the same rule as an object key (hasForbiddenSegment),
// minus email addresses and authorization (the header pattern owns that). The value runs to a space,
// quote, `&`, `,` or `;`; it is not capped, so a long secret is hidden whole.
// The scan matches only `key + separator` (never the value), so a non-credential key such as `https`
// cannot swallow `//host/cb?token=...`; the value is read, with a sticky regex, only for a credential key.
const KEY_SEP = /(?<![\w.-])(?:--)?([A-Za-z][\w.-]*)(["']?[ \t]*[=:][ \t]*["']?)/g;
const KEY_HINT = /token|pass|pwd|secret|key|cookie|auth|cred|jwt|session|bearer/i;
/** An unquoted value: up to whitespace, a quote, `&`, `,`, `;` or `)`. */
const VALUE_RUN = /[^\s"'&,;)]+/y;
/** A quoted value: up to the closing quote on the same line; capped so an unclosed quote is cheap. */
const COOKIE_KEY = /(?:^|[._-])cookie$/i;
/** A cookie header value in `name=value` form: the rest of the line. */
const COOKIE_PAIRS = /[^\s=;"']+=[^\r\n]*/y;
const VALUE_DQ = /[^"\r\n]{0,8192}"/y;
const VALUE_SQ = /[^'\r\n]{0,8192}'/y;

function credentialKey(key: string): boolean {
  return KEY_HINT.test(key) && !/email|authorization/i.test(key) && hasForbiddenSegment(key);
}

/** The text with the value of every credential `key=value` / `key: value` pair replaced. One linear pass. */
function scrubKeyValues(text: string): string {
  let out = '';
  let last = 0;
  KEY_SEP.lastIndex = 0;
  for (let m = KEY_SEP.exec(text); m; m = KEY_SEP.exec(text)) {
    const end = m.index + m[0].length;
    if (!credentialKey(m[1] as string)) continue;
    let length = 0;
    // A cookie header (`Cookie: a=1; session=abcd`, `Set-Cookie: ...`) runs to the end of the line.
    if (COOKIE_KEY.test(m[1] as string)) {
      COOKIE_PAIRS.lastIndex = end;
      length = COOKIE_PAIRS.exec(text)?.[0].length ?? 0;
    }
    const quote =
      length > 0
        ? undefined
        : m[2]?.endsWith('"')
          ? VALUE_DQ
          : m[2]?.endsWith("'")
            ? VALUE_SQ
            : undefined;
    if (quote) {
      quote.lastIndex = end;
      const q = quote.exec(text);
      if (q) length = q[0].length - 1;
    }
    if (length === 0) {
      VALUE_RUN.lastIndex = end;
      length = VALUE_RUN.exec(text)?.[0].length ?? 0;
    }
    if (length === 0) continue;
    out += text.slice(last, end) + REDACTED;
    last = end + length;
    KEY_SEP.lastIndex = last;
  }
  return out + text.slice(last);
}

/** The text with Authorization values, bearer strings, MCP tokens, URL userinfo and secret key=value pairs replaced. */
export function scrubText(text: string): string {
  try {
    return scrubPatterns(text);
  } catch {
    // Any failure (a regex stack overflow, an engine limit): drop the text, never return it unscrubbed.
    return `[unscrubbable ${text.length} chars]`;
  }
}

function scrubPatterns(text: string): string {
  return scrubKeyValues(
    text
      .replace(AUTH_HEADER, (_match, head: string) =>
        /["']/.test(head) ? head + REDACTED : REDACTED,
      )
      .replace(BEARER, (match, word: string, quote: string, run: string) =>
        word === 'Bearer' || word === 'BEARER' || BEARER_PROOF.test(run) || run.length >= 20
          ? quote + REDACTED
          : match,
      )
      .replace(MCP_TOKEN, REDACTED)
      .replace(URL_USERINFO, `$1${REDACTED}@`),
  );
}

/**
 * A copy of the value with every secret-named key's value replaced by REDACTED and every string
 * scrubbed by scrubText. Nested objects and arrays are copied too; the input is never changed.
 */
export function redactContent(value: unknown): unknown {
  try {
    return redactAt(value, 0, { ancestors: new WeakSet<object>(), nodes: 0 });
  } catch {
    return UNREADABLE_MARK;
  }
}

/** One property or element read that may run user code (a getter or a Proxy trap); a throw becomes a mark. */
function redactRead(read: () => unknown, depth: number, walk: Walk): unknown {
  try {
    return redactAt(read(), depth, walk);
  } catch {
    return UNREADABLE_MARK;
  }
}

/** One level of redactContent; `walk` holds the objects on the path to this value (a cycle guard) and a node count. */
function redactAt(value: unknown, depth: number, walk: Walk): unknown {
  if (typeof value === 'string') return scrubText(value);
  // JSON-safe plain data out: a bigint, symbol or function becomes text, never a value JSON.stringify rejects.
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'symbol' || typeof value === 'function') return scrubText(String(value));
  if (value === null || typeof value !== 'object') return value;
  if (walk.ancestors.has(value)) return CYCLE_MARK;
  if (depth >= MAX_REDACT_DEPTH || ++walk.nodes > MAX_REDACT_NODES) return TRUNCATED_MARK;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? 'Invalid Date' : value.toISOString();
  }
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
    return `[binary ${value.byteLength} bytes]`;
  }
  if (value instanceof Error) {
    const fields = errorFields(value);
    return {
      name: fields['exception.type'],
      message: fields['exception.message'],
      ...(fields['exception.stacktrace'] === undefined
        ? {}
        : { stack: fields['exception.stacktrace'] }),
    };
  }
  walk.ancestors.add(value);
  try {
    if (value instanceof Map) {
      const entries: unknown[] = [];
      for (const [k, v] of Array.from(value).slice(0, MAX_COLLECTION_ENTRIES)) {
        const keyed = typeof k === 'string' && hasForbiddenSegment(k);
        entries.push([
          redactAt(k, depth + 1, walk),
          keyed ? REDACTED : redactAt(v, depth + 1, walk),
        ]);
      }
      if (value.size > MAX_COLLECTION_ENTRIES) entries.push(TRUNCATED_MARK);
      return entries;
    }
    if (value instanceof Set) {
      const items = Array.from(value)
        .slice(0, MAX_COLLECTION_ENTRIES)
        .map((item) => redactAt(item, depth + 1, walk));
      if (value.size > MAX_COLLECTION_ENTRIES) items.push(TRUNCATED_MARK);
      return items;
    }
    if (Array.isArray(value)) {
      const items: unknown[] = [];
      for (let i = 0; i < value.length; i++) {
        items.push(redactRead(() => value[i], depth + 1, walk));
      }
      return items;
    }
    const copy: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      // A key that names a credential (the package's forbidden-name rule): whole words or joined stems.
      const kept = hasForbiddenSegment(key)
        ? REDACTED
        : redactRead(() => (value as Record<string, unknown>)[key], depth + 1, walk);
      // defineProperty, not assignment: a key named __proto__ stays an own key and never sets the prototype.
      Object.defineProperty(copy, key, {
        value: kept,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return copy;
  } finally {
    walk.ancestors.delete(value);
  }
}

/** The exception fields of a span event or log record. */
export interface ErrorFields {
  'exception.type': string;
  'exception.message': string;
  'exception.stacktrace'?: string;
}

/**
 * The most characters of one error field (message or stack) that reach scrubText. Longer text is cut
 * first and marked, so an unbounded error string cannot stall the event loop. The package's own cap
 * after scrubbing is 32 KiB, so nothing that would have been visible is lost.
 */
export const MAX_ERROR_TEXT_CHARS = 64 * 1024;

/** The text cut to MAX_ERROR_TEXT_CHARS, then scrubbed; a cut ends with `…[truncated N chars]`. */
function scrubBounded(text: string): string {
  if (text.length <= MAX_ERROR_TEXT_CHARS) return scrubText(text);
  const cut = text.length - MAX_ERROR_TEXT_CHARS;
  return `${scrubText(text.slice(0, MAX_ERROR_TEXT_CHARS))}…[truncated ${cut} chars]`;
}

/** Exception fields for a thrown value; message and stack are cut, then scrubbed. Never throws. */
export function errorFields(error: unknown): ErrorFields {
  try {
    if (error instanceof Error) {
      const fields: ErrorFields = {
        'exception.type': scrubBounded(String(error.name || 'Error')),
        'exception.message': scrubBounded(String(error.message)),
      };
      if (typeof error.stack === 'string')
        fields['exception.stacktrace'] = scrubBounded(error.stack);
      return fields;
    }
    const text = String(error);
    // A thrown plain object (String gives `[object Object]`): its redacted fields as JSON instead.
    const message =
      text === '[object Object]' ? JSON.stringify(redactContent(error)) : scrubBounded(text);
    return { 'exception.type': typeof error, 'exception.message': message };
  } catch {
    return { 'exception.type': 'unknown', 'exception.message': '' };
  }
}
