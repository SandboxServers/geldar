// Tests for the forced-command deploy channel (G3-02) and its installer (GE-04). The wrapper runs under sh with a fake
// entrypoint (a script that prints its arguments and the environment it got) in place of the root entrypoint, and with
// GELDAR_CHANNEL_SUDO=sh so no sudo runs. Nothing touches a node, sudo, sshd or the network. Each test has its own temp dir.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { SH } from './colo-deploy-fixture';

const GENESIS = fileURLToPath(new URL('../genesis/', import.meta.url));
const WRAPPER = join(GENESIS, 'geldar-deploy-channel.sh');
const INSTALLER = join(GENESIS, 'install-deploy-channel.sh');
const SHA = '0123456789abcdef0123456789abcdef01234567';
// Secret-shaped canary: it is set in the process environment and written into an allow-listed envs file. It must never reach stdout.
const CANARY = 'canary-7f3a9c1e5b2d4a60-do-not-print';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

// sh is given forward-slash paths: Git's sh on Windows reads C:/ paths and mangles backslashes.
const p = (s: string) => s.replace(/\\/g, '/');

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'gn-channel-'));
  dirs.push(root);
  const envDir = join(root, 'envs');
  mkdirSync(envDir);
  writeFileSync(join(envDir, 'colo.yaml'), `token: ${CANARY}\n`);
  const entry = join(root, 'entry.sh');
  writeFileSync(
    entry,
    `echo "ARGS:$*"\necho "ENV:\${GELDAR_DEPLOY_ENV-unset}"\necho "CANARY:\${GELDAR_CANARY-unset}"\necho "stderr line" >&2\nexit 0\n`,
  );
  const failing = join(root, 'failing.sh');
  writeFileSync(failing, 'echo "ARGS:$*"\nexit 3\n');
  return { root, envDir, entry, failing, log: join(root, 'channel.log') };
}

type Fx = ReturnType<typeof setup>;

// The test process environment, with sh's directory first on PATH (Git for Windows' sh needs its coreutils) and no
// SSH_ORIGINAL_COMMAND unless a test sets one.
function shEnv(over: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = { ...(process.env as Record<string, string>) };
  delete env.Path;
  delete env.SSH_ORIGINAL_COMMAND;
  env.PATH =
    SH === 'sh' ? (process.env.PATH ?? '') : [dirname(SH), process.env.PATH ?? ''].join(delimiter);
  return { ...env, ...over };
}

// Runs the wrapper with SSH_ORIGINAL_COMMAND set to cmd (or unset when cmd is undefined, which is a shell request).
function channel(fx: Fx, cmd: string | undefined, entry = fx.entry) {
  const env = shEnv({
    GELDAR_CANARY: CANARY,
    GELDAR_CHANNEL_ENTRY: p(entry),
    GELDAR_CHANNEL_ENV_DIR: p(fx.envDir),
    GELDAR_CHANNEL_LOG: p(fx.log),
    GELDAR_CHANNEL_SUDO: 'sh',
  });
  if (cmd !== undefined) env.SSH_ORIGINAL_COMMAND = cmd;
  const r = spawnSync(SH, [p(WRAPPER)], { env, encoding: 'utf8', timeout: 15000 });
  return {
    code: r.status,
    out: `${r.stdout}${r.stderr}`,
    log: existsSync(fx.log) ? readFileSync(fx.log, 'utf8') : '',
  };
}

function install(dest: string, user: string, extra: Record<string, string> = {}) {
  const env = shEnv({
    GELDAR_DEPLOY_DEST: p(dest),
    GELDAR_OPERATOR_USER: user,
    GELDAR_OPERATOR_HOME: `/home/${user}`,
    ...extra,
  });
  return spawnSync(SH, [p(INSTALLER)], { env, encoding: 'utf8', timeout: 15000 });
}

describe('deploy channel: refused requests (G3-02)', () => {
  it('refuses a shell request (no command) and runs nothing', () => {
    const fx = setup();
    const r = channel(fx, undefined);
    expect(r.code).toBe(1);
    expect(r.out).toContain('refused');
    expect(r.log).toBe('');
  });

  it('refuses an unknown verb and runs nothing', () => {
    const fx = setup();
    const r = channel(fx, `destroy ${SHA} colo`);
    expect(r.code).toBe(1);
    expect(r.out).toContain('unknown verb');
    expect(r.log).toBe('');
  });

  it('refuses a bad sha (short, upper case, not hex, too long) and runs nothing', () => {
    const fx = setup();
    const bad = ['abc', SHA.toUpperCase(), 'g'.repeat(40), `${SHA}0`];
    for (const sha of bad) {
      const r = channel(fx, `plan ${sha} colo`);
      expect(r.code, sha).toBe(1);
      expect(r.out, sha).toContain('refused');
    }
    expect(channel(fx, `plan ${SHA} colo`).code).toBe(0);
    expect(existsSync(fx.log)).toBe(true);
  });

  it('refuses an environment that is not in the allow-list, or that has shell metacharacters', () => {
    const fx = setup();
    const bad = [
      'staging',
      '..',
      '-x',
      'colo.yaml',
      'colo;id',
      'colo|id',
      '$(id)',
      'colo`id`',
      'colo&id',
      'colo>x',
    ];
    for (const env of bad) {
      const r = channel(fx, `plan ${SHA} ${env}`);
      expect(r.code, env).toBe(1);
      expect(r.out, env).toContain('refused');
    }
    expect(existsSync(fx.log)).toBe(false);
  });

  it('refuses a request with the wrong number of words, tabs, quotes or a path', () => {
    const fx = setup();
    const bad = [
      `plan ${SHA}`,
      `plan ${SHA} colo extra`,
      `plan\t${SHA} colo`,
      `plan ${SHA} "colo"`,
      `plan ${SHA} /etc/colo`,
    ];
    for (const cmd of bad) {
      const r = channel(fx, cmd);
      expect(r.code, cmd).toBe(1);
    }
    expect(existsSync(fx.log)).toBe(false);
  });
});

describe('deploy channel: accepted requests (G3-02)', () => {
  it('runs apply as the entrypoint deploy verb, with the environment name and a scrubbed environment', () => {
    const fx = setup();
    const r = channel(fx, `apply ${SHA} colo`);
    expect(r.code).toBe(0);
    expect(r.log).toContain(`ARGS:deploy ${SHA}`);
    expect(r.log).toContain('ENV:colo');
    expect(r.log).toContain('CANARY:unset');
  });

  it('passes plan, verify and restore through unchanged', () => {
    const fx = setup();
    for (const verb of ['plan', 'verify', 'restore']) {
      expect(channel(fx, `${verb} ${SHA} colo`).code, verb).toBe(0);
    }
    const log = readFileSync(fx.log, 'utf8');
    expect(log).toContain(`ARGS:plan ${SHA}`);
    expect(log).toContain(`ARGS:verify ${SHA}`);
    expect(log).toContain(`ARGS:restore ${SHA}`);
  });

  it('keeps the secret-shaped canary out of stdout (names-only output)', () => {
    const fx = setup();
    const r = channel(fx, `plan ${SHA} colo`);
    expect(r.code).toBe(0);
    expect(r.out).not.toContain(CANARY);
    expect(r.out).not.toContain('ARGS:');
    expect(r.out).not.toContain('stderr line');
    expect(r.out).toContain('geldar-deploy: plan colo ok');
  });

  it('reports a failing entrypoint with its exit code and a names-only line', () => {
    const fx = setup();
    const r = channel(fx, `apply ${SHA} colo`, fx.failing);
    expect(r.code).toBe(3);
    expect(r.out).toContain('apply colo failed (exit 3');
    expect(r.out).not.toContain(SHA);
  });
});

describe('deploy channel: installer (GE-04)', () => {
  it('places the wrapper, the sudoers fragment and the env template, and a second run changes nothing', () => {
    const fx = setup();
    const dest = join(fx.root, 'dest');
    const first = install(dest, 'op-user');
    expect(first.status).toBe(0);
    const libexec = join(dest, 'usr', 'local', 'libexec', 'geldar-deploy', 'channel');
    expect(readFileSync(libexec, 'utf8')).toContain('Forced-command deploy channel');
    const sudoers = readFileSync(join(dest, 'etc', 'sudoers.d', 'geldar-deploy'), 'utf8');
    expect(sudoers).toContain('op-user ALL=(root) NOPASSWD: SETENV:');
    expect(sudoers).not.toContain('@OPERATOR@');
    expect(existsSync(join(dest, 'home', 'op-user', 'colo-env.sh'))).toBe(true);
    const second = install(dest, 'op-user');
    expect(second.status).toBe(0);
    expect(second.stdout).not.toContain('installed');
    expect(second.stdout).toContain('unchanged');
  });

  it('keeps an existing node env file and refuses a bad operator account name', () => {
    const fx = setup();
    const dest = join(fx.root, 'dest');
    mkdirSync(join(dest, 'home', 'op-user'), { recursive: true });
    const envFile = join(dest, 'home', 'op-user', 'colo-env.sh');
    writeFileSync(envFile, 'export NODE_VALUE=kept\n');
    expect(install(dest, 'op-user').status).toBe(0);
    expect(readFileSync(envFile, 'utf8')).toBe('export NODE_VALUE=kept\n');
    const bad = install(dest, 'Bad Name;id');
    expect(bad.status).toBe(1);
  });

  it('the authorized_keys template forces the wrapper and carries a placeholder, not key material', () => {
    const text = readFileSync(join(GENESIS, 'authorized-keys.template'), 'utf8');
    expect(text).toContain('command="/usr/local/libexec/geldar-deploy/channel"');
    for (const opt of [
      'no-pty',
      'no-port-forwarding',
      'no-agent-forwarding',
      'no-X11-forwarding',
    ]) {
      expect(text).toContain(opt);
    }
    expect(text).toContain('<PUBLIC_KEY_PLACEHOLDER>');
    expect(text).not.toMatch(/AAAA[A-Za-z0-9+/]{20,}/);
  });
});
