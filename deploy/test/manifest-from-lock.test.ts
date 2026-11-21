// Tests for `manifest.sh from-lock <lock>` (GE-01w1a): the v2 plugin lines that a release manifest takes from
// plugin/plugin-jars.lock. The lock digests here are fixtures. The committed lock is read too: it holds the real digests
// (GE-01w1d), so it prints the v2 lines and exits 0.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 60_000 });
const DEPLOY = fileURLToPath(new URL('..', import.meta.url));
const MANIFEST_SH = join(DEPLOY, 'genesis', 'manifest.sh');
const COMMITTED_LOCK = join(DEPLOY, '..', 'plugin', 'plugin-jars.lock');
const posix = (p: string) => p.replace(/\\/g, '/');
// On Windows the sh is Git for Windows' (as in genesis-manifest-v2.test.ts); GELDAR_TEST_SH overrides it.
const SH =
  process.env.GELDAR_TEST_SH ??
  (process.platform !== 'win32'
    ? 'sh'
    : ([process.env.ProgramFiles, process.env['ProgramFiles(x86)']]
        .filter((p): p is string => Boolean(p))
        .map((r) => join(r, 'Git', 'usr', 'bin', 'sh.exe'))
        .find((p) => existsSync(p)) ?? 'sh'));

const COMMIT = '0123456789abcdef0123456789abcdef01234567';
const CORE_HEX = 'a'.repeat(64);
const VELOCITY_HEX = 'b'.repeat(64);
const CORE = `${CORE_HEX}  geldar-core.jar`;
const VELOCITY = `${VELOCITY_HEX}  geldar-velocity-identity.jar`;
const HEADER = `# source commit: ${COMMIT}`;
const PRINTED = `GELDAR_PLUGIN_CORE_SHA256=${CORE_HEX}\nGELDAR_PLUGIN_VELOCITY_IDENTITY_SHA256=${VELOCITY_HEX}\nGELDAR_MANIFEST_VERSION=2\n`;
const BODY_IMAGE = `GELDAR_BODY_IMAGE=ghcr.io/sandboxservers/geldar-body@sha256:${'0'.repeat(64)}`;
const V1 = `# Release manifest.\n${BODY_IMAGE}\n`;

let dir: string;
let seq = 0;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'manifest-from-lock-'));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function write(text: string): string {
  seq += 1;
  const p = join(dir, `lock-${seq}.lock`);
  writeFileSync(p, text);
  return posix(p);
}

// A lock in the plugin-jars.sha256 shape: a comment, the header, then the jar lines.
function lockText(header: string, lines: string[]): string {
  return ['# Geldar plugin jars lock (GE-01a).', header, ...lines, ''].join('\n');
}

function env(): NodeJS.ProcessEnv {
  return { ...process.env, PATH: `${dirname(SH)}${delimiter}${process.env.PATH ?? ''}` };
}

// manifest.sh <args>: stdout and stderr are kept apart, so a test can assert that nothing reaches stdout on a refusal.
function manifest(args: string[]): { code: number; stdout: string; stderr: string; out: string } {
  const r = spawnSync(SH, [posix(MANIFEST_SH), ...args], { encoding: 'utf8', env: env() });
  const stdout = r.stdout ?? '';
  const stderr = r.stderr ?? '';
  return { code: r.status ?? -1, stdout, stderr, out: `${stdout}${stderr}` };
}

const fromLock = (file: string) => manifest(['from-lock', file]);

describe('manifest.sh from-lock: a lock with a source commit', () => {
  it('prints the core line, the velocity-identity line and the version, in that order', () => {
    const r = fromLock(write(lockText(HEADER, [CORE, VELOCITY])));
    expect(r.code).toBe(0);
    expect(r.stdout).toBe(PRINTED);
    expect(r.stderr).toBe('');
  });

  it('the printed lines validate when appended to a manifest with an image line, and read back', () => {
    const printed = fromLock(write(lockText(HEADER, [CORE, VELOCITY]))).stdout;
    const f = write(`${V1}${printed}`);
    expect(manifest(['validate', f]).code).toBe(0);
    expect(manifest(['version', f]).stdout.trim()).toBe('2');
    const core = manifest(['value', f, 'GELDAR_PLUGIN_CORE_SHA256']);
    expect(core.code).toBe(0);
    expect(core.stdout.trim()).toBe(CORE_HEX);
  });
});

describe('manifest.sh from-lock: the committed plugin/plugin-jars.lock', () => {
  const REAL_CORE = 'a77c89c30906a07ea7cff2c82ca74f7f55b7fab138e11656d7fbb40ff3ade563';
  const REAL_VELOCITY = '32c3a6d0030d1393144a19238ab8276b936828f55e69a1075c0d682657bcee34';

  it('is not PENDING: its header names a 40-hex source commit', () => {
    const header = readFileSync(COMMITTED_LOCK, 'utf8')
      .split('\n')
      .filter((l) => l.startsWith('# source commit: '));
    expect(header).toEqual(['# source commit: 2725c5251c2c9c60e567b02adc40da2854422380']);
  });

  it('prints exactly the core digest, the velocity-identity digest and version 2, and exits 0', () => {
    const r = fromLock(posix(COMMITTED_LOCK));
    expect(r.code).toBe(0);
    expect(r.stderr).toBe('');
    expect(r.stdout).toBe(
      `GELDAR_PLUGIN_CORE_SHA256=${REAL_CORE}\nGELDAR_PLUGIN_VELOCITY_IDENTITY_SHA256=${REAL_VELOCITY}\nGELDAR_MANIFEST_VERSION=2\n`,
    );
  });
});

describe('manifest.sh from-lock: a PENDING lock', () => {
  it('prints nothing and exits 0, even with well-formed jar lines', () => {
    const r = fromLock(write(lockText('# source commit: PENDING', [CORE, VELOCITY])));
    expect(r.code).toBe(0);
    expect(r.stdout).toBe('');
    expect(r.stderr).toBe('');
  });

  it('still refuses a malformed jar line (PENDING does not skip the format checks)', () => {
    const r = fromLock(
      write(lockText('# source commit: PENDING', [`${'A'.repeat(64)}  geldar-core.jar`, VELOCITY])),
    );
    expect(r.code).toBe(2);
    expect(r.stdout).toBe('');
  });
});

describe('manifest.sh from-lock: malformed locks exit 2 with a fixed message', () => {
  const cases: [string, string][] = [
    ['no source commit line', ['# Geldar plugin jars lock.', CORE, VELOCITY, ''].join('\n')],
    ['two source commit lines', lockText(`${HEADER}\n${HEADER}`, [CORE, VELOCITY])],
    [
      'a valid first header and a second source commit line with an empty value',
      lockText(`${HEADER}\n# source commit: `, [CORE, VELOCITY]),
    ],
    [
      'a PENDING first header and a second source commit line with an empty value',
      lockText('# source commit: PENDING\n# source commit: ', [CORE, VELOCITY]),
    ],
    ['a commit that is not 40 lowercase hex', lockText('# source commit: abc', [CORE, VELOCITY])],
    [
      'an upper-case commit',
      lockText(`# source commit: ${COMMIT.toUpperCase()}`, [CORE, VELOCITY]),
    ],
    ['no core line', lockText(HEADER, [VELOCITY])],
    ['no velocity-identity line', lockText(HEADER, [CORE])],
    ['a jar listed twice', lockText(HEADER, [CORE, CORE, VELOCITY])],
    [
      'an upper-case digest',
      lockText(HEADER, [`${CORE_HEX.toUpperCase()}  geldar-core.jar`, VELOCITY]),
    ],
    [
      'a digest that is too short',
      lockText(HEADER, [`${'a'.repeat(63)}  geldar-core.jar`, VELOCITY]),
    ],
    ['a line with one space, not two', lockText(HEADER, [`${CORE_HEX} geldar-core.jar`, VELOCITY])],
    ['a jar name with a space', lockText(HEADER, [`${CORE_HEX}  geldar core.jar`, VELOCITY])],
    ['an unknown jar name', lockText(HEADER, [CORE, VELOCITY, `${'c'.repeat(64)}  evil-jar.jar`])],
    ['CR bytes in a comment line', `# note\r\n${HEADER}\n${CORE}\n${VELOCITY}\n`],
    ['CR bytes on every line', lockText(HEADER, [CORE, VELOCITY]).replace(/\n/g, '\r\n')],
    ['an empty file', ''],
  ];
  it.each(cases)('%s is refused', (_label, text) => {
    const r = fromLock(write(text));
    expect(r.code).toBe(2);
    expect(r.stdout).toBe('');
    expect(r.stderr).toMatch(/^plugin lock: /);
    // The message echoes no lock content: neither the unknown name nor the digests appear in it.
    expect(r.out).not.toContain('evil');
    expect(r.out).not.toContain(CORE_HEX);
  });

  it('a lock file that does not exist exits 2', () => {
    const r = fromLock(posix(join(dir, 'missing.lock')));
    expect(r.code).toBe(2);
    expect(r.stdout).toBe('');
  });

  it('from-lock with no lock argument is a usage error (exit 2)', () => {
    expect(manifest(['from-lock']).code).toBe(2);
  });
});
