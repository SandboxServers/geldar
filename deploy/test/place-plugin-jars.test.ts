// Tests for deploy/genesis/place-plugin-jars.sh (GE-01b). The script runs under `sh`, calls verify-plugin-lock.sh, then stages,
// renames and rolls back jars in a target dir. The digests come from node:crypto here, not from the script. Like
// plugin-lock-verify.test.ts it runs the Git for Windows sh on Windows; tests that need POSIX modes or symlinks skip there.
import { type SpawnSyncReturns, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const SCRIPT = fileURLToPath(new URL('../genesis/place-plugin-jars.sh', import.meta.url));

// On Windows the sh is Git for Windows' (as in plugin-lock-verify.test.ts); GELDAR_TEST_SH overrides it.
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
const isWin = process.platform === 'win32';
const itPosix = isWin ? it.skip : it;
const CORE = 'geldar-core.jar';
const VELOCITY = 'geldar-velocity-identity.jar';
const COMMIT = '0123456789abcdef0123456789abcdef01234567';

let root: string;
let artifact: string;
let target: string;

const digest = (bytes: string): string => createHash('sha256').update(bytes).digest('hex');

// Writes the artifact CI would publish for these jar bytes, and the lock beside it (the lock never sits in the artifact dir).
// Calling it again with other bytes publishes a new version into the same artifact dir.
function publish(core: string, velocity: string, header = COMMIT): string {
  writeFileSync(join(artifact, CORE), core);
  writeFileSync(join(artifact, VELOCITY), velocity);
  writeFileSync(
    join(artifact, 'plugin-jars.sha256'),
    [
      `# Geldar plugin jars, built from commit ${COMMIT}.`,
      `${digest(core)}  ${CORE}`,
      `${digest(velocity)}  ${VELOCITY}`,
      '',
    ].join('\n'),
  );
  const lock = `${artifact}.lock`;
  writeFileSync(
    lock,
    [
      '# Geldar plugin jars lock (GE-01a).',
      `# source commit: ${header}`,
      `${digest(core)}  ${CORE}`,
      `${digest(velocity)}  ${VELOCITY}`,
      '',
    ].join('\n'),
  );
  return lock;
}

// On Windows the PATH is the sh's own usr/bin only: with the full Windows PATH every MSYS fork is slow enough to time out.
// `shim` (a dir holding a test `cp`) goes first on PATH when given.
function runScript(args: string[], shim?: string): SpawnSyncReturns<string> {
  const base = isWin ? dirname(SH) : (process.env.PATH ?? '');
  const path = shim ? `${shim}${isWin ? ';' : ':'}${base}` : base;
  return spawnSync(SH, [SCRIPT, ...args], {
    encoding: 'utf8',
    env: { ...process.env, PATH: path },
  });
}

// A `cp` shim running `body` in place of cp; the body calls `command -p cp`, which skips the shim dir.
function cpShim(body: string): string {
  const dir = mkdtempSync(join(root, 'shim-'));
  writeFileSync(join(dir, 'cp'), `#!/bin/sh\n${body}\n`);
  chmodSync(join(dir, 'cp'), 0o755);
  return dir;
}
// The second jar's staged copy is `.<name>.XXXXXX` in the target dir.
const SECOND_TMP = `*/.${VELOCITY}.*`;
const FAIL_SECOND_CP = `case "$2" in ${SECOND_TMP}) echo "cp: write error" >&2; exit 1 ;; esac\ncommand -p cp "$@"`;
const CORRUPT_SECOND_CP = `command -p cp "$@" || exit $?\ncase "$2" in ${SECOND_TMP}) printf x >> "$2" ;; esac`;

const place = (lock: string): SpawnSyncReturns<string> => runScript([artifact, lock, target]);
const read = (name: string): string => readFileSync(join(target, name), 'utf8');
const listTarget = (): string[] => readdirSync(target).sort();

// Each run starts a Git for Windows sh and forks several tools; on Windows that takes seconds, so the default 5 s timeout is too short.
const itRuns = (name: string, fn: () => void): void => it(name, fn, 60_000);

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'place-plugin-jars-'));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

beforeEach(() => {
  artifact = mkdtempSync(join(root, 'artifact-'));
  target = mkdtempSync(join(root, 'target-'));
});

describe('place-plugin-jars.sh', () => {
  itRuns('places both locked jars into an empty target dir', () => {
    const lock = publish('core v1', 'velocity v1');
    const result = place(lock);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`placed: ${CORE}`);
    expect(result.stdout).toContain(`placed: ${VELOCITY}`);
    expect(read(CORE)).toBe('core v1');
    expect(read(VELOCITY)).toBe('velocity v1');
    expect(listTarget()).toEqual([CORE, VELOCITY].sort());
  });

  itRuns('leaves both jars alone on a second run with the same artifact', () => {
    const lock = publish('core v1', 'velocity v1');
    expect(place(lock).status).toBe(0);
    const before = [CORE, VELOCITY].map((name) => statSync(join(target, name)));
    const result = place(lock);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`unchanged: ${CORE}`);
    expect(result.stdout).toContain(`unchanged: ${VELOCITY}`);
    expect(result.stdout).not.toContain('placed:');
    const after = [CORE, VELOCITY].map((name) => statSync(join(target, name)));
    expect(after.map((s) => s.ino)).toEqual(before.map((s) => s.ino));
    expect(after.map((s) => s.mtimeMs)).toEqual(before.map((s) => s.mtimeMs));
    expect(listTarget()).toEqual([CORE, VELOCITY].sort());
  });

  itRuns('keeps the replaced jar as .prev on an upgrade, and replaces an older .prev', () => {
    expect(place(publish('core v1', 'velocity v1')).status).toBe(0);
    expect(place(publish('core v2', 'velocity v2')).status).toBe(0);
    expect(read(CORE)).toBe('core v2');
    expect(read(`${CORE}.prev`)).toBe('core v1');
    expect(read(`${VELOCITY}.prev`)).toBe('velocity v1');
    expect(place(publish('core v3', 'velocity v3')).status).toBe(0);
    expect(read(CORE)).toBe('core v3');
    expect(read(`${CORE}.prev`)).toBe('core v2');
  });

  itRuns('refuses a tampered artifact and leaves the target dir as it was', () => {
    expect(place(publish('core v1', 'velocity v1')).status).toBe(0);
    const lock = publish('core v2', 'velocity v2');
    writeFileSync(join(artifact, CORE), 'core v2, with one extra byte');
    const result = place(lock);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`digest mismatch: ${CORE}`);
    expect(result.stderr).toContain('the target dir is unchanged');
    expect(read(CORE)).toBe('core v1');
    expect(read(VELOCITY)).toBe('velocity v1');
    expect(listTarget()).toEqual([CORE, VELOCITY].sort());
  });

  itRuns('keeps the first jar at its old version when the second jar slot is a directory', () => {
    expect(place(publish('core v1', 'velocity v1')).status).toBe(0);
    const lock = publish('core v2', 'velocity v2');
    unlinkSync(join(target, VELOCITY));
    mkdirSync(join(target, VELOCITY));
    const result = place(lock);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`refusing a non-file in the target dir: ${VELOCITY}`);
    expect(read(CORE)).toBe('core v1');
    expect(existsSync(join(target, `${CORE}.prev`))).toBe(false);
    expect(statSync(join(target, VELOCITY)).isDirectory()).toBe(true);
    expect(listTarget()).toEqual([CORE, VELOCITY].sort());
  });

  itRuns('refuses a PENDING lock without --allow-pending and writes nothing', () => {
    const lock = publish('core v1', 'velocity v1', 'PENDING');
    const result = place(lock);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('lock is PENDING');
    expect(listTarget()).toEqual([]);
  });

  itRuns('exits 2 on a usage error', () => {
    const lock = publish('core v1', 'velocity v1');
    const result = runScript([artifact, lock]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('usage: place-plugin-jars.sh');
  });

  itRuns('exits 2 when the target dir does not exist', () => {
    const lock = publish('core v1', 'velocity v1');
    const result = runScript([artifact, lock, join(root, 'missing-dir')]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('target dir does not exist');
  });

  itRuns(
    'restores the .prev copies on rollback and keeps the replaced jars as .rolled-back',
    () => {
      expect(place(publish('core v1', 'velocity v1')).status).toBe(0);
      expect(place(publish('core v2', 'velocity v2')).status).toBe(0);
      const result = runScript(['--rollback', target]);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain(`restored: ${CORE}`);
      expect(result.stdout).toContain(`restored: ${VELOCITY}`);
      expect(read(CORE)).toBe('core v1');
      expect(read(VELOCITY)).toBe('velocity v1');
      expect(read(`${CORE}.rolled-back`)).toBe('core v2');
      expect(listTarget()).toEqual(
        [CORE, `${CORE}.rolled-back`, VELOCITY, `${VELOCITY}.rolled-back`].sort(),
      );
    },
  );

  itRuns('exits 1 on rollback when there is no .prev copy', () => {
    expect(place(publish('core v1', 'velocity v1')).status).toBe(0);
    const result = runScript(['--rollback', target]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('no .prev copy in the target dir, nothing to roll back');
    expect(read(CORE)).toBe('core v1');
    expect(listTarget()).toEqual([CORE, VELOCITY].sort());
  });

  itRuns('refuses an unsafe .prev name on rollback and changes nothing', () => {
    expect(place(publish('core v1', 'velocity v1')).status).toBe(0);
    expect(place(publish('core v2', 'velocity v2')).status).toBe(0);
    writeFileSync(join(target, 'bad name.jar.prev'), 'not a jar');
    const result = runScript(['--rollback', target]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('unsafe name refused: bad name.jar.prev');
    expect(read(CORE)).toBe('core v2');
    expect(read(`${CORE}.prev`)).toBe('core v1');
  });

  itPosix('refuses a symlinked target dir and writes through nothing', () => {
    const lock = publish('core v1', 'velocity v1');
    const link = join(root, 'link-to-target');
    symlinkSync(target, link, 'dir');
    const result = runScript([artifact, lock, link]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('target dir is a symbolic link, refusing');
    expect(listTarget()).toEqual([]);
  });

  itPosix(
    'refuses a symlinked jar in the target dir and leaves the file it points at alone',
    () => {
      expect(place(publish('core v1', 'velocity v1')).status).toBe(0);
      const outside = join(root, 'outside.bin');
      writeFileSync(outside, 'outside bytes');
      unlinkSync(join(target, CORE));
      symlinkSync(outside, join(target, CORE));
      const result = place(publish('core v2', 'velocity v2'));
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(`refusing a symbolic link in the target dir: ${CORE}`);
      expect(readFileSync(outside, 'utf8')).toBe('outside bytes');
    },
  );

  itPosix('refuses a symlinked .prev on rollback and leaves the file it points at alone', () => {
    expect(place(publish('core v1', 'velocity v1')).status).toBe(0);
    const outside = join(root, 'outside-prev.bin');
    writeFileSync(outside, 'outside bytes');
    symlinkSync(outside, join(target, `${CORE}.prev`));
    const result = runScript(['--rollback', target]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`refusing a symbolic link in the target dir: ${CORE}.prev`);
    expect(readFileSync(outside, 'utf8')).toBe('outside bytes');
    expect(read(CORE)).toBe('core v1');
  });

  itPosix('places jars with mode 0644', () => {
    expect(place(publish('core v1', 'velocity v1')).status).toBe(0);
    expect(statSync(join(target, CORE)).mode & 0o777).toBe(0o644);
    expect(statSync(join(target, VELOCITY)).mode & 0o777).toBe(0o644);
  });

  itRuns('undoes only the last placement: an unchanged jar drops its older .prev', () => {
    expect(place(publish('core c1', 'velocity v1')).status).toBe(0);
    expect(place(publish('core c2', 'velocity v2')).status).toBe(0);
    const last = place(publish('core c3', 'velocity v2'));
    expect(last.status).toBe(0);
    expect(last.stdout).toContain(`unchanged: ${VELOCITY}`);
    expect(existsSync(join(target, `${VELOCITY}.prev`))).toBe(false);
    const result = runScript(['--rollback', target]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`restored: ${CORE}`);
    expect(result.stdout).not.toContain(`restored: ${VELOCITY}`);
    expect(read(CORE)).toBe('core c2');
    expect(read(VELOCITY)).toBe('velocity v2');
    expect(listTarget()).toEqual([CORE, `${CORE}.rolled-back`, VELOCITY].sort());
  });

  itRuns(
    'a run that places no jar keeps the .prev copies, so rollback still undoes the last placement',
    () => {
      expect(place(publish('core c1', 'velocity v1')).status).toBe(0);
      expect(place(publish('core c2', 'velocity v2')).status).toBe(0);
      const lock = publish('core c2', 'velocity v2');
      const last = place(lock);
      expect(last.status).toBe(0);
      expect(last.stdout).toContain(`unchanged: ${CORE}`);
      expect(last.stdout).toContain(`unchanged: ${VELOCITY}`);
      expect(last.stdout).not.toContain('placed:');
      expect(read(`${CORE}.prev`)).toBe('core c1');
      expect(read(`${VELOCITY}.prev`)).toBe('velocity v1');
      const result = runScript(['--rollback', target]);
      expect(result.status).toBe(0);
      expect(read(CORE)).toBe('core c1');
      expect(read(VELOCITY)).toBe('velocity v1');
    },
  );

  itRuns('refuses an unchanged jar whose .prev is a directory, and changes nothing', () => {
    expect(place(publish('core v1', 'velocity v1')).status).toBe(0);
    const lock = publish('core v1', 'velocity v2');
    mkdirSync(join(target, `${CORE}.prev`));
    writeFileSync(join(target, `${CORE}.prev`, 'keep.txt'), 'keep');
    const result = place(lock);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`refusing a non-file in the target dir: ${CORE}.prev`);
    expect(read(VELOCITY)).toBe('velocity v1');
    expect(readdirSync(join(target, `${CORE}.prev`))).toEqual(['keep.txt']);
    expect(listTarget()).toEqual([CORE, `${CORE}.prev`, VELOCITY].sort());
  });

  itPosix(
    'refuses an unchanged jar whose .prev is a symlink, and leaves the link and its target alone',
    () => {
      expect(place(publish('core v1', 'velocity v1')).status).toBe(0);
      const lock = publish('core v1', 'velocity v2');
      const outside = join(root, 'outside-unchanged-prev.bin');
      writeFileSync(outside, 'outside bytes');
      symlinkSync(outside, join(target, `${CORE}.prev`));
      const result = place(lock);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(`refusing a symbolic link in the target dir: ${CORE}.prev`);
      expect(read(VELOCITY)).toBe('velocity v1');
      expect(lstatSync(join(target, `${CORE}.prev`)).isSymbolicLink()).toBe(true);
      expect(readlinkSync(join(target, `${CORE}.prev`))).toBe(outside);
      expect(readFileSync(outside, 'utf8')).toBe('outside bytes');
    },
  );

  itRuns('removes every staged copy when cp fails on the second jar, and changes nothing', () => {
    expect(place(publish('core v1', 'velocity v1')).status).toBe(0);
    const lock = publish('core v2', 'velocity v2');
    const result = runScript([artifact, lock, target], cpShim(FAIL_SECOND_CP));
    expect(result.status).toBe(1);
    expect(read(CORE)).toBe('core v1');
    expect(read(VELOCITY)).toBe('velocity v1');
    expect(listTarget()).toEqual([CORE, VELOCITY].sort());
  });

  itRuns('refuses a staged copy that changed after verify, and leaves no temp files', () => {
    expect(place(publish('core v1', 'velocity v1')).status).toBe(0);
    const lock = publish('core v2', 'velocity v2');
    const result = runScript([artifact, lock, target], cpShim(CORRUPT_SECOND_CP));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`staged copy of ${VELOCITY} does not match its locked digest`);
    expect(result.stderr).not.toContain(CORE);
    expect(result.stderr).toContain('the target dir is unchanged');
    expect(read(CORE)).toBe('core v1');
    expect(read(VELOCITY)).toBe('velocity v1');
    expect(listTarget()).toEqual([CORE, VELOCITY].sort());
  });

  itRuns('refuses a directory named as a .prev in place mode and changes nothing', () => {
    expect(place(publish('core v1', 'velocity v1')).status).toBe(0);
    const lock = publish('core v2', 'velocity v2');
    mkdirSync(join(target, `${CORE}.prev`));
    const result = place(lock);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`refusing a non-file in the target dir: ${CORE}.prev`);
    expect(read(CORE)).toBe('core v1');
    expect(read(VELOCITY)).toBe('velocity v1');
    expect(statSync(join(target, `${CORE}.prev`)).isDirectory()).toBe(true);
    expect(listTarget()).toEqual([CORE, `${CORE}.prev`, VELOCITY].sort());
  });

  itPosix('refuses a symlinked .prev in place mode and leaves the file it points at alone', () => {
    expect(place(publish('core v1', 'velocity v1')).status).toBe(0);
    const lock = publish('core v2', 'velocity v2');
    const outside = join(root, 'outside-place-prev.bin');
    writeFileSync(outside, 'outside bytes');
    symlinkSync(outside, join(target, `${CORE}.prev`));
    const result = place(lock);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`refusing a symbolic link in the target dir: ${CORE}.prev`);
    expect(readFileSync(outside, 'utf8')).toBe('outside bytes');
    expect(read(CORE)).toBe('core v1');
  });

  itRuns('places a PENDING lock when --allow-pending is given', () => {
    const lock = publish('core v1', 'velocity v1', 'PENDING');
    const result = runScript([artifact, lock, target, '--allow-pending']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`placed: ${CORE}`);
    expect(read(CORE)).toBe('core v1');
    expect(read(VELOCITY)).toBe('velocity v1');
  });

  itRuns('exits 2 on a bad extra argument and writes nothing', () => {
    const lock = publish('core v1', 'velocity v1', 'PENDING');
    const result = runScript([artifact, lock, target, '--bogus']);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('usage: place-plugin-jars.sh');
    expect(listTarget()).toEqual([]);
  });

  itRuns('passes verify exit 2 through when the lock has a malformed source commit', () => {
    const lock = publish('core v1', 'velocity v1');
    writeFileSync(lock, readFileSync(lock, 'utf8').replace(COMMIT, 'not-a-commit'));
    const result = place(lock);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('lock source commit must be 40 lowercase hex or PENDING');
    expect(listTarget()).toEqual([]);
  });

  itPosix('refuses a symlinked jar slot on rollback and leaves the file it points at alone', () => {
    expect(place(publish('core v1', 'velocity v1')).status).toBe(0);
    expect(place(publish('core v2', 'velocity v2')).status).toBe(0);
    const outside = join(root, 'outside-rollback.bin');
    writeFileSync(outside, 'outside bytes');
    unlinkSync(join(target, CORE));
    symlinkSync(outside, join(target, CORE));
    const result = runScript(['--rollback', target]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`refusing a symbolic link in the target dir: ${CORE}`);
    expect(readFileSync(outside, 'utf8')).toBe('outside bytes');
    expect(read(`${CORE}.prev`)).toBe('core v1');
  });

  itRuns('refuses a .rolled-back directory on rollback and does not move the jar into it', () => {
    expect(place(publish('core v1', 'velocity v1')).status).toBe(0);
    expect(place(publish('core v2', 'velocity v2')).status).toBe(0);
    mkdirSync(join(target, `${CORE}.rolled-back`));
    const result = runScript(['--rollback', target]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`refusing a non-file in the target dir: ${CORE}.rolled-back`);
    expect(read(CORE)).toBe('core v2');
    expect(read(`${CORE}.prev`)).toBe('core v1');
    expect(readdirSync(join(target, `${CORE}.rolled-back`))).toEqual([]);
  });

  itRuns('ignores .prev files whose names do not end in .jar.prev on rollback', () => {
    expect(place(publish('core v1', 'velocity v1')).status).toBe(0);
    expect(place(publish('core v2', 'velocity v2')).status).toBe(0);
    writeFileSync(join(target, 'server.properties.prev'), 'props');
    const result = runScript(['--rollback', target]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`restored: ${CORE}`);
    expect(result.stdout).toContain(`restored: ${VELOCITY}`);
    expect(result.stdout).not.toContain('server.properties');
    expect(read('server.properties.prev')).toBe('props');
    expect(existsSync(join(target, 'server.properties'))).toBe(false);
  });
});
