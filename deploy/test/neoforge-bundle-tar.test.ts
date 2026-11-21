// The deterministic tar mode of deploy/scratch/build-neoforge-bundle.sh (--tar and --out-sums). The tar step is the function
// write_bundle_tar in the sourced library deploy/scratch/bundle-tar-lib.sh, which takes an already-built directory: the test
// extracts it from the library and runs it under `sh` on a fixture tree, so no docker and no network. The argument checks run the script itself with a docker stub first on PATH: the
// stub writes a marker and exits 99, so a marker means the script reached docker. Skipped where the shell has no GNU tar.
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
const LIB = resolve(
  fileURLToPath(new URL('../../deploy/scratch/bundle-tar-lib.sh', import.meta.url)),
);
const LIB_TEXT = readFileSync(LIB, 'utf8');

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
// Whether chmod 755 keeps the exec bit on this filesystem. MSYS on NTFS may not keep it, and then run.sh is stored 0644 with or
// without the fix: the exec-bit assertion is made only where the bit survives, and the 0644 normalisation is checked everywhere.
const EXEC_KEPT = spawnSync(
  SH,
  ['-c', 'f=$(mktemp); chmod 755 "$f"; test -x "$f" && echo yes; rm -f "$f"'],
  {
    encoding: 'utf8',
    env: ENV,
  },
).stdout?.includes('yes');

/** The tar step, cut out of the sourced library by its function header and its closing brace. */
function tarFunction(): string {
  const start = LIB_TEXT.indexOf('write_bundle_tar() {');
  const end = LIB_TEXT.indexOf('\n}\n', start);
  if (start < 0 || end < 0) throw new Error('write_bundle_tar is not in bundle-tar-lib.sh');
  return LIB_TEXT.slice(start, end + 3);
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

/**
 * Two trees made under umask 022 and umask 002 in subshells, then pinned: the regular files to 0644 and 0664, run.sh to 0755.
 * On MSYS the umask may not show in the modes, so the chmod makes the difference explicit. Returns the two tar bytes.
 */
function umaskTrees(base: string): { a: Buffer; b: Buffer } {
  const list = FILES.join('\n');
  const driver = [
    'set -eu',
    tarFunction(),
    `mk() { ( umask "$2"; mkdir -p "$1"; cd "$1"; for f in ${FILES.join(' ')}; do mkdir -p "$(dirname "$f")"; printf 'x %s\\n' "$f" > "$f"; done ); }`,
    `pin() { ( cd "$1"; for f in ${FILES.join(' ')}; do if [ "$f" = run.sh ]; then chmod 755 "$f"; else chmod "$2" "$f"; fi; done ); }`,
    'mk "$1" 022; mk "$2" 002',
    'pin "$1" 644; pin "$2" 664',
    'write_bundle_tar "$1" "$3" "$4" "$5"',
    'write_bundle_tar "$2" "$3" "$6" "$7"',
    '',
  ].join('\n');
  const work = tempDir();
  const listFile = join(work, 'list.txt');
  writeFileSync(listFile, `${list}\n`);
  const driverFile = join(work, 'driver.sh');
  writeFileSync(driverFile, driver);
  const treeA = join(base, 'umask022');
  const treeB = join(base, 'umask002');
  const r = spawnSync(
    SH,
    [
      posix(driverFile),
      posix(treeA),
      posix(treeB),
      posix(listFile),
      posix(join(base, 'a.tar')),
      posix(join(base, 'a.sums')),
      posix(join(base, 'b.tar')),
      posix(join(base, 'b.sums')),
    ],
    { encoding: 'utf8', env: ENV },
  );
  if (r.status !== 0) throw new Error(`umask driver failed: ${r.stderr}`);
  return { a: readFileSync(join(base, 'a.tar')), b: readFileSync(join(base, 'b.tar')) };
}

const sha = (buf: Buffer, alg: string) => createHash(alg).update(buf).digest('hex');

/** The ustar member headers: name, uname (offset 265, 32 bytes) and gname (offset 297, 32 bytes), walking the blocks. */
function memberHeaders(buf: Buffer): { name: string; uname: Buffer; gname: Buffer }[] {
  const out: { name: string; uname: Buffer; gname: Buffer }[] = [];
  for (let off = 0; off + 512 <= buf.length; ) {
    const name = buf.toString('latin1', off, off + 100).split('\0')[0];
    if (name === '') break;
    const size = parseInt(
      buf
        .toString('latin1', off + 124, off + 136)
        .split('\0')[0]
        .trim() || '0',
      8,
    );
    out.push({
      name,
      uname: buf.subarray(off + 265, off + 297),
      gname: buf.subarray(off + 297, off + 329),
    });
    off += 512 + Math.ceil(size / 512) * 512;
  }
  return out;
}

/**
 * Runs the script with the given arguments and a docker stub first on PATH. The stub writes a marker and exits 99: a marker
 * means the script reached docker.
 */
function runScript(args: (work: string) => string[]) {
  const work = tempDir();
  const bin = join(work, 'bin');
  mkdirSync(bin);
  const marker = join(work, 'docker-called');
  writeFileSync(join(bin, 'docker'), `#!/bin/sh\necho called >"${posix(marker)}"\nexit 99\n`, {
    mode: 0o755,
  });
  const env = { ...ENV, PATH: [bin, ENV.PATH ?? ''].filter(Boolean).join(delimiter) };
  const r = spawnSync(SH, [posix(SCRIPT), ...args(work).map(posix)], { encoding: 'utf8', env });
  return { status: r.status, stderr: r.stderr ?? '', dockerCalled: existsSync(marker), work };
}

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

  it('writes identical tar bytes under umask 022 and umask 002, with run.sh still executable', () => {
    const base = tempDir();
    const { a, b } = umaskTrees(base);
    expect(sha(a, 'sha256')).toBe(sha(b, 'sha256'));
    // The fixture files are 0644 or 0664; the tar holds 0644 for both. run.sh keeps its exec bit where the host keeps it.
    const listing = (tar: string) =>
      spawnSync(SH, ['-c', `tar --utc -tvf ${tar}`], { cwd: base, encoding: 'utf8', env: ENV })
        .stdout;
    const runShMode = EXEC_KEPT ? 'rwxr-xr-x' : 'rw-r--r--';
    for (const tar of ['a.tar', 'b.tar']) {
      const out = listing(tar);
      expect(out).not.toMatch(/^-rw-rw/m);
      expect(out).toMatch(/^-rw-r--r-- .* neoforge-installer\.jar$/m);
      expect(out).toMatch(new RegExp(`^-${runShMode} .* run\\.sh$`, 'm'));
    }
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

  it('writes numeric owner 0/0 and mtime 0 on every member, with empty uname and gname fields', () => {
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
    const headers = memberHeaders(readFileSync(join(base, 'bundle.tar')));
    expect(headers.map((h) => h.name)).toEqual(GOLDEN);
    for (const h of headers) {
      expect(
        h.uname.every((b) => b === 0),
        `uname of ${h.name}`,
      ).toBe(true);
      expect(
        h.gname.every((b) => b === 0),
        `gname of ${h.name}`,
      ).toBe(true);
    }
  });

  it('removes the partial tar when tar fails, and returns non-zero', () => {
    const base = tempDir();
    makeTree(join(base, 'tree'), FILES, 1_700_000_000);
    const tar = join(base, 'bundle.tar');
    const r = runTar(
      join(base, 'tree'),
      [...FILES, 'missing/absent.jar'],
      tar,
      join(base, 'bundle.sums'),
    );
    expect(r.status).not.toBe(0);
    expect(existsSync(tar)).toBe(false);
  });
});

describe('neoforge bundle tar mode options', () => {
  it('sources the library from the script directory, and the function lives only in the library', () => {
    expect(SCRIPT_TEXT).toContain('. "$(cd "$(dirname "$0")" && pwd)/bundle-tar-lib.sh"');
    expect(SCRIPT_TEXT).not.toContain('write_bundle_tar() {');
    expect(LIB_TEXT).toContain('write_bundle_tar() {');
    expect(LIB_TEXT).not.toMatch(/\/tmp|\r/);
  });

  it('rejects --out-sums without --tar before any docker call', () => {
    const r = runScript((w) => ['--out-sums', join(w, 's.sums'), join(w, 'out')]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('--tar and --out-sums go together');
    expect(r.dockerCalled).toBe(false);
  });

  it('rejects --tar without --out-sums before any docker call', () => {
    const r = runScript((w) => ['--tar', join(w, 'x.tar'), join(w, 'out')]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('--tar and --out-sums go together');
    expect(r.dockerCalled).toBe(false);
  });

  it('rejects --tar with no value before any docker call', () => {
    const r = runScript(() => ['--tar']);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('usage:');
    expect(r.dockerCalled).toBe(false);
  });

  it('control: both options reach the docker stub, so the stub is on PATH', () => {
    const r = runScript((w) => [
      '--tar',
      join(w, 'x.tar'),
      '--out-sums',
      join(w, 's.sums'),
      join(w, 'out'),
    ]);
    expect(r.dockerCalled).toBe(true);
    expect(r.status).toBe(99);
  });
});
