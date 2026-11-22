// REGISTER_KILL_SWITCH as a node env name (deploy/common.sh). The value comes from the shell or from STATE_DIR/node.env,
// must be exactly true or false when set, and is exported so that compose sees it. Sign-up stays closed when it is unset.
// These tests source common.sh in a POSIX shell; they run in CI on Linux (on a Windows host the shell may be missing).
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const DEPLOY = fileURLToPath(new URL('..', import.meta.url));
const ROOT = resolve(DEPLOY, '..');
const COMMON = resolve(DEPLOY, 'common.sh');
const posix = (p: string) => p.replace(/\\/g, '/');
const NODE_NAMES = [
  'REGISTER_KILL_SWITCH',
  'GELDAR_GLASS_TRUSTED_PROXIES',
  'GELDAR_MCP_TRUSTED_PROXIES',
  'GELDAR_COLO_SUBNET',
  'REGISTER_TRUSTED_PEERS',
  'DEPLOY_DRY_RUN',
];

// On Windows the POSIX shell is Git for Windows' sh (GELDAR_TEST_SH overrides it); elsewhere it is sh on PATH.
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

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

// A state directory, optionally with a node.env file of the given text.
function sandbox(nodeEnv?: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'geldar-node-env-'));
  dirs.push(dir);
  const state = join(dir, 'state');
  mkdirSync(state);
  if (nodeEnv !== undefined) writeFileSync(join(state, 'node.env'), nodeEnv);
  return posix(state);
}

// Runs a snippet after sourcing common.sh. The shell starts with none of the node names set, unless `env` sets them.
function sh(script: string, state: string, env: Record<string, string> = {}) {
  const base: Record<string, string> = { ...(process.env as Record<string, string>) };
  for (const n of NODE_NAMES) delete base[n];
  // common.sh calls dirname at load time: the shell's own tool directory must be on PATH (Windows keeps it as Path).
  const path = [dirname(SH), base.PATH ?? base.Path ?? ''].filter(Boolean).join(delimiter);
  delete base.Path;
  // common.sh finds its helper scripts from $0 (dirname "$0"), so the shell's $0 is the path of common.sh itself.
  const r = spawnSync(SH, ['-c', `. "$0"; ${script}`, posix(COMMON)], {
    encoding: 'utf8',
    env: { ...base, PATH: path, GELDAR_STATE_DIR: state, ...env },
  });
  return { code: r.status ?? -1, out: `${r.stdout}${r.stderr}` };
}

describe('REGISTER_KILL_SWITCH from the node env file', () => {
  it('honours a file value of true or false and exports it', () => {
    expect(
      sh(
        'load_node_env; printf %s "${REGISTER_KILL_SWITCH-unset}"',
        sandbox('REGISTER_KILL_SWITCH=true\n'),
      ).out,
    ).toBe('true');
    expect(
      sh(
        'load_node_env; printf %s "${REGISTER_KILL_SWITCH-unset}"',
        sandbox('REGISTER_KILL_SWITCH=false\n'),
      ).out,
    ).toBe('false');
  });

  it('makes the exported value false for the compose render step (the colo.yml default expression)', () => {
    const script = `load_node_env; sh -c 'printf %s "\${REGISTER_KILL_SWITCH:-true}"'`;
    expect(sh(script, sandbox('REGISTER_KILL_SWITCH=false\n')).out).toBe('false');
    expect(sh(script, sandbox()).out).toBe('true');
  });

  it('rejects any other file value and exports nothing', () => {
    for (const bad of ['False', 'FALSE', '0', 'no', 'true ', ' false', 'off']) {
      const r = sh('load_node_env; printf reached', sandbox(`REGISTER_KILL_SWITCH=${bad}\n`));
      expect(r.code, bad).not.toBe(0);
      expect(r.out, bad).toContain('REGISTER_KILL_SWITCH in');
      expect(r.out, bad).toContain('must be exactly true or false');
      expect(r.out, bad).not.toContain('reached');
    }
  });

  it('rejects a shell value that is not exactly true or false, even when the file is fine', () => {
    const r = sh('load_node_env; printf reached', sandbox('REGISTER_KILL_SWITCH=false\n'), {
      REGISTER_KILL_SWITCH: 'no',
    });
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('must be exactly true or false');
    expect(r.out).not.toContain('reached');
  });

  it('lets a shell value win over the file (the command-line emergency close)', () => {
    const read = 'load_node_env; printf %s "${REGISTER_KILL_SWITCH-unset}"';
    expect(
      sh(read, sandbox('REGISTER_KILL_SWITCH=false\n'), { REGISTER_KILL_SWITCH: 'true' }).out,
    ).toBe('true');
    expect(
      sh(read, sandbox('REGISTER_KILL_SWITCH=true\n'), { REGISTER_KILL_SWITCH: 'false' }).out,
    ).toBe('false');
  });

  it('treats an empty value, in the shell or in the file, as unset (compose default true)', () => {
    const read = 'load_node_env; printf %s "${REGISTER_KILL_SWITCH:-unset}"';
    expect(sh(read, sandbox('REGISTER_KILL_SWITCH=\n')).out).toBe('unset');
    expect(
      sh(read, sandbox('REGISTER_KILL_SWITCH=false\n'), { REGISTER_KILL_SWITCH: '' }).out,
    ).toBe('false');
    expect(sh(read, sandbox(), { REGISTER_KILL_SWITCH: '' }).out).toBe('unset');
  });

  it('save_node_env keeps the value when it is set and writes no line when it is unset', () => {
    const state = sandbox('REGISTER_KILL_SWITCH=false\nGELDAR_COLO_SUBNET=198.51.100.0/24\n');
    expect(sh('load_node_env; save_node_env', state).code).toBe(0);
    expect(readFileSync(join(state, 'node.env'), 'utf8')).toContain('REGISTER_KILL_SWITCH=false\n');
    const bare = sandbox();
    expect(sh('load_node_env; save_node_env', bare).code).toBe(0);
    expect(readFileSync(join(bare, 'node.env'), 'utf8')).not.toContain('REGISTER_KILL_SWITCH');
  });

  it('say_node_env prints the value in force, true, false or unset, also on a dry run', () => {
    const say = 'load_node_env; say_node_env';
    expect(sh(say, sandbox('REGISTER_KILL_SWITCH=false\n'), { DEPLOY_DRY_RUN: '1' }).out).toContain(
      'register kill switch: false',
    );
    expect(sh(say, sandbox('REGISTER_KILL_SWITCH=true\n')).out).toContain(
      'register kill switch: true',
    );
    expect(sh(say, sandbox()).out).toContain('register kill switch: unset');
  });

  it('keeps the address-list check for the proxy names', () => {
    const r = sh('load_node_env', sandbox('GELDAR_MCP_TRUSTED_PROXIES=rm -rf\n'));
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('GELDAR_MCP_TRUSTED_PROXIES in');
  });
});

describe('REGISTER_KILL_SWITCH wiring in the deploy scripts', () => {
  const read = (name: string) => readFileSync(join(DEPLOY, name), 'utf8');

  it('the compose default stays true and no deploy file sets it to false by default', () => {
    expect(readFileSync(join(ROOT, 'compose', 'colo.yml'), 'utf8')).toContain(
      'REGISTER_KILL_SWITCH: "${REGISTER_KILL_SWITCH:-true}"',
    );
    const files = readdirSync(DEPLOY).filter((n) => /\.(sh|env|example)$/.test(n));
    for (const f of files) {
      expect(read(f), f).not.toMatch(/REGISTER_KILL_SWITCH[=:-]+false/);
    }
  });

  it('colo-up.sh and colo-cd.sh both load the node env; colo-up.sh saves it after loading', () => {
    const up = read('colo-up.sh');
    const upLoad = up.search(/^load_node_env$/m);
    expect(upLoad).toBeGreaterThan(-1);
    expect(upLoad).toBeLessThan(up.search(/^save_node_env$/m));
    const cd = read('colo-cd.sh');
    expect(cd).toMatch(/^load_node_env$/m);
    expect(cd).toMatch(/^say_node_env$/m);
  });

  it('no deploy script passes an env file to compose', () => {
    for (const f of readdirSync(DEPLOY).filter((n) => n.endsWith('.sh'))) {
      expect(read(f), f).not.toMatch(/--env-file/);
    }
  });
});
