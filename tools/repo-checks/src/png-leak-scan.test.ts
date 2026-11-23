import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  findPngLeaks,
  GENERATED_PNGS,
  PNG_OUTSIDE_DOCS,
  pngLeaksIn,
  SKIN_PNG_PATH,
} from './png-leak-scan.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SOURCE = resolve(root, 'tools', 'players-cli', 'src', 'leak-scan.ts');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const dirs: string[] = [];

/** A fresh git repository with no commits: enough for `ls-files`, and never this checkout. */
function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'p899-'));
  dirs.push(dir);
  execFileSync('git', ['init', '-q'], { cwd: dir });
  return dir;
}

function write(dir: string, path: string, bytes: Buffer | string): void {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), bytes);
}

function git(dir: string, args: string[]): void {
  execFileSync('git', args, { cwd: dir });
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('findPngLeaks', () => {
  it('flags a skin PNG by path, wherever it sits', () => {
    expect(
      findPngLeaks([{ path: 'skins/jason.png' }, { path: 'docs/art/skins/zack.PNG' }]),
    ).toEqual(['skins/jason.png', 'docs/art/skins/zack.PNG']);
  });

  it('flags a PNG outside docs/ and passes a PNG under docs/', () => {
    const paths = ['glass/public/x.png', 'docs/diagram.png', 'tools/x/face.PNG'];
    expect(findPngLeaks(paths.map((path) => ({ path })))).toEqual([
      'glass/public/x.png',
      'tools/x/face.PNG',
    ]);
  });

  it('excuses a generated PNG only at its own path and with its own bytes', () => {
    const [path, sha256] = [...GENERATED_PNGS][0] as [string, string];
    expect(findPngLeaks([{ path, sha256 }])).toEqual([]);
    expect(findPngLeaks([{ path, sha256: 'f'.repeat(64) }])).toEqual([path]);
    expect(findPngLeaks([{ path }])).toEqual([path]);
    const neighbour = `glass/public/icons/skins/${path.split('/').pop()}`;
    expect(findPngLeaks([{ path: neighbour, sha256 }])).toEqual([neighbour]);
  });
});

describe('pngLeaksIn (git-listed files)', () => {
  it('reports an untracked PNG outside docs/ before it is added', () => {
    const dir = makeRepo();
    write(dir, 'glass/public/x.png', PNG);
    expect(pngLeaksIn(dir)).toEqual(['glass/public/x.png']);
  });

  it('reports the same PNG once it is staged, as the old tracked-only scan did', () => {
    const dir = makeRepo();
    write(dir, 'glass/public/x.png', PNG);
    git(dir, ['add', 'glass/public/x.png']);
    expect(pngLeaksIn(dir)).toEqual(['glass/public/x.png']);
  });

  it('reports a skin PNG under skins/ that is untracked', () => {
    const dir = makeRepo();
    write(dir, 'skins/jason.png', PNG);
    expect(pngLeaksIn(dir)).toEqual(['skins/jason.png']);
  });

  it('does not report an untracked PNG under docs/', () => {
    const dir = makeRepo();
    write(dir, 'docs/diagram.png', PNG);
    expect(pngLeaksIn(dir)).toEqual([]);
  });

  it('does not report an ignored PNG, which git never lists as untracked', () => {
    const dir = makeRepo();
    write(dir, '.gitignore', 'local/\n');
    write(dir, 'local/x.png', PNG);
    git(dir, ['add', '.gitignore']);
    expect(pngLeaksIn(dir)).toEqual([]);
  });

  it('passes a tree with no PNG outside docs/', () => {
    const dir = makeRepo();
    write(dir, 'README.md', 'hello\n');
    write(dir, 'docs/a.png', PNG);
    git(dir, ['add', '-A']);
    expect(pngLeaksIn(dir)).toEqual([]);
  });

  it('reports a tracked PNG deleted from disk without throwing', () => {
    const dir = makeRepo();
    write(dir, 'glass/y.png', PNG);
    git(dir, ['add', '-A']);
    rmSync(join(dir, 'glass/y.png'));
    expect(pngLeaksIn(dir)).toEqual(['glass/y.png']);
  });
});

describe('the repository checkout', () => {
  it('has no PNG outside docs/ that is tracked or untracked-and-not-ignored', () => {
    expect(pngLeaksIn(root)).toEqual([]);
  });

  it('mirrors the rule of tools/players-cli/src/leak-scan.ts', () => {
    const source = readFileSync(SOURCE, 'utf8');
    for (const re of [SKIN_PNG_PATH, PNG_OUTSIDE_DOCS]) expect(source).toContain(re.source);
    for (const [path, hash] of GENERATED_PNGS) {
      expect(source).toContain(path);
      expect(source).toContain(hash);
    }
  });
});
