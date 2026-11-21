// Tests for deploy/genesis/verify-plugin-lock.sh (GE-01a). The script runs under `sh` and checks the plugin-jar lock against
// plugin-jars.sha256 and the two jars. The digests come from node:crypto here, not from the script, so the test does not
// share its digest code with what it tests. Like verify-plugin-jars.test.ts, it runs the Git for Windows sh on Windows.
import { type SpawnSyncReturns, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const SCRIPT = fileURLToPath(new URL('../genesis/verify-plugin-lock.sh', import.meta.url));

// On Windows the sh is Git for Windows' (as in verify-plugin-jars.test.ts); GELDAR_TEST_SH overrides it.
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
const CORE = 'geldar-core.jar';
const VELOCITY = 'geldar-velocity-identity.jar';
const COMMIT = '0123456789abcdef0123456789abcdef01234567';
// The lock sits beside the artifact dir, never inside it: the verifier refuses unexpected entries in the artifact dir.
const lockPath = (): string => `${dir}.lock`;

let root: string;
let dir: string;

const digest = (bytes: string): string => createHash('sha256').update(bytes).digest('hex');
const CORE_LINE = `${digest('core jar bytes')}  ${CORE}`;
const VELOCITY_LINE = `${digest('velocity jar bytes')}  ${VELOCITY}`;

// The artifact CI publishes: both jars and a plugin-jars.sha256 with the given lines.
function writeSums(lines: string[]): void {
  writeFileSync(
    join(dir, 'plugin-jars.sha256'),
    [`# Geldar plugin jars, built from commit ${COMMIT}.`, ...lines, ''].join('\n'),
  );
}

function publish(): void {
  writeFileSync(join(dir, CORE), 'core jar bytes');
  writeFileSync(join(dir, VELOCITY), 'velocity jar bytes');
  writeSums([CORE_LINE, VELOCITY_LINE]);
}

// Writes the lock beside the artifact. The jar lines default to the digests publish() wrote.
function writeLock(header: string, coreLine = CORE_LINE, velocityLine = VELOCITY_LINE): string {
  const path = lockPath();
  writeFileSync(
    path,
    [
      '# Geldar plugin jars lock (GE-01a).',
      `# source commit: ${header}`,
      coreLine,
      velocityLine,
      '',
    ].join('\n'),
  );
  return path;
}

// On Windows the PATH is the sh's own usr/bin only: with the full Windows PATH every MSYS fork is slow enough to time out.
function runScript(args: string[]): SpawnSyncReturns<string> {
  const path = process.platform === 'win32' ? dirname(SH) : (process.env.PATH ?? '');
  return spawnSync(SH, [SCRIPT, ...args], {
    encoding: 'utf8',
    env: { ...process.env, PATH: path },
  });
}

// Each run starts a Git for Windows sh and forks sha256sum; on Windows that takes seconds, so the default 5 s timeout is too short.
const itRuns = (name: string, fn: () => void): void => it(name, fn, 60_000);

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'plugin-lock-verify-'));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

beforeEach(() => {
  dir = mkdtempSync(join(root, 'case-'));
});

describe('verify-plugin-lock.sh', () => {
  itRuns('passes when the lock, plugin-jars.sha256 and both jars agree', () => {
    publish();
    const result = runScript([dir, writeLock(COMMIT)]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`ok: ${CORE}`);
    expect(result.stdout).toContain(`ok: ${VELOCITY}`);
  });

  itRuns('fails when a jar was tampered with after the lock was written', () => {
    publish();
    const lock = writeLock(COMMIT);
    writeFileSync(join(dir, CORE), 'core jar bytes, with one extra byte');
    const result = runScript([dir, lock]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`digest mismatch: ${CORE}`);
  });

  itRuns('fails when a locked jar is missing', () => {
    publish();
    const lock = writeLock(COMMIT);
    unlinkSync(join(dir, VELOCITY));
    const result = runScript([dir, lock]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`missing jar: ${VELOCITY}`);
  });

  itRuns('fails when plugin-jars.sha256 lists a jar the lock does not', () => {
    publish();
    const lock = writeLock(COMMIT);
    writeSums([CORE_LINE, VELOCITY_LINE, `${digest('x')}  other.jar`]);
    const result = runScript([dir, lock]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('extra jar, not in the lock: other.jar');
  });

  itRuns('fails when the artifact dir holds a jar the lock does not', () => {
    publish();
    const lock = writeLock(COMMIT);
    writeFileSync(join(dir, 'other.jar'), 'other jar bytes');
    const result = runScript([dir, lock]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('unexpected entry in the artifact dir');
  });

  itRuns('fails when the lock and plugin-jars.sha256 disagree on a digest', () => {
    publish();
    const lock = writeLock(COMMIT, `${digest('some other core bytes')}  ${CORE}`);
    const result = runScript([dir, lock]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('does not list the same jars and digests as the lock');
  });

  itRuns('refuses a PENDING lock without --allow-pending', () => {
    publish();
    const lock = writeLock('PENDING');
    const result = runScript([dir, lock]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('lock is PENDING');
  });

  itRuns('accepts a PENDING lock with --allow-pending when its digests match', () => {
    publish();
    const lock = writeLock('PENDING');
    const result = runScript([dir, lock, '--allow-pending']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('note: lock is PENDING');
  });

  itRuns('exits 2 on a jar name with a slash', () => {
    publish();
    const lock = writeLock(COMMIT, `${digest('core jar bytes')}  sub/${CORE}`);
    const result = runScript([dir, lock]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('malformed line in lock file');
  });

  itRuns('exits 2 on a jar name with a space', () => {
    publish();
    const lock = writeLock(COMMIT, `${digest('core jar bytes')}  geldar core.jar`);
    const result = runScript([dir, lock]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('malformed line in lock file');
  });

  itRuns('fails on an artifact file named with two locked jar names', () => {
    publish();
    const lock = writeLock(COMMIT);
    writeFileSync(join(dir, `${CORE} ${VELOCITY}`), 'spaced bytes');
    const result = runScript([dir, lock]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('unexpected entry in the artifact dir');
  });

  itRuns('fails on an upper-case EVIL.JAR the lock does not name', () => {
    publish();
    const lock = writeLock(COMMIT);
    writeFileSync(join(dir, 'evil.JAR'), 'evil bytes');
    const result = runScript([dir, lock]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('unexpected entry in the artifact dir');
  });

  itRuns('fails on a dot-file jar the lock does not name', () => {
    publish();
    const lock = writeLock(COMMIT);
    writeFileSync(join(dir, '.evil.jar'), 'evil bytes');
    const result = runScript([dir, lock]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('unexpected entry in the artifact dir');
  });

  itRuns('fails a PENDING lock checked with --allow-pending when a jar was tampered with', () => {
    publish();
    const lock = writeLock('PENDING');
    writeFileSync(join(dir, CORE), 'core jar bytes, with one extra byte');
    const result = runScript([dir, lock, '--allow-pending']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`digest mismatch: ${CORE}`);
  });

  itRuns('exits 2 on a source commit that is not 40 characters', () => {
    publish();
    const lock = writeLock('0123456789abcdef');
    const result = runScript([dir, lock]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('lock source commit must be 40 lowercase hex or PENDING');
  });

  itRuns('exits 2 on a source commit with upper-case hex', () => {
    publish();
    const lock = writeLock(COMMIT.toUpperCase());
    const result = runScript([dir, lock]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('lock source commit must be 40 lowercase hex or PENDING');
  });

  itRuns('exits 2 when the lock has two source commit lines', () => {
    publish();
    writeFileSync(
      lockPath(),
      [
        `# source commit: ${COMMIT}`,
        `# source commit: ${COMMIT}`,
        CORE_LINE,
        VELOCITY_LINE,
        '',
      ].join('\n'),
    );
    const result = runScript([dir, lockPath()]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("needs exactly one '# source commit:' line");
  });

  itRuns('exits 2 when a jar name is listed twice in the lock', () => {
    publish();
    writeFileSync(
      lockPath(),
      [`# source commit: ${COMMIT}`, CORE_LINE, CORE_LINE, VELOCITY_LINE, ''].join('\n'),
    );
    const result = runScript([dir, lockPath()]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('duplicate jar name in lock file');
  });

  itRuns('exits 2 when the lock names no jars', () => {
    publish();
    writeFileSync(lockPath(), `# source commit: ${COMMIT}\n`);
    const result = runScript([dir, lockPath()]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('lock file lists no jars');
  });

  itRuns('exits 2 on an unknown third argument', () => {
    publish();
    const lock = writeLock(COMMIT);
    const result = runScript([dir, lock, '--bogus']);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('usage:');
  });

  itRuns(
    'accepts a lock whose source commit differs from the built-from commit when digests match',
    () => {
      publish();
      const lock = writeLock('f'.repeat(40));
      const result = runScript([dir, lock]);
      expect(result.status).toBe(0);
      expect(result.stderr).not.toContain('differs');
      expect(result.stdout).toContain(`ok: ${CORE}`);
      expect(result.stdout).toContain(`ok: ${VELOCITY}`);
    },
  );

  itRuns('still fails a different-commit lock when a digest differs', () => {
    publish();
    const lock = writeLock('f'.repeat(40), `${digest('other core bytes')}  ${CORE}`);
    const result = runScript([dir, lock]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('does not list the same jars and digests as the lock');
  });
});
