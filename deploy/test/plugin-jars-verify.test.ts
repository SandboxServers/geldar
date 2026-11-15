// Tests for deploy/genesis/verify-plugin-jars.sh (G1-01). The script runs under `sh` and checks the two plugin jars against
// plugin-jars.sha256. The expected digests come from node:crypto here, not from the script, so the test does not share its
// digest code with what it tests.
import { type SpawnSyncReturns, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const SCRIPT = fileURLToPath(new URL('../genesis/verify-plugin-jars.sh', import.meta.url));

// On Windows the sh is Git for Windows' (as in colo-notice.test.ts); GELDAR_TEST_SH overrides it.
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

let root: string;
let dir: string;

const digest = (bytes: string): string => createHash('sha256').update(bytes).digest('hex');

// Writes both jars and a plugin-jars.sha256 whose digests match them, as the workflow's collect step does.
function publish(): void {
  writeFileSync(join(dir, CORE), 'core jar bytes');
  writeFileSync(join(dir, VELOCITY), 'velocity jar bytes');
  writeFileSync(
    join(dir, 'plugin-jars.sha256'),
    [
      `# Geldar plugin jars, built from commit ${COMMIT}.`,
      `${digest('core jar bytes')}  ${CORE}`,
      `${digest('velocity jar bytes')}  ${VELOCITY}`,
      '',
    ].join('\n'),
  );
}

// On Windows the PATH is the sh's own usr/bin only: with the full Windows PATH every MSYS fork is slow enough to time out.
function runScript(args: string[]): SpawnSyncReturns<string> {
  const path = process.platform === 'win32' ? dirname(SH) : (process.env.PATH ?? '');
  return spawnSync(SH, [SCRIPT, ...args], { encoding: 'utf8', env: { ...process.env, PATH: path } });
}

function verify(target: string): { status: number | null; stdout: string; stderr: string } {
  const result = runScript([target]);
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

// Each run starts a Git for Windows sh and forks sha256sum; on Windows that takes seconds, so the default 5 s timeout is too short.
const itRuns = (name: string, fn: () => void): void => it(name, fn, 60_000);

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'plugin-jars-verify-'));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

beforeEach(() => {
  dir = mkdtempSync(join(root, 'case-'));
});

describe('verify-plugin-jars.sh', () => {
  itRuns('passes when both jars match their digests', () => {
    publish();
    const result = verify(dir);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`ok: ${CORE}`);
    expect(result.stdout).toContain(`ok: ${VELOCITY}`);
  });

  itRuns('fails when a jar was tampered with after publish', () => {
    publish();
    writeFileSync(join(dir, CORE), 'core jar bytes, with one extra byte');
    const result = verify(dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`digest mismatch: ${CORE}`);
  });

  itRuns('fails when a listed jar is missing', () => {
    publish();
    unlinkSync(join(dir, VELOCITY));
    const result = verify(dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`missing jar: ${VELOCITY}`);
  });

  itRuns('exits 2 when plugin-jars.sha256 is absent', () => {
    publish();
    unlinkSync(join(dir, 'plugin-jars.sha256'));
    expect(verify(dir).status).toBe(2);
  });

  itRuns('exits 2 when the sha256 file does not list both jars', () => {
    publish();
    writeFileSync(join(dir, 'plugin-jars.sha256'), `${digest('core jar bytes')}  ${CORE}\n`);
    const result = verify(dir);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain(`not listed`);
  });

  itRuns('exits 2 on an upper-case digest, which is not the sha256sum format', () => {
    publish();
    writeFileSync(
      join(dir, 'plugin-jars.sha256'),
      `${digest('core jar bytes').toUpperCase()}  ${CORE}\n${digest('velocity jar bytes')}  ${VELOCITY}\n`,
    );
    expect(verify(dir).status).toBe(2);
  });

  itRuns('exits 2 on a name outside the two plugin jars', () => {
    publish();
    writeFileSync(
      join(dir, 'plugin-jars.sha256'),
      `${digest('core jar bytes')}  ${CORE}\n${digest('velocity jar bytes')}  ${VELOCITY}\n${digest('x')}  other.jar\n`,
    );
    expect(verify(dir).status).toBe(2);
  });

  itRuns('exits 2 without exactly one directory argument', () => {
    expect(runScript([]).status).toBe(2);
  });
});
