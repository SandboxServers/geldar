// Tests for the forced-command deploy channel (G3-02): refused and accepted requests, the sudoers fragment and the installer.
// Its special-file tests are in genesis-deploy-channel-installer.test.ts. Shared helpers are in genesis-deploy-channel-harness.ts.
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CANARY,
  canSymlink,
  channel,
  cleanup,
  GENESIS,
  INSTALL_TIMEOUT,
  install,
  modeOf,
  p,
  pathWithoutVisudo,
  SHA,
  SUDOERS,
  setup,
  shim,
  WRAPPER,
  writeExecutable,
} from './genesis-deploy-channel-harness';

afterEach(cleanup);
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

  it('refuses verify and restore as not yet supported on this node, and runs nothing', () => {
    const fx = setup();
    for (const verb of ['verify', 'restore']) {
      const r = channel(fx, `${verb} ${SHA} colo`);
      expect(r.code, verb).toBe(1);
      expect(r.out, verb).toContain(`${verb} is not yet supported on this node`);
    }
    expect(existsSync(fx.log)).toBe(false);
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
      const r = channel(fx, `plan ${SHA} ${env}`, { bound: env });
      expect(r.code, env).toBe(1);
      expect(r.out, env).toContain('refused');
    }
    expect(existsSync(fx.log)).toBe(false);
  });

  it('refuses an environment other than the one the key is bound to, and a key with no binding', () => {
    const fx = setup();
    writeFileSync(join(fx.envDir, 'other.yaml'), 'token: x\n');
    const r = channel(fx, `plan ${SHA} other`, { bound: 'colo' });
    expect(r.code).toBe(1);
    expect(r.out).toContain('not the one this key is bound to');
    expect(channel(fx, `plan ${SHA} colo`, { bound: null }).code).toBe(1);
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

  // The lock is busy for the whole 60-second wait: the wrapper refuses with a fixed line that names no input.
  it('refuses with a fixed message when the lock is not free within the timeout, and runs nothing', () => {
    const fx = setup();
    const r = channel(fx, `plan ${SHA} colo`, { env: { FAKE_FLOCK_RC: '1' } });
    expect(r.code).toBe(1);
    expect(r.out).toContain(
      'refused: the deploy lock was not free within 60 seconds; try again later',
    );
    expect(r.out).not.toContain(SHA);
    expect(r.out).not.toContain('colo');
    expect(readFileSync(fx.flockCalls, 'utf8')).toContain('flock -w 60 9');
    expect(existsSync(fx.log)).toBe(false);
  });
});

describe('deploy channel: accepted requests (G3-02)', () => {
  it('runs apply as the entrypoint deploy verb, with a scrubbed environment', () => {
    const fx = setup();
    const r = channel(fx, `apply ${SHA} colo`);
    expect(r.code).toBe(0);
    expect(r.log).toContain(`ARGS:deploy ${SHA}`);
    expect(r.log).toContain('CANARY:unset');
  });

  // The wrapper does not pass GELDAR_DEPLOY_ENV on: the entrypoint sees it unset even when the wrapper inherits it.
  it('does not pass GELDAR_DEPLOY_ENV to the entrypoint', () => {
    const fx = setup();
    const r = channel(fx, `apply ${SHA} colo`, { env: { GELDAR_DEPLOY_ENV: 'colo' } });
    expect(r.code).toBe(0);
    expect(r.log).toContain('GELDAR_DEPLOY_ENV:unset');
    expect(r.log).not.toContain('GELDAR_DEPLOY_ENV:colo');
  });

  it('runs plan as the entrypoint plan verb', () => {
    const fx = setup();
    expect(channel(fx, `plan ${SHA} colo`).code).toBe(0);
    expect(readFileSync(fx.log, 'utf8')).toContain(`ARGS:plan ${SHA}`);
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
    const r = channel(fx, `apply ${SHA} colo`, { entry: fx.failing });
    expect(r.code).toBe(3);
    expect(r.out).toContain('apply colo failed (exit 3');
    expect(r.out).not.toContain(SHA);
  });

  it('gives the entrypoint an empty stdin, never the request stream', () => {
    const fx = setup();
    const r = channel(fx, `plan ${SHA} colo`, { input: 'piped-request-text\n' });
    expect(r.code).toBe(0);
    expect(r.log).toContain('STDIN:\n');
    expect(r.log).not.toContain('piped-request-text');
  });

  // The entrypoint runs with the lock descriptor closed: a write to fd 9 must fail inside it.
  it('closes the lock descriptor (fd 9) for the entrypoint', () => {
    const fx = setup();
    const stub = join(fx.root, 'fd9.sh');
    writeExecutable(
      stub,
      '#!/bin/sh\nif (: >&9) 2>/dev/null; then echo "FD9:open"; else echo "FD9:closed"; fi\n',
    );
    const r = channel(fx, `plan ${SHA} colo`, { entry: stub });
    expect(r.code).toBe(0);
    expect(r.log).toContain('FD9:closed');
    expect(r.log).not.toContain('FD9:open');
  });

  it('serialises the run on the lock file next to the allow-list', () => {
    const fx = setup();
    const r = channel(fx, `plan ${SHA} colo`);
    expect(r.code).toBe(0);
    expect(existsSync(fx.lock)).toBe(true);
    expect(readFileSync(fx.flockCalls, 'utf8')).toContain('flock -w 60 9');
  });

  it('refuses to run, and runs nothing, when flock is missing', () => {
    const fx = setup();
    const r = channel(fx, `plan ${SHA} colo`, { noFlock: true });
    expect(r.code).toBe(1);
    expect(r.out).toContain('refused: flock is missing; deploys on this node are not serialised');
    expect(r.out).not.toContain('started');
    expect(existsSync(fx.log)).toBe(false);
    expect(existsSync(fx.flockCalls)).toBe(false);
  });

  it('sets umask 077 before it creates the log (static: the production script says so)', () => {
    expect(readFileSync(WRAPPER, 'utf8')).toContain('\numask 077\n');
  });
});

describe('deploy channel: sudoers fragment (G3-02)', () => {
  const lines = () =>
    readFileSync(SUDOERS, 'utf8')
      .split('\n')
      .filter((l) => l.length > 0 && !l.startsWith('#'));

  it('has no SETENV, no wildcard and no ALL command', () => {
    const text = readFileSync(SUDOERS, 'utf8');
    expect(text).not.toContain('SETENV');
    expect(text).not.toContain('*');
    for (const l of lines()) {
      const cmds = l.includes('NOPASSWD:') ? l.split('NOPASSWD:')[1] : l;
      expect(cmds).not.toMatch(/\bALL\b/);
    }
  });

  it('authorises only plan and deploy, each with exactly one 40-character hex sha pattern', () => {
    const rules = lines().filter((l) => l.includes('NOPASSWD:'));
    expect(rules).toHaveLength(2);
    for (const [rule, verb] of [
      [rules[0], 'plan'],
      [rules[1], 'deploy'],
    ] as const) {
      expect(rule).toMatch(new RegExp(`/run ${verb} (\\[0-9a-f\\])+$`));
      expect(rule.split('[0-9a-f]').length - 1).toBe(40);
    }
    expect(rules.join('\n')).not.toMatch(/verify|restore/);
  });

  // The wrapper keeps no variable through sudo: no Defaults line of any kind may keep one.
  it('has no Defaults line, so sudo keeps no environment variable', () => {
    expect(lines().some((l) => l.startsWith('Defaults'))).toBe(false);
  });
});

describe('deploy channel: installer (GE-04)', () => {
  it(
    'places the wrapper, the sudoers fragment, the env template and the two channel files, with their modes',
    () => {
      const fx = setup();
      const dest = join(fx.root, 'dest');
      const first = install(dest, 'op-user');
      expect(first.status).toBe(0);
      for (const label of [
        '/usr/local/libexec/geldar-deploy/channel',
        '/etc/sudoers.d/geldar-deploy',
        '/home/op-user/colo-env.sh',
        '/var/lib/geldar-deploy/channel.log',
        '/var/lib/geldar-deploy/channel.lock',
      ]) {
        expect(first.stdout, label).toContain(`installed ${label}`);
      }
      const libexec = join(dest, 'usr', 'local', 'libexec', 'geldar-deploy', 'channel');
      expect(readFileSync(libexec, 'utf8')).toContain('Forced-command deploy channel');
      const sudoers = join(dest, 'etc', 'sudoers.d', 'geldar-deploy');
      expect(readFileSync(sudoers, 'utf8')).toContain(
        'op-user ALL=(root) NOPASSWD: /usr/local/libexec/geldar-deploy/run plan ',
      );
      expect(readFileSync(sudoers, 'utf8')).not.toContain('@OPERATOR@');
      const envFile = join(dest, 'home', 'op-user', 'colo-env.sh');
      expect(existsSync(envFile)).toBe(true);
      if (process.platform !== 'win32') {
        expect(modeOf(libexec)).toBe(0o755);
        expect(modeOf(sudoers)).toBe(0o440);
        expect(modeOf(envFile)).toBe(0o600);
        expect(modeOf(join(dest, 'var', 'lib', 'geldar-deploy', 'channel.log'))).toBe(0o600);
        expect(modeOf(join(dest, 'var', 'lib', 'geldar-deploy', 'channel.lock'))).toBe(0o600);
      }
    },
    INSTALL_TIMEOUT,
  );

  // Needs POSIX mode bits: Windows does not keep them, so the stat check always sees drift there.
  it.skipIf(process.platform === 'win32')(
    'a second run changes nothing',
    () => {
      const fx = setup();
      const dest = join(fx.root, 'dest');
      expect(install(dest, 'op-user').status).toBe(0);
      const second = install(dest, 'op-user');
      expect(second.status).toBe(0);
      expect(second.stdout).not.toContain('installed');
      expect(second.stdout).not.toContain('repaired');
      expect(second.stdout).toContain('unchanged');
    },
    INSTALL_TIMEOUT,
  );

  it.skipIf(process.platform === 'win32')(
    'repairs drifted modes on every run, never changes the env file contents, and never chowns or chmods it by path',
    () => {
      const fx = setup();
      const dest = join(fx.root, 'dest');
      const sh = shim(fx.root);
      expect(install(dest, 'op-user').status).toBe(0);
      const chan = join(dest, 'usr', 'local', 'libexec', 'geldar-deploy', 'channel');
      const sudoers = join(dest, 'etc', 'sudoers.d', 'geldar-deploy');
      const envFile = join(dest, 'home', 'op-user', 'colo-env.sh');
      for (const f of [chan, sudoers, envFile]) chmodSync(f, 0o644);
      rmSync(sh.calls, { force: true });
      const drift = install(dest, 'op-user');
      expect(drift.status).toBe(0);
      expect(drift.stdout).toContain('repaired /usr/local/libexec/geldar-deploy/channel');
      expect(drift.stdout).toContain('repaired /etc/sudoers.d/geldar-deploy');
      expect(drift.stdout).toContain('repaired /home/op-user/colo-env.sh');
      expect(modeOf(chan)).toBe(0o755);
      expect(modeOf(sudoers)).toBe(0o440);
      expect(modeOf(envFile)).toBe(0o600);
      // The env file is repaired in the root-owned work dir and renamed into place: no chown or chmod names its path.
      expect(readFileSync(sh.calls, 'utf8')).not.toContain('home/op-user');
      expect(readFileSync(envFile, 'utf8')).toBe(
        readFileSync(join(GENESIS, 'colo-env.sh.template'), 'utf8'),
      );
    },
    INSTALL_TIMEOUT,
  );

  // A running deploy holds flock on the log's inode: a drifted log is repaired in place, so its contents and inode stay.
  it.skipIf(process.platform === 'win32')(
    'repairs a drifted channel.log in place: its contents and inode are kept',
    () => {
      const fx = setup();
      const dest = join(fx.root, 'dest');
      const sh = shim(fx.root);
      expect(install(dest, 'op-user').status).toBe(0);
      const log = join(dest, 'var', 'lib', 'geldar-deploy', 'channel.log');
      writeFileSync(log, 'run in progress\n');
      chmodSync(log, 0o644);
      const inode = statSync(log).ino;
      rmSync(sh.calls, { force: true });
      const r = install(dest, 'op-user');
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('repaired /var/lib/geldar-deploy/channel.log');
      expect(statSync(log).ino).toBe(inode);
      expect(readFileSync(log, 'utf8')).toBe('run in progress\n');
      expect(modeOf(log)).toBe(0o600);
      expect(readFileSync(sh.calls, 'utf8')).toMatch(/chown op-user:op-user .*\nchmod 0600 /);
    },
    INSTALL_TIMEOUT,
  );

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

  // The installer no longer stages the sudoers file at the old fixed name geldar-deploy.new. This proves only that a symlink
  // planted at that name is not written through. It does not test mktemp's randomness.
  it.skipIf(!canSymlink())(
    'the old fixed sudoers temp name is gone: a symlink planted there is not written through',
    () => {
      const fx = setup();
      const dest = join(fx.root, 'dest');
      mkdirSync(join(dest, 'etc', 'sudoers.d'), { recursive: true });
      const victim = join(fx.root, 'victim');
      writeFileSync(victim, 'keep\n');
      symlinkSync(victim, join(dest, 'etc', 'sudoers.d', 'geldar-deploy.new'));
      const r = install(dest, 'op-user');
      expect(r.status).toBe(0);
      expect(readFileSync(victim, 'utf8')).toBe('keep\n');
    },
    INSTALL_TIMEOUT,
  );

  it.skipIf(!canSymlink())(
    'refuses a symlinked colo-env.sh in the operator home and leaves its target alone',
    () => {
      const fx = setup();
      const dest = join(fx.root, 'dest');
      const home = join(dest, 'home', 'op-user');
      mkdirSync(home, { recursive: true });
      const target = join(fx.root, 'target-env');
      writeFileSync(target, 'export NODE_VALUE=target\n');
      symlinkSync(target, join(home, 'colo-env.sh'));
      const r = install(dest, 'op-user');
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('symlink; refused');
      expect(readFileSync(target, 'utf8')).toBe('export NODE_VALUE=target\n');
    },
    INSTALL_TIMEOUT,
  );

  it.skipIf(!canSymlink())(
    'refuses a symlinked *.yaml in the allow-list',
    () => {
      const fx = setup();
      const dest = join(fx.root, 'dest');
      const envs = join(dest, 'var', 'lib', 'geldar-deploy', 'envs');
      mkdirSync(envs, { recursive: true });
      symlinkSync(join(fx.root, 'colo.yaml'), join(envs, 'colo.yaml'));
      const r = install(dest, 'op-user');
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('symlinked *.yaml');
    },
    INSTALL_TIMEOUT,
  );

  // A visudo that rejects the fragment: the installer stops and nothing is placed under sudoers.
  it(
    'stops, and installs no sudoers file, when visudo rejects the fragment',
    () => {
      const fx = setup();
      const dest = join(fx.root, 'dest');
      const visudoDir = join(fx.root, 'visudo-reject');
      mkdirSync(visudoDir);
      writeExecutable(join(visudoDir, 'visudo'), '#!/bin/sh\nexit 1\n');
      const r = install(dest, 'op-user', { args: [], prefix: p(visudoDir) });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('does not check');
      expect(existsSync(join(dest, 'etc', 'sudoers.d', 'geldar-deploy'))).toBe(false);
    },
    INSTALL_TIMEOUT,
  );

  // Runs everywhere: the PATH has no visudo on it, so the installer must refuse unless --skip-visudo is given.
  it(
    'fails when visudo is absent unless --skip-visudo is given',
    () => {
      const fx = setup();
      const dest = join(fx.root, 'dest');
      const r = install(dest, 'op-user', { args: [], path: pathWithoutVisudo(fx.root) });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('visudo is absent');
      expect(install(dest, 'op-user', { args: ['--skip-visudo'] }).status).toBe(0);
    },
    INSTALL_TIMEOUT,
  );

  it('the authorized_keys template forces the wrapper with the bound environment and restrict', () => {
    const text = readFileSync(join(GENESIS, 'authorized-keys.template'), 'utf8');
    expect(text).toContain(
      'command="/usr/local/libexec/geldar-deploy/channel <ENVIRONMENT>",restrict ',
    );
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

  // The key line is the only non-comment line: it must start with the forced command, bound to <ENVIRONMENT>, and restrict.
  it('the authorized_keys key line starts with the forced command and restrict, and nothing else is on it', () => {
    const keyLines = readFileSync(join(GENESIS, 'authorized-keys.template'), 'utf8')
      .split('\n')
      .filter((l) => l.length > 0 && !l.startsWith('#'));
    expect(keyLines).toHaveLength(1);
    expect(
      keyLines[0].startsWith(
        'command="/usr/local/libexec/geldar-deploy/channel <ENVIRONMENT>",restrict ssh-ed25519 ',
      ),
    ).toBe(true);
  });
});
