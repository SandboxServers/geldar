/** Files `.gitattributes` marks CRLF; a CR is correct in them. */
const CRLF_FILES = /\.(bat|cmd)$/i;

/** One tracked text file whose committed (index) content has a stray byte. */
export interface ControlCharFinding {
  path: string;
  /** 1-based line of the first offending byte. */
  line: number;
  /** The offending byte, e.g. 0x0d. */
  byte: number;
}

/**
 * Finds the first byte below 0x20 other than LF and TAB (CR included) in a
 * committed text file. Binary files (any NUL byte) and the `.bat`/`.cmd` files
 * that `.gitattributes` marks CRLF are skipped. Pass the index content, not the
 * working tree, so a local `core.autocrlf` cannot change the verdict.
 */
export function findControlChar(path: string, bytes: Uint8Array): ControlCharFinding | null {
  if (CRLF_FILES.test(path) || bytes.includes(0)) return null;
  let line = 1;
  for (const byte of bytes) {
    if (byte === 0x0a) line++;
    else if (byte < 0x20 && byte !== 0x09) return { path, line, byte };
  }
  return null;
}

/** One tracked path from `git ls-files -s -z`; a gitlink (mode 160000) is a submodule. */
export interface IndexEntry {
  path: string;
  gitlink: boolean;
}

/**
 * Parses `git ls-files -s -z` output (`<mode> <sha> <stage>\t<path>` per NUL).
 * A path with an LF would desync the line-based `cat-file --batch` protocol, so
 * it is rejected loudly. A merge conflict lists a path once per stage.
 */
export function parseIndexEntries(output: string): IndexEntry[] {
  const seen = new Set<string>();
  const entries: IndexEntry[] = [];
  for (const record of output.split('\0')) {
    if (record === '') continue;
    const tab = record.indexOf('\t');
    if (tab < 0) throw new Error(`unexpected ls-files record: ${JSON.stringify(record)}`);
    const path = record.slice(tab + 1);
    if (path.includes('\n')) throw new Error(`path contains a line feed: ${JSON.stringify(path)}`);
    if (seen.has(path)) continue;
    seen.add(path);
    entries.push({ path, gitlink: record.startsWith('160000 ') });
  }
  return entries;
}

/**
 * Splits `git cat-file --batch` output into path to content. The request is one
 * `:<path>` per line, in the order of `entries`. Fails closed: truncated output,
 * a non-integer size, an object type other than `blob`, or a `missing` answer
 * for anything but a gitlink throws, so the check never passes by reading nothing.
 */
export function parseCatFileBatch(entries: IndexEntry[], output: Buffer): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  let offset = 0;
  for (const { path, gitlink } of entries) {
    const end = output.indexOf(0x0a, offset);
    if (end < 0) throw new Error(`cat-file output truncated before ${path}`);
    const header = output.toString('utf8', offset, end);
    offset = end + 1;
    if (header.endsWith(' missing')) {
      if (gitlink) continue;
      throw new Error(`git cannot read the index copy of ${path}`);
    }
    const match = /^\S+ (\S+) (\d+)$/.exec(header);
    if (!match) throw new Error(`unexpected cat-file header for ${path}: ${header}`);
    if (match[1] !== 'blob') throw new Error(`${path} is a ${match[1]}, not a blob`);
    const size = Number(match[2]);
    if (offset + size + 1 > output.length) {
      throw new Error(`cat-file output truncated inside ${path}`);
    }
    files.set(path, output.subarray(offset, offset + size));
    offset += size + 1; // the content is followed by one LF
  }
  return files;
}
