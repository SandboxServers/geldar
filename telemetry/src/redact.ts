// Shared redaction for captured content (T-06d1): key-based and value-based. MCP, Body and
// eventsink all pass what they capture through here before it becomes a span event or log record.

import { hasForbiddenSegment } from './attributes.ts';

/** The value that replaces a secret-named key's value and any secret-shaped text. */
export const REDACTED = '[redacted]';

/** The deepest level copied; an object below it is replaced by TRUNCATED_MARK. */
const MAX_REDACT_DEPTH = 32;
const TRUNCATED_MARK = '[truncated]';
const CYCLE_MARK = '[cycle]';
const UNREADABLE_MARK = '[unreadable]';

// Mirrors TOKEN_PATTERN in threshold/mcp/src/store/token-hash.ts (`^gmcp-[0-9a-f]{64}$`), unanchored
// so it finds a token inside text. Not imported: this package does not depend on threshold.
const MCP_TOKEN = /gmcp-[0-9a-f]{64}/g;
// `Bearer <run>`: the word must start at a word boundary, and a non-space run must follow.
// Case-sensitive on purpose: the scheme is written `Bearer`, and lower-case prose ("the bearer of") stays.
const BEARER = /\b(?:Bearer|BEARER)\s+[^\s"',;]+/g;
// An Authorization header value, up to the end of the line.
const AUTH_HEADER = /\bAuthorization\s*:[^\r\n]*/gi;
// URL userinfo: `scheme://user:pass@`. The password part is required, so a plain `a@b` is untouched.
// The scheme is left-anchored (no letter, digit, + . - before it) and at most 32 characters, so a long
// run with no `://` is rejected in constant time per start instead of rescanned from every position.
const URL_USERINFO = /(?<![a-z0-9+.-])([a-z][a-z0-9+.-]{0,31}:\/\/)[^\s/@:]*:[^\s/@]*@/gi;

/** The text with bearer strings, Authorization values, MCP tokens and URL userinfo replaced. */
export function scrubText(text: string): string {
  return text
    .replace(AUTH_HEADER, REDACTED)
    .replace(BEARER, REDACTED)
    .replace(MCP_TOKEN, REDACTED)
    .replace(URL_USERINFO, `$1${REDACTED}@`);
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
  if (value === null || typeof value !== 'object') return value;
  if (ancestors.has(value)) return CYCLE_MARK;
  if (depth >= MAX_REDACT_DEPTH) return TRUNCATED_MARK;
  ancestors.add(value);
  try {
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
