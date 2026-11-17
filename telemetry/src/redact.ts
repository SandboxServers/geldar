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
  /** Characters of string content taken so far in this call (scrubbed or omitted). */
  chars: number;
}
/** The most string characters scrubbed in one redactContent call; later strings become `[omitted N chars]`. */
const MAX_REDACT_CHARS = 4 * 1024 * 1024;
const UNREADABLE_MARK = '[unreadable]';

// Mirrors TOKEN_PATTERN in threshold/mcp/src/store/token-hash.ts (`^gmcp-[0-9a-f]{64}$`), unanchored
// so it finds a token inside text. Not imported: this package does not depend on threshold.
const MCP_TOKEN = /gmcp-[0-9a-f]{64}/g;
// An Authorization or Proxy-Authorization header (also as a quoted JSON pair, `"Authorization":"..."`).
// Group 1 is the head up to the value. The value is either a scheme (Basic, Bearer, Token, Digest,
// Negotiate, NTLM) and the rest up to a quote or the end of the line, or a bare run of 16 or more
// token characters with at least one digit or symbol. Prose such as `authorization: grants access` stays.
const AUTH_HEADER =
  /\b((?:Proxy-)?Authorization\\*["']?[ \t]*[:=][ \t]*\\*["']?)(?:(?:Basic|Bearer|Token|Negotiate|NTLM)[ \t]+[^\r\n"'\\]*|(?:Digest|AWS4-HMAC-SHA256)[ \t]+[^\r\n]*|(?=[A-Za-z0-9._~+/=-]{16})(?=[A-Za-z0-9._~+/=-]*[\d._~+/=])[A-Za-z0-9._~+/=-]+)/gi;
// `bearer <run>` (also `Bearer: <run>` and `Bearer "<run>"`), case-insensitive because HTTP schemes are.
// The run is 6 or more characters and ends at a space, quote, comma or semicolon. `Bearer` or `BEARER`
// redacts any such run; another case redacts only a run with a digit or `_~+/=` or one of 20+ characters,
// so `the bearer of bad news` and `bearer wisdom` stay.
// `{6}` then `*`, not `{6,}`: V8 pushes a backtrack frame per iteration of a counted greedy loop, so
// `{6,}` throws RangeError (regex stack) on a run of about 5.5 MiB.
const BEARER = /\b(bearer)(?:[ \t]*[:=][ \t]*|[ \t]+)(["']?)([^\s"',;]{6}[^\s"',;]*)/gi;
const BEARER_PROOF = /[\d_~+/=-]/;
// URL userinfo: `scheme://user:pass@`. The password part is required, so a plain `a@b` is untouched, and
// it runs to the last `@` before the next `/` or space, so `u:p@ss@host` hides `ss` too. The scheme is
// left-anchored (no letter, digit, + . - before it) and at most 32 characters, so a long run with no
// `://` is rejected in constant time per start instead of rescanned from every position.
const URL_USERINFO = /([a-z][a-z0-9+.-]{0,31}:\/\/)[^\s/@:]*:[^\s/]*@/gi;
// A bare JWT: three base64url segments, the first starting `eyJ` (`{"`). Starts only at a run start
// (the lookbehind), so a long run is tried once; `{8}` then `*` for the same stack reason as BEARER.
const JWT = /(?<![\w-])eyJ[\w-]{5}[\w-]*\.[\w-]{8}[\w-]*\.[\w-]*/g;
const PEM_HEADER = /-----BEGIN [A-Z ]{0,40}PRIVATE KEY-----/y;
const PEM_FOOTER = 'PRIVATE KEY-----';

/**
 * PEM private key blocks: from the BEGIN line to the END line, or to the end of the text when the END
 * line is missing (a cut capture). A manual scan with `indexOf`: each block is consumed once, so it is linear.
 */
function scrubPem(text: string): string {
  let from = text.indexOf('-----BEGIN ');
  if (from < 0) return text;
  let out = '';
  let last = 0;
  while (from >= 0) {
    PEM_HEADER.lastIndex = from;
    const header = PEM_HEADER.exec(text);
    if (!header) {
      from = text.indexOf('-----BEGIN ', from + 1);
      continue;
    }
    const footer = text.indexOf(PEM_FOOTER, from + header[0].length);
    const stop = footer < 0 ? text.length : footer + PEM_FOOTER.length;
    out += text.slice(last, from) + REDACTED;
    last = stop;
    from = text.indexOf('-----BEGIN ', stop);
  }
  return out + text.slice(last);
}

// Free-text `key=value` and `key: value` (also `"key":"value"`). The scan matches only `key + separator`
// (never the value), so a non-credential key such as `https` cannot swallow `//host/cb?token=...`; the
// value is read, with a sticky regex, only for a credential key. The key starts at a key boundary (no word
// character, dot or hyphen before it, optionally after `--`) and has no length cap: only run starts are
// tried, so the scan stays linear.
const KEY_SEP = /(?<![\w.-])(?:--)?([A-Za-z][\w.-]*)(\\*["']?[ \t]*[=:][ \t]*\\*["']?)/g;
const KEY_HINT = /token|pass|secret|key|cookie|signature|session|jwt|auth/i;
/** Whole credential words: a key is a credential only when one of its segments says so (not `secretary`, `cookies`, `tokens`). */
const CREDENTIAL_WORDS: ReadonlySet<string> = new Set([
  'password',
  'passwd',
  'passphrase',
  'secret',
  'token',
  'cookie',
  'apikey',
  'signature',
  'jwt',
  'auth',
]);
/** Two adjacent segments that together name a credential (`api_key`, `private_key`, `secret_key`). */
const CREDENTIAL_PAIRS: ReadonlySet<string> = new Set([
  'apikey',
  'privatekey',
  'secretkey',
  'accesskey',
  'signingkey',
  'sshkey',
  'sessionid',
  'accountkey',
]);
const COOKIE_KEY = /(?:^|[._-])cookie$/i;
/** A cookie header value in `name=value` form: the rest of the line. */
const COOKIE_PAIRS = /[^\s=;"']+=[^\r\n]*/y;
/** An unquoted value: up to whitespace, a quote, `&`, `,`, `;`, `)` or `}`. */
const VALUE_RUN = /[^\s"'&,;)}\\]+/y;
/** The most characters read for one quoted value; an unclosed quote costs at most this much. */
const MAX_QUOTED_VALUE = 8192;

/**
 * The length of a quoted value starting at `from`, or -1 when no closing quote is found on the same line
 * within MAX_QUOTED_VALUE characters. The closing quote is escape-aware: `closer` is the number of
 * backslashes the closing quote carries in this text (0 in plain JSON, 1 in JSON inside a JSON string,
 * 3 one level deeper). A literal backslash takes 2*(closer+1) characters, so a quote closes the value
 * when the backslash run before it is `closer` modulo 2*(closer+1); any other run is an escaped quote
 * inside the value. A value that ends in a backslash still closes. One pass, no backtracking.
 */
function quotedLength(text: string, from: number, quote: string, closer: number): number {
  const unit = 2 * (closer + 1);
  const limit = Math.min(text.length, from + MAX_QUOTED_VALUE + closer + 1);
  let run = 0;
  for (let i = from; i < limit; i++) {
    const c = text.charAt(i);
    if (c === '\\') run++;
    else if (c === quote) {
      if (run % unit === closer) return i - from - closer;
      run = 0;
    } else if (c === '\n' || c === '\r') return -1;
    else run = 0;
  }
  return -1;
}

/** A credential key in free text: the last segment is a credential word, or the last two make one. */
function credentialKey(key: string): boolean {
  if (!KEY_HINT.test(key)) return false;
  const seg = key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split(/[._-]/)
    .filter((part) => part !== '');
  const last = seg[seg.length - 1];
  if (last === undefined) return false;
  if (CREDENTIAL_WORDS.has(last)) return true;
  const before = seg[seg.length - 2];
  if (before !== undefined && CREDENTIAL_PAIRS.has(before + last)) return true;
  return last === 'key' && seg.includes('secret');
}

/** A plain single word (`north`, `swordfish`, `Alexander`): lower-case letters, shorter than 12. */
function plainWord(value: string): boolean {
  return value.length < 12 && /^[A-Za-z][a-z]*$/.test(value);
}

/** An unquoted value that looks like a secret: 8 or more characters and not a plain word. */
function looksSecret(value: string): boolean {
  return value.length >= 8 && !plainWord(value);
}

/** Up to 512 characters, so a long run with many keys in it is not rescanned to its end for each key. */
const WHITESPACE_RUN = /[^\s]{1,512}/y;
const DIGIT_AND_LETTER = /^(?=.*\d)(?=.*[A-Za-z])/;
const TRAILING_PUNCTUATION = ',;.)}]';

/** True when a quote at `at` ends the run: nothing follows it, or one of `, ; ) } ]` does. */
function closesAfter(run: string, at: number): boolean {
  return at + 1 >= run.length || ',;)}]'.includes(run.charAt(at + 1));
}

/** True when `,name=value` (or `;`, `&`) starts at `at`: a delimiter, an identifier, `=` and a value that is not another `=`. */
function pairStartsAt(run: string, at: number): boolean {
  let i = at + 1;
  const first = run.charCodeAt(i);
  // A letter or underscore starts the name; after that letters, digits, `_`, `.` and `-` continue it.
  if (!((first >= 65 && first <= 90) || (first >= 97 && first <= 122) || first === 95))
    return false;
  for (i++; i < run.length; i++) {
    const c = run.charCodeAt(i);
    const word = (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
    if (!(word || c === 95 || c === 46 || c === 45)) break;
  }
  return run.charAt(i) === '=' && i + 1 < run.length && run.charAt(i + 1) !== '=';
}

/**
 * The value of an unquoted credential `key=value` read to the next whitespace (at most 512 characters), so a
 * delimiter inside it (`password=Zq9x,K2mP7vL4Ab`) does not end it. The run is cut where another pair starts
 * (`,user=bob`) and, after a quoted key, at the first quote (`"token":5,"other":"x"`); trailing `, ; . ) } ]`
 * are not part of it. Returns the length to hide: the whole run when it is longer than the first segment
 * and looks secret as a whole (8 or more characters and not a plain word, or a digit and a letter), else 0.
 */
function delimitedSecretLength(text: string, end: number, run: string, quotedKey: boolean): number {
  WHITESPACE_RUN.lastIndex = end;
  const whole = WHITESPACE_RUN.exec(text)?.[0] ?? '';
  if (whole.length <= run.length || /["']/.test(whole.charAt(0))) return 0;
  let stop = whole.length;
  for (let i = run.length; i < whole.length; i++) {
    const c = whole.charAt(i);
    if ((c === '"' || c === "'") && (quotedKey || closesAfter(whole, i))) {
      stop = i;
      break;
    }
    if ((c === ',' || c === ';' || c === '&') && pairStartsAt(whole, i)) {
      stop = i;
      break;
    }
  }
  if (quotedKey) while (stop > 0 && whole.charAt(stop - 1) === '\\') stop--;
  while (stop > 0 && TRAILING_PUNCTUATION.includes(whole.charAt(stop - 1))) stop--;
  if (stop <= run.length) return 0;
  const value = whole.slice(0, stop);
  return looksSecret(value) || DIGIT_AND_LETTER.test(value) ? stop : 0;
}
// A command-line flag whose value follows after whitespace: `--password VALUE` (and passwd, token, secret,
// api-key, apikey), or curl's `-u` / `--user` with `name:secret`. The head must be followed by a space or
// tab, so `--password-file /x`, `--secret-name abc` and `--token=...` (the key=value rule) do not match.
const FLAG_HEAD =
  /(?<![\w.-])(?:--(?:password|passwd|token|secret|api-key|apikey)|-u|--user)(?=[ \t])/gi;
const FLAG_VALUE = /[^\s]+/y;
const MAX_FLAG_GAP = 64;

/** The text with the value after a credential flag replaced. Heads are run starts and each value is read once: linear. */
function scrubFlags(text: string): string {
  let out = '';
  let last = 0;
  FLAG_HEAD.lastIndex = 0;
  for (let m = FLAG_HEAD.exec(text); m; m = FLAG_HEAD.exec(text)) {
    const head = m[0];
    const lower = head.toLowerCase();
    const user = lower === '-u' || lower === '--user';
    if (user && head !== lower) continue;
    let at = m.index + head.length;
    const gapEnd = at + MAX_FLAG_GAP;
    while (at < text.length && at < gapEnd && (text.charAt(at) === ' ' || text.charAt(at) === '\t'))
      at++;
    const quote = text.charAt(at);
    const quoted = quote === '"' || quote === "'";
    let start = quoted ? at + 1 : at;
    let length = 0;
    if (quoted) length = Math.max(quotedLength(text, start, quote, 0), 0);
    else {
      FLAG_VALUE.lastIndex = start;
      length = FLAG_VALUE.exec(text)?.[0].length ?? 0;
    }
    if (length === 0 || text.charAt(start) === '-') continue;
    if (!quoted)
      while (length > 0 && TRAILING_PUNCTUATION.includes(text.charAt(start + length - 1))) length--;
    let value = text.slice(start, start + length);
    if (user) {
      // `name:secret`, the secret not starting with `/` (so `-u origin:/x` and `-u http://h` stay).
      const colon = value.indexOf(':');
      if (colon < 1 || colon === value.length - 1 || value.charAt(colon + 1) === '/') continue;
      start += colon + 1;
      length -= colon + 1;
      value = value.slice(colon + 1);
    }
    if (!(looksSecret(value) || DIGIT_AND_LETTER.test(value))) continue;
    out += text.slice(last, start) + REDACTED;
    last = start + length;
    FLAG_HEAD.lastIndex = last;
  }
  return out + text.slice(last);
}

/** Query keys whose value is a credential whatever it looks like (`sig`, `X-Amz-Credential`, `X-Amz-Signature`). */
const QUERY_CREDENTIAL_KEYS: ReadonlySet<string> = new Set([
  'sig',
  'x-amz-credential',
  'x-amz-signature',
]);
/** Query keys that are credentials only with a long value (`?code=404` and `?key=name` stay). */
const QUERY_LONG_KEYS: ReadonlySet<string> = new Set(['key', 'code']);
const MIN_QUERY_SECRET = 16;

/** True when `key` after `?` or `&` is a credential query parameter whose value starts at `end`. */
function queryCredential(key: string, text: string, end: number): boolean {
  const lower = key.toLowerCase();
  if (QUERY_CREDENTIAL_KEYS.has(lower)) return true;
  if (!QUERY_LONG_KEYS.has(lower)) return false;
  VALUE_RUN.lastIndex = end;
  const run = VALUE_RUN.exec(text)?.[0] ?? '';
  return run.length >= MIN_QUERY_SECRET && looksSecret(run);
}

/** The text with the value of every credential `key=value` / `key: value` pair replaced. One linear pass. */
function scrubKeyValues(text: string): string {
  let out = '';
  let last = 0;
  KEY_SEP.lastIndex = 0;
  for (let m = KEY_SEP.exec(text); m; m = KEY_SEP.exec(text)) {
    const end = m.index + m[0].length;
    const key = m[1] as string;
    const sep = m[2] as string;
    const prev = m.index > 0 ? text.charAt(m.index - 1) : '';
    const inQuery = (prev === '?' || prev === '&') && sep === '=';
    if (!credentialKey(key) && !(inQuery && queryCredential(key, text, end))) continue;
    // A URL query parameter or a command-line flag: the value is a credential whatever it looks like.
    const flagOrQuery = m[0].startsWith('--') || prev === '?' || prev === '&';
    let length = 0;
    let whole = false;
    // A cookie header (`Cookie: a=1; session=abcd`, `Set-Cookie: ...`) runs to the end of the line.
    if (COOKIE_KEY.test(key)) {
      COOKIE_PAIRS.lastIndex = end;
      length = COOKIE_PAIRS.exec(text)?.[0].length ?? 0;
      whole = length > 0;
    }
    // A quoted value runs to the closing quote (spaces included) only in a structured position: a quoted
    // key (`"password":"..."`), `=` (`password="..."`) or a query. After a prose `password: "` it is a word.
    const quote = sep.endsWith('"') ? '"' : sep.endsWith("'") ? "'" : '';
    if (!whole && quote && (/^\\*["']/.test(sep) || sep.includes('=') || flagOrQuery)) {
      // The backslashes in front of the opening quote are the ones the closing quote carries too.
      const closer = (/(\\*)["']$/.exec(sep)?.[1] ?? '').length;
      length = Math.max(quotedLength(text, end, quote, closer), 0);
      whole = length > 0;
    }
    if (!whole) {
      VALUE_RUN.lastIndex = end;
      const run = VALUE_RUN.exec(text)?.[0] ?? '';
      const extended = delimitedSecretLength(text, end, run, /^\\*["']/.test(sep));
      length = extended > 0 ? extended : flagOrQuery || looksSecret(run) ? run.length : 0;
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
    scrubFlags(scrubPem(text))
      .replace(AUTH_HEADER, (match, head: string) => {
        if (!/["']/.test(head)) return REDACTED;
        // A quoted pair (JSON): the value ends at the closing quote, so a Digest run does not eat the line.
        const value = match.slice(head.length);
        const cut = value.search(/["'\\]/);
        return head + REDACTED + (cut < 0 ? '' : value.slice(cut));
      })
      .replace(JWT, REDACTED)
      .replace(BEARER, (match, word: string, quote: string, run: string) =>
        (
          word === 'Bearer' || word === 'BEARER'
            ? looksSecret(run)
            : BEARER_PROOF.test(run) || run.length >= 20
        )
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
    return redactAt(value, 0, { ancestors: new WeakSet<object>(), nodes: 0, chars: 0 });
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
/** scrubText for one string of a redactContent call: past the call's character budget the string is omitted. */
function scrubBudgeted(text: string, walk: Walk): string {
  walk.chars += text.length;
  return walk.chars > MAX_REDACT_CHARS ? `[omitted ${text.length} chars]` : scrubText(text);
}

/** The characters an Error will cost: message plus stack, each at most MAX_ERROR_TEXT_CHARS. Never throws. */
function errorTextSize(error: Error): number {
  try {
    const stack = typeof error.stack === 'string' ? error.stack.length : 0;
    return (
      Math.min(String(error.message).length, MAX_ERROR_TEXT_CHARS) +
      Math.min(stack, MAX_ERROR_TEXT_CHARS)
    );
  } catch {
    return MAX_ERROR_TEXT_CHARS;
  }
}

/** The `[object String]` style tag, so a boxed primitive of any realm is found; a throwing Proxy trap gives ''. */
function objectTag(value: unknown): string {
  try {
    return Object.prototype.toString.call(value);
  } catch {
    return '';
  }
}

function redactAt(value: unknown, depth: number, walk: Walk): unknown {
  if (typeof value === 'string') return scrubBudgeted(value, walk);
  // A boxed primitive is its primitive: `new String('password=...')` must not be split into one key per character.
  const tag = typeof value === 'object' ? objectTag(value) : '';
  if (tag === '[object String]') return scrubBudgeted(String.prototype.valueOf.call(value), walk);
  if (tag === '[object Number]') return Number.prototype.valueOf.call(value);
  if (tag === '[object Boolean]') return Boolean.prototype.valueOf.call(value);
  // JSON-safe plain data out: a bigint, symbol or function becomes text, never a value JSON.stringify rejects.
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'symbol' || typeof value === 'function')
    return scrubBudgeted(String(value), walk);
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
    // Charge the budget before scrubbing: a bounded size per message and stack (errorFields cuts both at
    // MAX_ERROR_TEXT_CHARS), so an exhausted budget stops the work, not just the output.
    const charge = errorTextSize(value);
    walk.chars += charge;
    if (walk.chars > MAX_REDACT_CHARS) return `[omitted ${charge} chars]`;
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
      // At most MAX_REDACT_NODES elements are read, so a sparse `new Array(1e8)` costs the same as a full one.
      const count = Math.min(value.length, MAX_REDACT_NODES);
      for (let i = 0; i < count; i++) {
        items.push(redactRead(() => value[i], depth + 1, walk));
      }
      if (value.length > count) items.push(TRUNCATED_MARK);
      return items;
    }
    const copy: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      walk.chars += key.length;
      if (walk.chars > MAX_REDACT_CHARS) {
        Object.defineProperty(copy, TRUNCATED_MARK, { value: TRUNCATED_MARK, enumerable: true });
        break;
      }
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
  return `${scrubText(text.slice(0, MAX_ERROR_TEXT_CHARS))}${cutMark(text)}`;
}

function cutMark(text: string): string {
  return `…[truncated ${text.length - MAX_ERROR_TEXT_CHARS} chars]`;
}

/** Text that is already redacted, cut to MAX_ERROR_TEXT_CHARS with the same mark. */
function cutText(text: string): string {
  return text.length <= MAX_ERROR_TEXT_CHARS
    ? text
    : `${text.slice(0, MAX_ERROR_TEXT_CHARS)}${cutMark(text)}`;
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
      text === '[object Object]'
        ? cutText(JSON.stringify(redactContent(error)))
        : scrubBounded(text);
    return { 'exception.type': typeof error, 'exception.message': message };
  } catch {
    return { 'exception.type': 'unknown', 'exception.message': '' };
  }
}
