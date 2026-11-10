/**
 * The file calls of the Glass commands, and the log rules: rotation at start, and the byte-capped tail `logs` prints.
 * Tests inject an in-memory `GlassFs`; `PRODUCTION_FS` is node:fs.
 */
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';

export interface GlassFs {
  exists(path: string): boolean;
  size(path: string): number;
  /** Reads up to `length` bytes from `start`, decoded as UTF-8. */
  read(path: string, start: number, length: number): string;
  /** The whole file as text, or null when it does not exist. */
  readText(path: string): string | null;
  writeText(path: string, text: string): void;
  remove(path: string): void;
  rename(from: string, to: string): void;
  mkdir(path: string): void;
}

/** `logs` reads at most this many bytes from the end of the log. */
export const TAIL_BYTES = 64 * 1024;
/** A log over this size is renamed to `<name>.1` when Glass starts; one old file is kept. */
export const LOG_CAP_BYTES = 5 * 1024 * 1024;

export const PRODUCTION_FS: GlassFs = {
  exists: (path) => existsSync(path),
  size: (path) => statSync(path).size,
  read(path, start, length) {
    const fd = openSync(path, 'r');
    try {
      const buffer = Buffer.alloc(length);
      const got = readSync(fd, buffer, 0, length, start);
      return buffer.subarray(0, got).toString('utf8');
    } finally {
      closeSync(fd);
    }
  },
  readText: (path) => (existsSync(path) ? readFileSync(path, 'utf8') : null),
  writeText: (path, text) => writeFileSync(path, text),
  remove: (path) => rmSync(path, { force: true }),
  rename: (from, to) => renameSync(from, to),
  mkdir: (path) => mkdirSync(path, { recursive: true }),
};

/** Renames a log over `capBytes` to `<path>.1`, replacing the old `.1`. Returns true when it rotated. */
export function rotateLog(fs: GlassFs, path: string, capBytes = LOG_CAP_BYTES): boolean {
  if (!fs.exists(path) || fs.size(path) <= capBytes) return false;
  fs.rename(path, `${path}.1`);
  return true;
}

/**
 * The lines of the last `maxBytes` of a log. A partial first line (the read began mid-line) is dropped, so the
 * output never starts with a fragment.
 */
export function tailBytes(fs: GlassFs, path: string, maxBytes = TAIL_BYTES): string[] {
  const size = fs.size(path);
  const start = Math.max(0, size - maxBytes);
  let text = fs.read(path, start, size - start);
  if (start > 0) {
    const cut = text.indexOf('\n');
    if (cut >= 0) text = text.slice(cut + 1);
  }
  if (text.endsWith('\n')) text = text.slice(0, -1);
  return text === '' ? [] : text.split('\n');
}
