// The deterministic tar mode of deploy/scratch/build-neoforge-bundle.sh (--tar and --out-sums). The tar step is the function
// write_bundle_tar, which takes an already-built directory: the test extracts it from the script and runs it under `sh` on a
// fixture tree, so no docker and no network. Skipped where the shell has no GNU tar (--mtime).
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const SCRIPT = resolve(
  fileURLToPath(new URL('../../deploy/scratch/build-neoforge-bundle.sh', import.meta.url)),
);
const SCRIPT_TEXT = readFileSync(SCRIPT, 'utf8');

function findSh(): string {
  if (process.env.GELDAR_TEST_SH) return process.env.GELDAR_TEST_SH;
  if (process.platform !== 'win32') return 'sh';
  const roots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(
    (p): p is string => Boolean(p),
  );
  return (
    roots.map((root) => join(root, 'Git', 'usr', 'bin', 'sh.exe')).find((p) => existsSync(p)) ??
    'sh'
  );
}
const SH = findSh();
// Git for Windows' usr/bin holds the GNU tar, sort and sha tools that the script calls. Its path goes first on PATH.
const SH_DIR = /[\\/]/.test(SH) ? dirname(SH) : '';
const ENV = {
  ...process.env,
  PATH: [SH_DIR, process.env.PATH ?? ''].filter(Boolean).join(delimiter),
};
// Paths reach sh as forward slashes: MSYS sh on Windows reads C:/ paths reliably.
const posix = (p: string) => p.replace(/\\/g, '/');

const probe = spawnSync(SH, ['-c', 'tar --version 2>/dev/null | head -n 1'], {
  encoding: 'utf8',
  env: ENV,
});
const CAN_RUN = probe.status === 0 && String(probe.stdout).includes('GNU tar');

/** The tar step, cut out of the script by its function header and its closing brace. */
function tarFunction(): string {
  const start = SCRIPT_TEXT.indexOf('write_bundle_tar() {');
  const end = SCRIPT_TEXT.indexOf('\n}\n', start);
  if (start < 0 || end < 0) throw new Error('write_bundle_tar is not in the script');
  return SCRIPT_TEXT.slice(start, end + 3);
}

/** The bundle's file set, the marker included, as the script's allow-list packs it. */
const MARKER = '.geldar-bundle.sha256';
const FILES = [
  '.neoforge-manifest.json',
  'neoforge-installer.jar',
  'run.sh',
  'run.bat',
  'libraries/a.jar',
  'libraries/b/c.jar',
  'mods/proxy.jar',
  MARKER,
];
/** The golden member list: byte order (LC_ALL=C), as the script sorts it. */
const GOLDEN = [
  '.geldar-bundle.sha256',
  '.neoforge-manifest.json',
  'libraries/a.jar',
  'libraries/b/c.jar',
  'mods/proxy.jar',
  'neoforge-installer.jar',
  'run.bat',
  'run.sh',
];

const cleanup: string[] = [];
afterEach(() => {
  for (const dir of cleanup.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'nf-bundle-tar-'));
  cleanup.push(dir);
  return dir;
}

/** Builds a fixture /data tree. The files are created in the given order, each with its own mtime, so two trees differ. */
function makeTree(root: string, order: string[], mtimeBase: number): void {
  mkdirSync(root, { recursive: true });
  order.forEach((name, i) => {
    const path = join(root, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `content of ${name}\n`);
    const t = mtimeBase + i * 977;
    utimesSync(path, t, t);
  });
}

/** Runs write_bundle_tar DIR LIST TAR SUMS under sh; the list is written in the given order. */
function runTar(dir: string, listNames: string[], tar: string, sums: string) {
  const work = tempDir();
  const list = join(work, 'list.txt');
  writeFileSync(list, `${listNames.join('\n')}\n`);
  const driver = join(work, 'driver.sh');
  writeFileSync(driver, `set -eu\n${tarFunction()}\nwrite_bundle_tar "$1" "$2" "$3" "$4"\n`);
  const r = spawnSync(SH, [posix(driver), posix(dir), posix(list), posix(tar), posix(sums)], {
    encoding: 'utf8',
    env: ENV,
  });
  return { status: r.status, stderr: r.stderr };
}

const sha = (buf: Buffer, alg: string) => createHash(alg).update(buf).digest('hex');

describe.skipIf(!CAN_RUN)('neoforge bundle tar mode (write_bundle_tar)', () => {
  it('writes identical tar bytes for a tree built in another order with other mtimes', () => {
    const base = tempDir();
    const treeA = join(base, 'a');
    const treeB = join(base, 'b');
    makeTree(treeA, FILES, 1_700_000_000);
    makeTree(treeB, [...FILES].reverse(), 1_900_000_000);
    const a = runTar(treeA, FILES, join(base, 'a.tar'), join(base, 'a.sums'));
    const b = runTar(treeB, [...FILES].reverse(), join(base, 'b.tar'), join(base, 'b.sums'));
    expect(a.status, a.stderr).toBe(0);
    expect(b.status, b.stderr).toBe(0);
    expect(sha(readFileSync(join(base, 'a.tar')), 'sha256')).toBe(
      sha(readFileSync(join(base, 'b.tar')), 'sha256'),
    );
  });

  it('writes a sums file with the sha256 and sha512 of the tar, named by its base name', () => {
    const base = tempDir();
    makeTree(join(base, 'tree'), FILES, 1_700_000_000);
    const tar = join(base, 'bundle.tar');
    const sums = join(base, 'bundle.sums');
    expect(runTar(join(base, 'tree'), FILES, tar, sums).status).toBe(0);
    const bytes = readFileSync(tar);
    const lines = readFileSync(sums, 'utf8').split('\n').filter(Boolean);
    expect(lines).toEqual([
      `${sha(bytes, 'sha256')}  bundle.tar`,
      `${sha(bytes, 'sha512')}  bundle.tar`,
    ]);
  });

  it('packs exactly the golden member list, sorted, with no directory entries', () => {
    const base = tempDir();
    makeTree(join(base, 'tree'), FILES, 1_700_000_000);
    const tar = join(base, 'bundle.tar');
    expect(runTar(join(base, 'tree'), FILES, tar, join(base, 'bundle.sums')).status).toBe(0);
    const r = spawnSync(SH, ['-c', 'tar -tf bundle.tar'], {
      cwd: base,
      encoding: 'utf8',
      env: ENV,
    });
    expect(r.stdout.split('\n').filter(Boolean)).toEqual(GOLDEN);
  });

  it('writes numeric owner 0/0 and mtime 0 on every member', () => {
    const base = tempDir();
    makeTree(join(base, 'tree'), FILES, 1_700_000_000);
    expect(
      runTar(join(base, 'tree'), FILES, join(base, 'bundle.tar'), join(base, 'bundle.sums')).status,
    ).toBe(0);
    const r = spawnSync(SH, ['-c', 'tar --utc --full-time -tvf bundle.tar'], {
      cwd: base,
      encoding: 'utf8',
      env: ENV,
    });
    const lines = r.stdout.split('\n').filter(Boolean);
    expect(lines).toHaveLength(GOLDEN.length);
    for (const line of lines) {
      expect(line).toMatch(/ 0\/0 /);
      expect(line).toContain('1970-01-01 00:00:00');
    }
  });
});

describe('neoforge bundle tar mode options', () => {
  it('rejects --tar without --out-sums before any docker call', () => {
    const base = tempDir();
    const r = spawnSync(
      SH,
      [posix(SCRIPT), '--tar', posix(join(base, 'x.tar')), posix(join(base, 'out'))],
      {
        encoding: 'utf8',
        env: ENV,
      },
    );
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('--tar and --out-sums go together');
  });
});
