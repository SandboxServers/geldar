/**
 * Reads and rotates a service log without loading it whole: a tail reads only its last chunk, a follow reads only
 * what was appended, and a log over the cap is renamed aside before its service starts again.
 */
import { closeSync, existsSync, openSync, readSync, renameSync, statSync } from 'node:fs';

/** `adam logs` reads at most this many bytes from the end of a log. */
export const TAIL_BYTES = 64 * 1024;
/** A log over this size is renamed to `<name>.1` when its service starts; one old copy is kept. */
export const LOG_CAP_BYTES = 5 * 1024 * 1024;

/** The size of a file in bytes (0 when it does not exist). */
export function sizeOf(path: string): number {
  return existsSync(path) ? statSync(path).size : 0;
}

/** Up to `length` bytes of a file from `start`, decoded as UTF-8. One positional read. */
function readAt(path: string, start: number, length: number): string {
  if (length <= 0) return '';
  const fd = openSync(path, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const got = readSync(fd, buffer, 0, length, start);
    return buffer.subarray(0, got).toString('utf8');
  } finally {
    closeSync(fd);
  }
}

/**
 * The text appended after `offset` bytes, and the byte offset it ends at. A file now shorter than `offset` was
 * rotated or replaced, so the read starts at its beginning.
 */
export function readSince(path: string, offset: number): { text: string; end: number } {
  const size = sizeOf(path);
  const from = size < offset ? 0 : offset;
  return { text: readAt(path, from, size - from), end: size };
}

/**
 * The last `lines` lines of a file, reading only its last `maxBytes`. A partial first line (the read began
 * mid-line) is dropped, so the output never starts with a fragment.
 */
export function tailOf(path: string, lines: number, maxBytes = TAIL_BYTES): string {
  const size = sizeOf(path);
  const start = Math.max(0, size - maxBytes);
  let text = readAt(path, start, size - start);
  if (start > 0) {
    const cut = text.indexOf('\n');
    if (cut >= 0) text = text.slice(cut + 1);
  }
  return text
    .split(/\r?\n/)
    .slice(-lines - 1)
    .join('\n');
}

/** Renames a log over `capBytes` to `<path>.1`, replacing the old copy. Returns true when it rotated. */
export function rotateLog(path: string, capBytes = LOG_CAP_BYTES): boolean {
  if (sizeOf(path) <= capBytes) return false;
  renameSync(path, `${path}.1`);
  return true;
}
