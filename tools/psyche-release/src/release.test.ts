import { execFileSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ENGINE_VERSION } from '../../../psyche/src/version.ts';
import { buildRelease, REPO_ROOT, renderRelease } from './cli.ts';
import { treeHash } from './tree-hash.ts';

const CLI = fileURLToPath(new URL('./cli.ts', import.meta.url));
const PSYCHE_SRC = join(REPO_ROOT, 'psyche/src');
const RELEASE_JSON = join(REPO_ROOT, 'psyche/RELEASE.json');
const FIXTURE = fileURLToPath(new URL('../test/fixture', import.meta.url));

/**
 * The pinned vector: four files in test/fixture, one nested, two with non-ASCII names.
 * UTF-8 byte order puts U+FF5E (EF BD 9E) before U+1F600 (F0 9F 98 80); UTF-16 order
 * would reverse them, so this pins the sort. The hash was checked against an
 * independent SHA-256 computation over the same bytes.
 */
const PINNED_PATHS = ['alpha.txt', 'nested/beta.txt', '～.txt', '\u{1F600}.txt'];
const PINNED_TREE_HASH = '593faa053405392920c2b41d9d64574b0a29f2faf78cdfaff6acf64e7c2a5a51';

/**
 * One file, `lone.txt`, with bytes `a\rb\r\nc\r\r\nd`. Only the two CRLFs become LF,
 * so the content is `a\rb\nc\r\nd` (SHA-256 f37726c2...). The tree hash is the SHA-256
 * of `lone.txt\0<that sha>\n`. Both were computed with PowerShell Get-FileHash over
 * the exact bytes, not with Node.
 */
const LONE_CR_TREE_HASH = '838418ee0292c3a0fda6085dc3154e3feace0d64e96f054355fac477ad851f99';

describe('psyche release record', () => {
  it('matches the recorded tree hash', () => {
    const recorded = JSON.parse(readFileSync(RELEASE_JSON, 'utf8')) as {
      tree_hash: string;
      files: { path: string; sha256: string }[];
    };
    const fresh = treeHash(PSYCHE_SRC);
    expect(recorded.tree_hash).toBe(fresh.tree_hash);
    expect(recorded.files).toEqual(fresh.files);
  });

  it('is the record rendered from psyche/src, byte for byte', () => {
    expect(readFileSync(RELEASE_JSON, 'utf8')).toBe(renderRelease(buildRelease(REPO_ROOT)));
  });

  it('agrees with the package name and version, the engine version and the tag', () => {
    const record = JSON.parse(readFileSync(RELEASE_JSON, 'utf8')) as Record<string, unknown>;
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'psyche/package.json'), 'utf8')) as {
      name: string;
      version: string;
    };
    expect(record.name).toBe(pkg.name);
    expect(record.version).toBe(pkg.version);
    expect(record.engine_version).toBe(ENGINE_VERSION);
    expect(record.tag).toBe(`psyche-v${pkg.version}`);
    expect(record.tree_hash_algorithm).toBe('geldar-tree-v1');
  });

  it('passes the CLI --check gate on the committed record', () => {
    // execFileSync throws on a non-zero exit, so a stale record fails this test.
    execFileSync(process.execPath, [CLI, '--check'], { stdio: 'pipe' });
  });
});

describe('geldar-tree-v1 pinned vector', () => {
  it('matches the pinned paths, order and tree hash', () => {
    const tree = treeHash(FIXTURE);
    expect(tree.files.map((file) => file.path)).toEqual(PINNED_PATHS);
    expect(tree.tree_hash).toBe(PINNED_TREE_HASH);
  });

  it('hashes a CRLF copy of the fixture the same', () => {
    const copy = mkdtempSync(join(tmpdir(), 'psyche-release-crlf-'));
    try {
      for (const file of treeHash(FIXTURE).files) {
        const target = join(copy, file.path);
        mkdirSync(dirname(target), { recursive: true });
        const text = readFileSync(join(FIXTURE, file.path), 'utf8');
        writeFileSync(target, text.replace(/\n/g, '\r\n'));
      }
      expect(treeHash(copy).tree_hash).toBe(PINNED_TREE_HASH);
    } finally {
      rmSync(copy, { recursive: true, force: true });
    }
  });

  it('keeps a copy of the fixture at the same tree hash', () => {
    const copy = mkdtempSync(join(tmpdir(), 'psyche-release-copy-'));
    try {
      cpSync(FIXTURE, copy, { recursive: true });
      expect(treeHash(copy).tree_hash).toBe(PINNED_TREE_HASH);
    } finally {
      rmSync(copy, { recursive: true, force: true });
    }
  });
});

describe('geldar-tree-v1 edge rules', () => {
  it('turns only CRLF into LF, so a lone CR is kept', () => {
    const dir = mkdtempSync(join(tmpdir(), 'psyche-release-cr-'));
    try {
      writeFileSync(join(dir, 'lone.txt'), Buffer.from('a\rb\r\nc\r\r\nd', 'latin1'));
      expect(treeHash(dir).tree_hash).toBe(LONE_CR_TREE_HASH);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses a symlink instead of skipping it', (ctx) => {
    const dir = mkdtempSync(join(tmpdir(), 'psyche-release-link-'));
    try {
      writeFileSync(join(dir, 'target.txt'), 'x');
      try {
        symlinkSync(join(dir, 'target.txt'), join(dir, 'link.txt'));
      } catch (error) {
        // Windows without developer mode or the symlink privilege refuses the link.
        ctx.skip(`symlink creation is denied here: ${(error as Error).message}`);
      }
      expect(() => treeHash(dir)).toThrow(/not a regular file/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
