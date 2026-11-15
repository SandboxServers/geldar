// C7-03c5: the helper bundle artifact. The pinned Node reference, the install script's sha256 check of
// the bundle, and the build-only CI workflow. The shell test runs the dry run under a temp prefix (see
// install-body-helper.test.ts for the fixture rules; it needs bash, GELDAR_SHELL_TESTS_BASH on Windows).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const DEPLOY = fileURLToPath(new URL('..', import.meta.url));
const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SCRIPT = join(DEPLOY, 'install-body-helper.sh');
const PIN_FILE = join(DEPLOY, 'body-helper-node.env');
const WORKFLOW = join(ROOT, '.github/workflows/body-helper-bundle.yml');
const BASH = process.env.GELDAR_SHELL_TESTS_BASH ?? 'bash';
const NODE_SHA = '1805bcd35e6815559bd2eb97db438d3fdb0eb3a5e6a977b7c1badca76337e9ce';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function pins(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(PIN_FILE, 'utf8').split('\n')) {
    const match = /^([A-Z0-9_]+)=(\S+)$/.exec(line.trim());
    if (match) out[match[1] as string] = match[2] as string;
  }
  return out;
}

describe('pinned Node reference (C7-03c5)', () => {
  it('pins Node 22.23.4 with the sha256 of its linux-x64 tarball from SHASUMS256.txt', () => {
    const pin = pins();
    expect(pin.BODY_HELPER_NODE_VERSION).toBe('22.23.4');
    expect(pin.BODY_HELPER_NODE_SHA256_LINUX_X64).toBe(NODE_SHA);
    expect(readFileSync(PIN_FILE, 'utf8')).not.toMatch(/\r/);
  });

  it('the workflow setup-node version is the pinned helper runtime (the same string, not .nvmrc)', () => {
    const setup = /node-version:\s*(\S+)/.exec(readFileSync(WORKFLOW, 'utf8'));
    expect(setup?.[1]).toBe(pins().BODY_HELPER_NODE_VERSION);
  });
});

describe('install script checks the bundle sha256 before it installs (C7-03c5)', {
  timeout: 30_000,
}, () => {
  it('dry run blocks, and writes nothing, when main.js does not match main.js.sha256', () => {
    const root = mkdtempSync(join(tmpdir(), 'geldar-ih5-'));
    dirs.push(root);
    const repo = join(root, 'repo');
    mkdirSync(join(repo, 'tools/migrate/node_modules'), { recursive: true });
    const build = join(root, 'rt/opt/geldar/body-helper/dist');
    mkdirSync(build, { recursive: true });
    writeFileSync(join(build, 'main.js'), 'console.log("helper");\n');
    writeFileSync(join(build, 'main.js.sha256'), `${'0'.repeat(64)}  main.js\n`);
    mkdirSync(join(root, 'rt/etc/geldar'), { recursive: true });
    writeFileSync(join(root, 'rt/etc/geldar/body-helper.env'), 'GELDAR_SHARD=\n');
    const res = spawnSync(BASH, [SCRIPT], {
      cwd: root,
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH ?? '',
        BODY_HELPER_PREFIX: 'rt',
        BODY_HELPER_REPO: repo.replaceAll('\\', '/'),
      },
    });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('blocked: bundle sha256 does not match');
    expect(res.stdout).not.toContain('would: write unit file');
    expect(existsSync(join(root, 'rt/etc/systemd/system/geldar-body-helper.service'))).toBe(false);
  });
});

describe('build-only CI workflow for the bundle (C7-03c5)', () => {
  const yaml = (): string => readFileSync(WORKFLOW, 'utf8');

  it('pins every action by a 40-character commit SHA', () => {
    const uses = yaml()
      .split('\n')
      .filter((line) => /^\s*-?\s*uses:/.test(line));
    expect(uses.length).toBeGreaterThan(0);
    for (const line of uses) expect(line).toMatch(/@[0-9a-f]{40}\s+#\s+v\d/);
  });

  it('is build-only: read permission, no secrets, no deploy or ssh step', () => {
    const text = yaml();
    expect(text).toMatch(/permissions:\s*\n\s+contents: read\n/);
    expect(text).not.toMatch(/secrets\./);
    expect(text).not.toMatch(/\bssh\b|\bscp\b|docker compose/);
  });

  it('rebuilds when the lockfile, the workspace file or the contract it imports changes', () => {
    const text = yaml();
    expect(text).toContain('- pnpm-lock.yaml');
    expect(text).toContain('- pnpm-workspace.yaml');
    expect(text).toContain('- contract/**');
  });

  it('builds the bundle, writes its sha256, self-checks it, and uploads the artifact', () => {
    const text = yaml();
    expect(text).toContain('pnpm --filter @geldar/body-helper build');
    expect(text).toContain('sha256sum --check');
    expect(text).toContain('upload-artifact');
    expect(text).toContain('deploy/body-helper-node.env');
  });
});
