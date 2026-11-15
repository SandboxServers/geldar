import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

/** The class of one MCP connection. Only an instinct connection marks its sovereign calls. */
export type ConnectionSource = 'model' | 'instinct';

/** The request header that carries the instinct key. Node lower-cases header names. */
export const INSTINCT_HEADER = 'x-geldar-instinct-key';

/** A shorter instinct key is refused: the class stays off and the log says so, never the key. */
export const INSTINCT_KEY_MIN_BYTES = 32;

/** What the key file yields: no class (`off`), a key too short to use (`refused`), or a usable key. */
export type InstinctKeyLoad = { outcome: 'off' | 'refused' } | { outcome: 'ok'; key: Buffer };

/**
 * The instinct key from the file's text, read as the pepper is: one trailing LF or CRLF removed and
 * nothing else. An empty file is off, as an unset variable is. The result never carries the text
 * in a message; the caller logs only the outcome.
 */
export function loadInstinctKey(text: string): InstinctKeyLoad {
  const key = text.replace(/\r?\n$/, '');
  if (key === '') return { outcome: 'off' };
  const bytes = Buffer.from(key, 'utf8');
  if (bytes.length < INSTINCT_KEY_MIN_BYTES) return { outcome: 'refused' };
  return { outcome: 'ok', key: bytes };
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
