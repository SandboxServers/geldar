// Tests for deploy/genesis/prune-deploy-work.sh. The script runs under `sh` against a fixture root (GELDAR_DEPLOY_ROOT)
// with a flock stand-in on PATH (flock is absent on Windows): FAKE_FLOCK_RC=1 makes the lock busy. Nothing real is touched.
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { SH } from './colo-deploy-fixture';

const SCRIPT = fileURLToPath(new URL('../genesis/prune-deploy-work.sh', import.meta.url));
const p = (s: string) => s.replaceAll(String.fromCharCode(92), '/');
const sha = (n: number) => n.toString(16).padStart(40, '0');
const dirs: string[] = [];

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const HEAD = '# Release manifest for the Colo node (decision 0084). Commit ';
const manifest = (commit: string) =>
  `${HEAD}${commit}.
GELDAR_BODY_IMAGE=registry.example.invalid/body@sha256:${'1'.repeat(64)}`;

/** A root with `count` checkouts, sha(1) the oldest and sha(count) the newest, and a live commit. */
function fixture(count: number, live: string | null = manifest(sha(count))) {
  const root = mkdtempSync(join(tmpdir(), 'prune-work-'));
  dirs.push(root);
  mkdirSync(join(root, 'work'));
  mkdirSync(join(root, 'staged'));
  const shim = join(root, 'shim');
  mkdirSync(shim);
  writeFileSync(join(shim, 'flock'), '#!/bin/sh\nexit ${FAKE_FLOCK_RC:-0}\n', { mode: 0o755 });
  for (let i = 1; i <= count; i++) {
    const d = join(root, 'work', sha(i));
    mkdirSync(d);
    writeFileSync(join(d, 'f'), 'x');
    utimesSync(d, 1_700_000_000 + i * 1000, 1_700_000_000 + i * 1000);
  }
  if (live !== null)
    writeFileSync(join(root, 'staged', 'release.env'), `${live}\nSECRET=do-not-print\n`);
  mkdirSync(join(root, 'state'));
  return root;
}

function run(root: string, args: string[] = [], env: Record<string, string> = {}) {
  const r = spawnSync(SH, [p(SCRIPT), ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      GELDAR_DEPLOY_ROOT: p(root),
      GELDAR_STATE_DIR: p(join(root, 'state')),
      PATH: [p(join(root, 'shim')), dirname(SH), process.env.PATH ?? ''].join(delimiter),
      ...env,
    },
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

const has = (root: string, name: string) => existsSync(join(root, 'work', name));

describe('prune-deploy-work.sh', () => {
  it('dry run lists what would go and deletes nothing', () => {
    const root = fixture(8);
    const r = run(root, ['--keep', '3']);
    expect(r.code).toBe(0);
    for (let i = 1; i <= 5; i++) {
      expect(r.out).toContain(`would remove ${sha(i)}`);
      expect(has(root, sha(i))).toBe(true);
    }
    expect(r.out).not.toContain(sha(6));
  });

  it('the default is a dry run even with no arguments', () => {
    const root = fixture(8);
    expect(run(root).out).toContain('would remove');
    expect(has(root, sha(1))).toBe(true);
  });

  it('--apply removes all but the newest N', () => {
    const root = fixture(8);
    const r = run(root, ['--keep', '3', '--apply']);
    expect(r.code).toBe(0);
    for (let i = 1; i <= 5; i++) expect(has(root, sha(i))).toBe(false);
    for (let i = 6; i <= 8; i++) expect(has(root, sha(i))).toBe(true);
  });

  it('keeps the newest 5 by default', () => {
    const root = fixture(8);
    run(root, ['--apply']);
    expect(has(root, sha(3))).toBe(false);
    expect(has(root, sha(4))).toBe(true);
  });

  it('keeps the live commit even when it is old', () => {
    const root = fixture(8, manifest(sha(1)));
    run(root, ['--keep', '2', '--apply']);
    expect(has(root, sha(1))).toBe(true);
    expect(has(root, sha(2))).toBe(false);
    expect(has(root, sha(8))).toBe(true);
    expect(has(root, sha(7))).toBe(true);
  });

  it('keeps names that are not exactly 40 lowercase hex', () => {
    const root = fixture(6);
    const odd = ['notasha', 'a'.repeat(39), 'a'.repeat(41), 'A'.repeat(40), `${'a'.repeat(39)}g`];
    for (const n of odd) {
      mkdirSync(join(root, 'work', n));
      utimesSync(join(root, 'work', n), 1_600_000_000, 1_600_000_000);
    }
    run(root, ['--keep', '1', '--apply']);
    for (const n of odd) expect(has(root, n)).toBe(true);
    expect(has(root, sha(1))).toBe(false);
  });

  it('keeps a file and a symlink named like a commit', () => {
    const root = fixture(4);
    const target = mkdtempSync(join(tmpdir(), 'prune-target-'));
    dirs.push(target);
    writeFileSync(join(target, 'precious'), 'keep');
    const link = join(root, 'work', 'b'.repeat(40));
    try {
      symlinkSync(target, link, 'dir');
    } catch {
      return; // no symlink right on this machine; the Linux CI run covers it
    }
    utimesSync(join(root, 'work', sha(1)), 1_600_000_000, 1_600_000_000);
    writeFileSync(join(root, 'work', 'c'.repeat(40)), 'a file');
    run(root, ['--keep', '0', '--apply']);
    expect(has(root, 'b'.repeat(40))).toBe(true);
    expect(has(root, 'c'.repeat(40))).toBe(true);
    expect(existsSync(join(target, 'precious'))).toBe(true);
  });

  it.each([
    ['missing', null],
    ['empty', ''],
    ['a bare commit with no manifest line', sha(8)],
    ['a short commit', manifest('abc123')],
    ['an uppercase commit', manifest(sha(8).toUpperCase().replace(/0/g, 'A'))],
    ['two commits on the line', `${HEAD}${sha(8)}. Commit ${sha(7)}.`],
    ['no trailing period', `${HEAD}${sha(8)}`],
  ])('an unreadable live commit (%s) removes nothing and exits 1', (_label, live) => {
    const root = fixture(8, live);
    const r = run(root, ['--keep', '1', '--apply']);
    expect(r.code).toBe(1);
    expect(r.out).not.toContain('removed');
    for (let i = 1; i <= 8; i++) expect(has(root, sha(i))).toBe(true);
  });

  it('a held colo-cd lock directory removes nothing and exits 1', () => {
    const root = fixture(8);
    mkdirSync(join(root, 'state', 'cd.lock'));
    const r = run(root, ['--keep', '1', '--apply']);
    expect(r.code).toBe(1);
    expect(has(root, sha(1))).toBe(true);
    expect(existsSync(join(root, 'state', 'cd.lock'))).toBe(true);
  });

  it('takes the colo-cd lock during the run and releases it after, even when it refuses', () => {
    const root = fixture(8);
    expect(run(root, ['--apply']).code).toBe(0);
    expect(existsSync(join(root, 'state', 'cd.lock'))).toBe(false);
    const bad = fixture(8, null);
    run(bad, ['--apply']);
    expect(existsSync(join(bad, 'state', 'cd.lock'))).toBe(false);
  });

  it('a missing state directory refuses', () => {
    const root = fixture(8);
    rmSync(join(root, 'state'), { recursive: true });
    expect(run(root, ['--apply']).code).toBe(1);
    expect(has(root, sha(1))).toBe(true);
  });

  it('never prints the rest of release.env', () => {
    const root = fixture(8);
    const r = run(root, ['--apply']);
    expect(r.out + r.err).not.toContain('do-not-print');
  });

  it('a busy deploy lock removes nothing and exits 1', () => {
    const root = fixture(8);
    const r = run(root, ['--keep', '1', '--apply'], { FAKE_FLOCK_RC: '1' });
    expect(r.code).toBe(1);
    expect(has(root, sha(1))).toBe(true);
  });

  it('bad arguments exit 1 and remove nothing', () => {
    const root = fixture(8);
    for (const args of [['--keep'], ['--keep', 'x'], ['--keep', '-1'], ['--force']]) {
      expect(run(root, [...args, '--apply']).code).toBe(1);
    }
    expect(has(root, sha(1))).toBe(true);
  });
});
