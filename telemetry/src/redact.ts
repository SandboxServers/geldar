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
const BEARER = /\b(bearer)(?:[ \t]*[:=][ \t]*|[ \t]+)(["']?)([^\s"',;]{6,})/gi;
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
const KEY_VALUE = /(?<![\w.-])([A-Za-z][\w.-]{0,63})(["']?[ \t]*[=:][ \t]*["']?)([^\s"'&,;]+)/g;
const KEY_HINT = /token|pass|pwd|secret|key|cookie|auth|cred|jwt|session|bearer/i;

function credentialKey(key: string): boolean {
  return (
    KEY_HINT.test(key) &&
    !/email|authorization/i.test(key) &&
    hasForbiddenSegment(key)
  );
}

/** The text with Authorization values, bearer strings, MCP tokens, URL userinfo and secret key=value pairs replaced. */
export function scrubText(text: string): string {
  return text
    .replace(AUTH_HEADER, (_match, head: string) => (/["']/.test(head) ? head + REDACTED : REDACTED))
    .replace(BEARER, (match, word: string, quote: string, run: string) =>
      word === 'Bearer' || word === 'BEARER' || BEARER_PROOF.test(run) || run.length >= 20
        ? quote + REDACTED
        : match,
    )
    .replace(MCP_TOKEN, REDACTED)
    .replace(URL_USERINFO, `$1${REDACTED}@`)
    .replace(KEY_VALUE, (match, key: string, sep: string) =>
      credentialKey(key) ? key + sep + REDACTED : match,
    );
}

/**
 * A copy of the value with every secret-named key's value replaced by REDACTED and every string
 * scrubbed by scrubText. Nested objects and arrays are copied too; the input is never changed.
 */
export function redactContent(value: unknown): unknown {
  try {
    return redactAt(value, 0, new WeakSet<object>());
  } catch {
    return UNREADABLE_MARK;
  }
}

/** One property or element read that may run user code (a getter or a Proxy trap); a throw becomes a mark. */
function redactRead(read: () => unknown, depth: number, ancestors: WeakSet<object>): unknown {
  try {
    return redactAt(read(), depth, ancestors);
  } catch {
    return UNREADABLE_MARK;
  }
}

/** One level of redactContent; `ancestors` holds the objects on the path to this value (a cycle guard). */
function redactAt(value: unknown, depth: number, ancestors: WeakSet<object>): unknown {
  if (typeof value === 'string') return scrubText(value);
  // JSON-safe plain data out: a bigint, symbol or function becomes text, never a value JSON.stringify rejects.
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'symbol' || typeof value === 'function') return scrubText(String(value));
  if (value === null || typeof value !== 'object') return value;
  if (ancestors.has(value)) return CYCLE_MARK;
  if (depth >= MAX_REDACT_DEPTH) return TRUNCATED_MARK;
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
  ancestors.add(value);
  try {
    if (value instanceof Map) {
      const entries: unknown[] = [];
      for (const [k, v] of Array.from(value).slice(0, MAX_COLLECTION_ENTRIES)) {
        const keyed = typeof k === 'string' && hasForbiddenSegment(k);
        entries.push([
          redactAt(k, depth + 1, ancestors),
          keyed ? REDACTED : redactAt(v, depth + 1, ancestors),
        ]);
      }
      if (value.size > MAX_COLLECTION_ENTRIES) entries.push(TRUNCATED_MARK);
      return entries;
    }
    if (value instanceof Set) {
      const items = Array.from(value)
        .slice(0, MAX_COLLECTION_ENTRIES)
        .map((item) => redactAt(item, depth + 1, ancestors));
      if (value.size > MAX_COLLECTION_ENTRIES) items.push(TRUNCATED_MARK);
      return items;
    }
    if (Array.isArray(value)) {
      const items: unknown[] = [];
      for (let i = 0; i < value.length; i++) {
        items.push(redactRead(() => value[i], depth + 1, ancestors));
      }
      return items;
    }
    const copy: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      // A key that names a credential (the package's forbidden-name rule): whole words or joined stems.
      const kept = hasForbiddenSegment(key)
        ? REDACTED
        : redactRead(() => (value as Record<string, unknown>)[key], depth + 1, ancestors);
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
    ancestors.delete(value);
  }
}

/** The exception fields of a span event or log record. */
export interface ErrorFields {
  'exception.type': string;
  'exception.message': string;
  'exception.stacktrace'?: string;
}

/** Exception fields for a thrown value; message and stack are scrubbed. Never throws. */
export function errorFields(error: unknown): ErrorFields {
  try {
    if (error instanceof Error) {
      const fields: ErrorFields = {
        'exception.type': error.name || 'Error',
        'exception.message': scrubText(String(error.message)),
      };
      if (typeof error.stack === 'string') fields['exception.stacktrace'] = scrubText(error.stack);
      return fields;
    }
    return { 'exception.type': typeof error, 'exception.message': scrubText(String(error)) };
  } catch {
    return { 'exception.type': 'unknown', 'exception.message': '' };
  }
}
