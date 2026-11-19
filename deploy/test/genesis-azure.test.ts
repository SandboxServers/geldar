// Tests for deploy/genesis/azure/*.sh (G2-04). `az` and `gh` are logging stubs first on PATH. A dry run must make no
// call at all; an apply run must list before it creates, so with everything present it creates nothing.
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Each apply run forks several `$(az ...)` subshells; under Git for Windows that takes 5 to 10 s, past vitest's 5 s default.
vi.setConfig({ testTimeout: 60_000 });

const AZURE = join(fileURLToPath(new URL('..', import.meta.url)), 'genesis', 'azure');
const GH_SCRIPT = join(AZURE, 'github-environments.sh');
const OIDC_SCRIPT = join(AZURE, 'oidc-identities.sh');
const REPO = 'example-owner/example-repo';
const DNS_ZONE_ID =
  '/subscriptions/stub/resourceGroups/stub/providers/Microsoft.Network/dnszones/example.test';

// The stubs print one value for list/show calls when FAKE_EXISTS=1, and exit 1 for a GET when it is 0.
const FAKE_AZ = `#!/bin/sh
echo "az $*" >> "$FAKE_LOG"
case "$*" in
  *" list "*|*" show "*|*" list") [ "\${FAKE_EXISTS:-0}" = 1 ] && echo stub-value ;;
esac
exit 0
`;
const FAKE_GH = `#!/bin/sh
echo "gh $*" >> "$FAKE_LOG"
case "$*" in *"-X PUT"*) exit 0 ;; esac
[ "\${FAKE_EXISTS:-0}" = 1 ]
`;

let dir: string;
let fakeBin: string;
let log: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'genesis-azure-'));
  fakeBin = join(dir, 'bin');
  mkdirSync(fakeBin);
  for (const [name, body] of [
    ['az', FAKE_AZ],
    ['gh', FAKE_GH],
  ] as const) {
    // The stubs must be executable for PATH lookup (see colo-notice.test.ts); chmod sets the mode explicitly.
    writeFileSync(join(fakeBin, name), body, { mode: 0o755 });
    chmodSync(join(fakeBin, name), 0o755);
  }
  log = join(dir, 'calls.log');
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  rmSync(log, { force: true });
});

// On Windows the sh is Git for Windows' (the full Windows PATH makes every MSYS fork slow, as in colo-notice.test.ts).
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

function run(script: string, args: string[], exists = false) {
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
    FAKE_EXISTS: exists ? '1' : '0',
  };
  return spawnSync(SH, [posix(script), ...args], { env, encoding: 'utf8', timeout: 30_000 });
}

const calls = () => (existsSync(log) ? readFileSync(log, 'utf8') : '');
const GH_ARGS = ['--repo', REPO, '--reviewer-id', '4242'];
const OIDC_ARGS = [
  '--repo',
  REPO,
  '--repository-id',
  '123456',
  '--resource-group',
  'rg-stub',
  '--dns-zone-id',
  DNS_ZONE_ID,
];

describe('github-environments.sh', () => {
  it('dry-run prints the three environments and makes no gh or az call', () => {
    const r = run(GH_SCRIPT, GH_ARGS);
    expect(r.status).toBe(0);
    for (const name of ['production', 'test', 'ephemeral']) {
      expect(r.stdout).toContain(`environments/${name}`);
    }
    expect(r.stdout).toContain('"reviewers":[{"type":"User","id":4242}]');
    expect(calls()).toBe('');
  });

  it('apply with every environment present writes nothing', () => {
    const r = run(GH_SCRIPT, [...GH_ARGS, '--apply'], true);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('exists environment production (no write)');
    expect(calls()).not.toMatch(/-X PUT/);
  });

  it('apply with nothing present PUTs each environment once', () => {
    const r = run(GH_SCRIPT, [...GH_ARGS, '--apply'], false);
    expect(r.status).toBe(0);
    expect(calls().match(/-X PUT/g)?.length).toBe(3);
  });

  it('refuses a reviewer id that is not numeric and a repo that is not owner/name', () => {
    expect(run(GH_SCRIPT, ['--repo', REPO, '--reviewer-id', 'abc']).status).toBe(2);
    expect(run(GH_SCRIPT, ['--repo', 'no-slash', '--reviewer-id', '1']).status).toBe(2);
    expect(calls()).toBe('');
  });
});

describe('oidc-identities.sh', () => {
  it('dry-run prints the identity, the federated subject and the roles, and makes no az call', () => {
    const r = run(OIDC_SCRIPT, OIDC_ARGS);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('geldar-production-deploy');
    expect(r.stdout).toContain(`repo:${REPO}:environment:production`);
    expect(r.stdout).toContain(`repository_id=123456`);
    expect(r.stdout).toContain('DNS Zone Contributor');
    expect(r.stdout).toContain('kv-geldar-test');
    expect(calls()).toBe('');
  });

  it('apply with everything present creates no app, credential or role', () => {
    const r = run(OIDC_SCRIPT, [...OIDC_ARGS, '--apply'], true);
    expect(r.status).toBe(0);
    expect(calls()).not.toMatch(/ create|federated-credential create/);
    expect(calls()).toMatch(/az ad app list/);
    expect(calls()).toMatch(/az role assignment list/);
  });

  it('apply with nothing present creates the app and the credential, and assigns roles', () => {
    const r = run(OIDC_SCRIPT, [...OIDC_ARGS, '--apply'], false);
    expect(r.status).toBe(0);
    expect(calls()).toMatch(/az ad app create --display-name geldar-production-deploy/);
    expect(calls()).toMatch(/az ad app federated-credential create/);
    expect(calls()).toMatch(/az role assignment create .*DNS Zone Contributor/);
  }, 60_000);

  it('refuses a missing dns zone id and a non-numeric repository id', () => {
    expect(
      run(OIDC_SCRIPT, ['--repo', REPO, '--repository-id', '1', '--resource-group', 'rg']).status,
    ).toBe(2);
    expect(run(OIDC_SCRIPT, [...OIDC_ARGS.slice(0, 3), 'x', ...OIDC_ARGS.slice(4)]).status).toBe(2);
    expect(calls()).toBe('');
  });
});

describe('genesis azure scripts hold no ids, accounts or secrets', () => {
  it('contains no GUID or tenant-style id', () => {
    for (const script of [GH_SCRIPT, OIDC_SCRIPT]) {
      const text = readFileSync(script, 'utf8');
      expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
      expect(text).not.toMatch(/\/subscriptions\//);
    }
  });
});
