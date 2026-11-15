/**
 * The psyche release record (GX-02). `--write` regenerates `psyche/RELEASE.json`;
 * `--check` exits 1 when the committed file differs from the record rendered now.
 *
 *   node tools/psyche-release/src/cli.ts --write
 *   node tools/psyche-release/src/cli.ts --check
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type TreeFile, treeHash } from './tree-hash.ts';

export const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
export const TREE_HASH_ALGORITHM = 'geldar-tree-v1';

export interface ReleaseRecord {
  format: number;
  name: string;
  version: string;
  engine_version: number;
  tree_hash_algorithm: string;
  tree_hash: string;
  tag: string;
  files: TreeFile[];
}

/** The record for `psyche/src` under `root`: package name and version, engine version, tree hash. */
export function buildRelease(root: string): ReleaseRecord {
  const pkg = JSON.parse(readFileSync(join(root, 'psyche/package.json'), 'utf8')) as {
    name: string;
    version: string;
  };
  const engine = /export const ENGINE_VERSION = (\d+);/.exec(
    readFileSync(join(root, 'psyche/src/version.ts'), 'utf8'),
  );
  if (!engine?.[1]) {
    throw new Error('psyche/src/version.ts does not declare ENGINE_VERSION');
  }
  const tree = treeHash(join(root, 'psyche/src'));
  return {
    format: 1,
    name: pkg.name,
    version: pkg.version,
    engine_version: Number(engine[1]),
    tree_hash_algorithm: TREE_HASH_ALGORITHM,
    tree_hash: tree.tree_hash,
    tag: `psyche-v${pkg.version}`,
    files: tree.files,
  };
}

export function renderRelease(record: ReleaseRecord): string {
  return `${JSON.stringify(record, null, 2)}\n`;
}

function main(args: string[]): number {
  const target = join(REPO_ROOT, 'psyche/RELEASE.json');
  const rendered = renderRelease(buildRelease(REPO_ROOT));
  if (args.includes('--write')) {
    writeFileSync(target, rendered);
    return 0;
  }
  if (args.includes('--check')) {
    const committed = existsSync(target) ? readFileSync(target, 'utf8') : '';
    if (committed === rendered) return 0;
    process.stderr.write(
      'psyche/RELEASE.json does not match psyche/src. Run: node tools/psyche-release/src/cli.ts --write\n',
    );
    return 1;
  }
  process.stderr.write('usage: node tools/psyche-release/src/cli.ts --write | --check\n');
  return 2;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exitCode = main(process.argv.slice(2));
}
