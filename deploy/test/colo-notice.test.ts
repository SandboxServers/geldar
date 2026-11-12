// Tests for deploy/colo-notice.sh (CD-1d). The script runs under `sh` with a fake `docker` first on PATH. The fake records
// its arguments, one per line, in $FAKE_LOG, and exits 1 when FAKE_DOCKER_FAIL=1 (NATS unreachable). Nothing is published.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { validateMaintenanceNotice } from '../../contract/src/generated/validators.js';

const SCRIPT = fileURLToPath(new URL('../colo-notice.sh', import.meta.url));
let dir: string;
let fakeBin: string;
let log: string;

const FAKE_DOCKER = `#!/bin/sh
for a in "$@"; do printf '%s\\n' "$a"; done >>"$FAKE_LOG"
if [ "\${FAKE_DOCKER_FAIL:-0}" = 1 ]; then echo "fake: nats unreachable" >&2; exit 1; fi
exit 0
`;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'colo-notice-'));
  fakeBin = join(dir, 'bin');
  mkdirSync(fakeBin);
  writeFileSync(join(fakeBin, 'docker'), FAKE_DOCKER);
  // The script checks only that the password file exists; its value is never read, so this fixture is a placeholder.
  writeFileSync(join(dir, 'nats-deploy.txt'), 'placeholder\n');
  log = join(dir, 'docker.log');
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  rmSync(log, { force: true });
});

// On Windows the sh is Git for Windows' (the full Windows PATH makes every MSYS fork slow, as in colo-admin.test.ts).
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
const posix = (p: string) => p.replace(/\\/g, '/');

function run(args: string[], extra: Record<string, string> = {}) {
  const env: Record<string, string> = {
    PATH: [
      posix(fakeBin),
      SH === 'sh' ? '' : posix(join(SH, '..')),
      process.platform === 'win32' ? posix(join(SH, '..', '..', '..', 'mingw64', 'bin')) : '',
      process.platform === 'win32' ? '' : (process.env.PATH ?? ''),
    ]
      .filter(Boolean)
      .join(delimiter),
    FAKE_LOG: log,
    GELDAR_SECRETS_DIR: dir,
    ...extra,
  };
  const r = spawnSync(SH, [posix(SCRIPT), ...args], { env, encoding: 'utf8', timeout: 30_000 });
  if (r.error) throw r.error;
  return r;
}

function payloadOf(stdout: string): unknown {
  const line = stdout.split('\n').find((l) => l.startsWith('{'));
  if (line === undefined) throw new Error(`no payload in: ${stdout}`);
  return JSON.parse(line);
}

// Each test starts several sh processes; a Windows desktop needs more than the 5 s default (colo-admin.test.ts uses 30 s).
describe('colo-notice.sh', { timeout: 30_000 }, () => {
  it('dry-run prints a payload that the contract validator accepts, and publishes nothing', () => {
    const r = run(['--dry-run', 'restart', 'bodies', '30', 'update']);
    expect(r.status).toBe(0);
    const payload = payloadOf(r.stdout) as Record<string, unknown>;
    expect(validateMaintenanceNotice(payload)).toBe(true);
    expect(payload).toMatchObject({
      kind: 'restart',
      scope: 'bodies',
      seconds: 30,
      reason: 'update',
    });
    expect(String(payload.id)).toMatch(/^[a-z0-9][a-z0-9_-]{0,63}$/);
    expect(r.stdout).toContain('geldar.colo.maintenance');
    expect(existsSync(log)).toBe(false);
  });

  it('omits seconds and reason when they are not given, and accepts the range ends', () => {
    const bare = payloadOf(run(['--dry-run', 'back', 'world']).stdout) as Record<string, unknown>;
    expect(validateMaintenanceNotice(bare)).toBe(true);
    expect(bare).not.toHaveProperty('seconds');
    expect(bare).not.toHaveProperty('reason');
    for (const s of ['0', '600']) {
      const p = payloadOf(run(['--dry-run', 'pause', 'mcp', s]).stdout) as Record<string, unknown>;
      expect(validateMaintenanceNotice(p)).toBe(true);
      expect(p.seconds).toBe(Number(s));
    }
    const dash = payloadOf(
      run(['--dry-run', 'pause', 'mcp', '-', 'plugin_update']).stdout,
    ) as Record<string, unknown>;
    expect(dash).toMatchObject({ reason: 'plugin_update' });
    expect(dash).not.toHaveProperty('seconds');
  });

  it.each([
    ['unknown kind', ['explode', 'bodies']],
    ['unknown scope', ['restart', 'nowhere']],
    ['seconds above 600', ['restart', 'bodies', '601']],
    ['seconds of four digits', ['restart', 'bodies', '1000']],
    ['negative seconds', ['restart', 'bodies', '-5']],
    ['leading zero', ['restart', 'bodies', '01']],
    ['seconds not a number', ['restart', 'bodies', 'soon']],
    ['unknown reason', ['restart', 'bodies', '30', 'bogus']],
    ['empty reason', ['restart', 'bodies', '-', '']],
    ['too few arguments', ['restart']],
    ['too many arguments', ['restart', 'bodies', '30', 'update', 'extra']],
  ])('refuses %s without publishing', (_label, args) => {
    const r = run(args);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('colo: error');
    expect(existsSync(log)).toBe(false);
    const dry = run(['--dry-run', ...args]);
    expect(dry.status).toBe(1);
  });

  it('publishes through the admin container as the deploy user, with the password file named by path only', () => {
    const r = run(['restart', 'bodies', '-', 'config']);
    expect(r.status).toBe(0);
    const args = readFileSync(log, 'utf8').split('\n');
    expect(args).toContain('admin');
    expect(args).toContain('notice');
    expect(args).toContain('GELDAR_NATS_USER=deploy');
    expect(args).toContain('GELDAR_NATS_PASSWORD_FILE=/run/secrets/nats-deploy.txt');
    expect(args.some((a) => a.endsWith('colo-notice.yml'))).toBe(true);
    const payload = payloadOf(args.join('\n')) as Record<string, unknown>;
    expect(validateMaintenanceNotice(payload)).toBe(true);
    expect(payload).toMatchObject({ kind: 'restart', scope: 'bodies', reason: 'config' });
  });

  it('exits 0 with a warning when NATS is unreachable', () => {
    const r = run(['restart', 'bodies'], { FAKE_DOCKER_FAIL: '1' });
    expect(r.status).toBe(0);
    expect(r.stderr).toContain('warning');
    expect(r.stderr).toContain('not published');
  });

  it('exits non-zero when NATS is unreachable and COLO_NOTICE_STRICT=1', () => {
    const r = run(['restart', 'bodies'], { FAKE_DOCKER_FAIL: '1', COLO_NOTICE_STRICT: '1' });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('COLO_NOTICE_STRICT=1');
  });

  it('publishes nothing when the deploy password file is missing, warns with its name, and exits 0', () => {
    const empty = join(dir, 'empty-secrets');
    mkdirSync(empty, { recursive: true });
    const r = run(['restart', 'bodies'], { GELDAR_SECRETS_DIR: empty });
    expect(r.status).toBe(0);
    expect(r.stderr).toContain('nats-deploy.txt is missing');
    expect(existsSync(log)).toBe(false);
  });

  it('exits non-zero when the deploy password file is missing and COLO_NOTICE_STRICT=1', () => {
    const empty = join(dir, 'empty-secrets');
    mkdirSync(empty, { recursive: true });
    const r = run(['restart', 'bodies'], { GELDAR_SECRETS_DIR: empty, COLO_NOTICE_STRICT: '1' });
    expect(r.status).not.toBe(0);
    expect(existsSync(log)).toBe(false);
  });
});
