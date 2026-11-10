import { closeSync, existsSync, openSync, readSync, renameSync, statSync } from 'node:fs';

/** The file calls the log code makes. Tests inject a fake; production uses the node:fs calls below. */
export interface LogFs {
  exists(path: string): boolean;
  size(path: string): number;
  /** Reads up to `length` bytes from `start`, decoded as UTF-8. */
  read(path: string, start: number, length: number): string;
  rename(from: string, to: string): void;
}

export const PRODUCTION_LOG_FS: LogFs = {
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
  rename: (from, to) => renameSync(from, to),
};

/** `players logs` reads at most this many bytes from the end of each log. */
export const TAIL_BYTES = 64 * 1024;
/** A log over this size is renamed to `<name>.1` when its ranger starts; one old file is kept. */
export const LOG_CAP_BYTES = 5 * 1024 * 1024;

/**
 * The last `count` whole lines of a log, reading only the last `maxBytes` of the file. A partial first line
 * (the read began mid-line) is dropped, so the output never starts with a fragment.
 */
export function tailLines(fs: LogFs, path: string, count: number, maxBytes = TAIL_BYTES): string[] {
  const size = fs.size(path);
  const start = Math.max(0, size - maxBytes);
  let text = fs.read(path, start, size - start);
  if (start > 0) {
    const cut = text.indexOf('\n');
    text = cut < 0 ? '' : text.slice(cut + 1);
  }
  if (text.endsWith('\n')) text = text.slice(0, -1);
  return text === '' ? [] : text.split('\n').slice(-count);
}

/** Renames a log over `capBytes` to `<path>.1`, replacing the old `.1`. Returns true when it rotated. */
export function rotateLog(fs: LogFs, path: string, capBytes = LOG_CAP_BYTES): boolean {
  if (!fs.exists(path) || fs.size(path) <= capBytes) return false;
  fs.rename(path, `${path}.1`);
  return true;
}
