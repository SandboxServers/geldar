/**
 * The `geldar-tree-v1` tree hash (GX-02). The Mind kit reimplements these rules
 * to check its copy of `psyche/src/`, so change them only with a new algorithm name.
 *
 * Rules: every regular file under `dir`, recursively (a symlink is refused, not
 * skipped); the path is relative to `dir` with `/` separators; the content has
 * each CRLF turned into LF (a lone CR is kept); entries are sorted by the UTF-8
 * bytes of the path; `sha256` is lower-case hex of that content; `tree_hash` is the
 * hex SHA-256 of the UTF-8 concatenation of `<path>\0<sha256>\n` for each entry.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

export interface TreeFile {
  path: string;
  sha256: string;
}

export interface TreeHash {
  tree_hash: string;
  files: TreeFile[];
}

/** The regular files under `dir`, as absolute paths. */
function listFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...listFiles(full));
    } else if (entry.isFile()) {
      found.push(full);
    } else {
      throw new Error(`geldar-tree-v1: ${full} is not a regular file or a directory`);
    }
  }
  return found;
}

/** The content with each CRLF turned into LF. Bytes pass through latin1, so none is changed. */
function lfContent(bytes: Buffer): Buffer {
  return Buffer.from(bytes.toString('latin1').replace(/\r\n/g, '\n'), 'latin1');
}

function utf8ByteOrder(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

export function treeHash(dir: string): TreeHash {
  const files: TreeFile[] = listFiles(dir)
    .map((full) => ({ path: relative(dir, full).split(sep).join('/'), full }))
    .sort((a, b) => utf8ByteOrder(a.path, b.path))
    .map(({ path, full }) => ({
      path,
      sha256: createHash('sha256')
        .update(lfContent(readFileSync(full)))
        .digest('hex'),
    }));
  const outer = createHash('sha256');
  for (const file of files) {
    outer.update(`${file.path}\0${file.sha256}\n`, 'utf8');
  }
  return { tree_hash: outer.digest('hex'), files };
}
