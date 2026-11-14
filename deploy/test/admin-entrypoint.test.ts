// Tests for the entrypoint of the admin image, tools/admin/admin.sh (decision 0108, the roster). The script runs under
// `sh` with a fake `node` on PATH that writes each argument on its own line, so the tests see the exact argv the CLI
// would get. No real node, database or container is used. The Postgres password file is a fixture.
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
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

const ADMIN_SH = resolve(fileURLToPath(new URL('../../tools/admin/admin.sh', import.meta.url)));

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
// Paths reach sh as forward slashes: MSYS sh on Windows reads C:/ paths reliably.
const posix = (p: string) => p.replace(/\\/g, '/');

// Each argument on its own line, so the test can compare the argv exactly (no word splitting in the record).
const NODE_SHIM = `#!/bin/sh
printf '%s\\n' "$@" >"$NODE_CALLS_LOG"
exit 0
`;

// Same bound as the other spawn tests in deploy/test: several sh processes start per test on a Windows desktop.
const SPAWN_TEST_TIMEOUT_MS = 30_000;
vi.setConfig({ testTimeout: SPAWN_TEST_TIMEOUT_MS });

const CLI = '/opt/geldar/tools/mcp-tokens/src/cli.ts';
const dirs: string[] = [];

interface Fixture {
  env: Record<string, string>;
  nodeLog: string;
}

function fixture(): Fixture {
  const dir = mkdtempSync(join(tmpdir(), 'geldar-admin-entry-test-'));
  dirs.push(dir);
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'node'), NODE_SHIM);
  chmodSync(join(bin, 'node'), 0o755);
  const pgFile = join(dir, 'postgres.txt');
  writeFileSync(pgFile, 'pg-test-value\n');
  const nodeLog = join(dir, 'node.log');
  const env: Record<string, string> = { ...(process.env as Record<string, string>) };
  delete env.Path;
  Object.assign(env, {
    PATH: [
      bin,
      SH === 'sh' ? '' : dirname(SH),
      process.platform === 'win32' ? join(dirname(SH), '..', '..', 'mingw64', 'bin') : '',
      process.platform === 'win32' ? '' : (process.env.PATH ?? ''),
    ]
      .filter(Boolean)
      .join(delimiter),
    GELDAR_ADMIN_PG_PASSWORD_FILE: posix(pgFile),
    NODE_CALLS_LOG: posix(nodeLog),
  });
  return { env, nodeLog };
}

function run(fx: Fixture, args: string[]) {
  const r = spawnSync(SH, [posix(ADMIN_SH), ...args], { env: fx.env, encoding: 'utf8' });
  return { code: r.status ?? -1, out: `${r.stdout}${r.stderr}` };
}

// The argv the fake node received, or undefined when node was never run.
function argv(fx: Fixture): string[] | undefined {
  if (!existsSync(fx.nodeLog)) return undefined;
  return readFileSync(fx.nodeLog, 'utf8').split('\n').slice(0, -1);
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('admin.sh roster dispatch (decision 0108)', () => {
  it('roster add passes the name and --owner to the mcp-tokens CLI as separate arguments', () => {
    const fx = fixture();
    const r = run(fx, ['roster', 'add', 'Picard', '--owner', 'steve']);
    expect(r.code).toBe(0);
    expect(argv(fx)).toEqual([CLI, 'roster', 'add', 'Picard', '--owner', 'steve']);
  });

  it('roster list passes through with no filter and with --owner', () => {
    const fx = fixture();
    expect(run(fx, ['roster', 'list']).code).toBe(0);
    expect(argv(fx)).toEqual([CLI, 'roster', 'list']);
    const filtered = fixture();
    expect(run(filtered, ['roster', 'list', '--owner', 'steve']).code).toBe(0);
    expect(argv(filtered)).toEqual([CLI, 'roster', 'list', '--owner', 'steve']);
  });

  it('keeps shell characters in a roster argument literal: no expansion, one argument', () => {
    const fx = fixture();
    const r = run(fx, ['roster', 'add', '$(id)', '--owner', 'steve']);
    expect(r.code).toBe(0);
    expect(argv(fx)).toEqual([CLI, 'roster', 'add', '$(id)', '--owner', 'steve']);
  });

  it.each([
    ['no verb', ['roster']],
    ['remove', ['roster', 'remove', 'Picard', '--owner', 'steve']],
    ['seed', ['roster', 'seed', '--owner', 'steve', '--from', '/run/x']],
  ])('refuses roster with %s before any node call', (_name, args) => {
    const fx = fixture();
    const r = run(fx, args);
    expect(r.code).toBe(2);
    expect(r.out).toContain('roster takes add or list');
    expect(argv(fx)).toBeUndefined();
  });

  it('the usage text lists roster', () => {
    const fx = fixture();
    const r = run(fx, []);
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/usage: admin <[^>]*\|roster[|>]/);
  });

  it('refuses roster add when the Postgres password file is missing, and runs no node', () => {
    const fx = fixture();
    fx.env.GELDAR_ADMIN_PG_PASSWORD_FILE = posix(join(dirname(fx.nodeLog), 'missing.txt'));
    const r = run(fx, ['roster', 'add', 'Picard', '--owner', 'steve']);
    expect(r.code).toBe(1);
    expect(r.out).toContain('the database password file is missing or empty');
    expect(argv(fx)).toBeUndefined();
  });
});
