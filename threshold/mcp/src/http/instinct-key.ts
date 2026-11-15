import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

/** The class of one MCP connection. Only an instinct connection marks its sovereign calls. */
export type ConnectionSource = 'model' | 'instinct';

/** The request header that carries the instinct key. Node lower-cases header names. */
export const INSTINCT_HEADER = 'x-geldar-instinct-key';

/** A shorter instinct key is refused: the class stays off and the log says so, never the key. */
export const INSTINCT_KEY_MIN_BYTES = 32;

/** What the key file yields: a usable key, or a file that cannot be one (the server then refuses to start). */
export type InstinctKeyLoad = { outcome: 'refused' } | { outcome: 'ok'; key: Buffer };

/**
 * Printable ASCII with no edge space: a header value trims its edges, and a BOM, a control byte or a
 * non-ASCII byte could never match the presented key, so such a key is refused, not loaded.
 */
const USABLE_KEY = /^[\x21-\x7e](?:[\x20-\x7e]*[\x21-\x7e])?$/;

/**
 * The instinct key from the file's text, read as the pepper is: one trailing LF or CRLF removed and
 * nothing else. Empty, short or unusable text is refused. The result never carries the text in a
 * message; the caller names only the variable.
 */
export function loadInstinctKey(text: string): InstinctKeyLoad {
  const key = text.replace(/\r?\n$/, '');
  if (!USABLE_KEY.test(key) || key.length < INSTINCT_KEY_MIN_BYTES) return { outcome: 'refused' };
  return { outcome: 'ok', key: Buffer.from(key, 'ascii') };
}

/** SHA-256 of a value. Both sides of the compare are digests, so their lengths always match. */
function digestOf(value: Buffer | string): Buffer {
  return createHash('sha256').update(value).digest();
}

/** Whether a presented key is the instinct key, compared in constant time over the digests. */
export function sameKey(presented: string, key: Buffer): boolean {
  return timingSafeEqual(digestOf(presented), digestOf(key));
}

/**
 * The class a connection has, from its raw headers. Absent, repeated, wrong or different-length
 * values are `model`; so is every connection when no key is loaded. Raw headers are read because
 * Node joins a repeated custom header into one string, which would hide the repeat.
 */
export function connectionSource(
  req: Pick<IncomingMessage, 'rawHeaders'>,
  key: Buffer | undefined,
): ConnectionSource {
  if (key === undefined) return 'model';
  const raw = req.rawHeaders ?? [];
  const values: string[] = [];
  for (let index = 0; index + 1 < raw.length; index += 2) {
    if (raw[index]?.toLowerCase() === INSTINCT_HEADER) values.push(raw[index + 1] ?? '');
  }
  const [only] = values;
  if (values.length !== 1 || only === undefined) return 'model';
  return sameKey(only, key) ? 'instinct' : 'model';
}
