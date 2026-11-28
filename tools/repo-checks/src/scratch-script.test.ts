/**
 * The scratch script (deploy/scratch/scratch.sh) under sh with docker, id, uname, df and powershell.exe stubbed: its
 * gates, NATS rule, port loader, up order and down rules. The stub harness is in scratch-harness.ts. These tests skip
 * when no sh is on PATH. Nothing here starts a container.
 */
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AUTH,
  assertStubsFirst,
  authDir,
  CAN_SYMLINK,
  HOME_UNSETTABLE,
  JARS,
  runScript,
  SECRETS_KEEP,
  SH,
  slash,
  started,
  stubs,
  withSecrets,
} from './scratch-harness.js';

describe.skipIf(!SH)('scratch script under sh', { timeout: 60_000 }, () => {
  it('sh resolves docker, id, uname and df to the stubs, and the guard refuses when it does not', () => {
    const s = stubs();
    try {
      expect(() => assertStubsFirst(join(s.base, 'bin'), s.env)).not.toThrow();
      expect(() => assertStubsFirst(join(s.base, 'no-such-bin'), s.env)).toThrow(/stub guard/);
    } finally {
      rmSync(s.base, { recursive: true, force: true });
    }
  });

  it.each([
    ['no NATS auth', {}, 'NATS auth is required'],
    ['a relative NATS auth dir', { SCRATCH_NATS_AUTH_DIR: 'auth' }, 'must be an absolute path'],
    ['a newline in the NATS auth dir', { SCRATCH_NATS_AUTH_DIR: '/var/auth\n/x' }, 'no newline'],
    [
      'a relative XDG_STATE_HOME',
      { ...AUTH, XDG_STATE_HOME: 'state' },
      'XDG_STATE_HOME must be an absolute path',
    ],
    [
      'a newline in XDG_STATE_HOME',
      { ...AUTH, XDG_STATE_HOME: '/var/state\n/x' },
      'XDG_STATE_HOME must be an absolute path',
    ],
    [
      'a drive-letter XDG_STATE_HOME on Linux',
      { ...AUTH, XDG_STATE_HOME: 'C:/state', STUB_UNAME: 'Linux' },
      'XDG_STATE_HOME must be an absolute path',
    ],
    [
      'a drive-letter NATS auth dir on Linux',
      { SCRATCH_NATS_AUTH_DIR: 'C:/auth', STUB_UNAME: 'Linux' },
      'must be an absolute path',
    ],
  ])('up with %s exits 2 and makes no docker call', (_name, env, message) => {
    const run = runScript(['up'], env);
    expect(run.status).toBe(2);
    expect(run.stderr).toContain(message);
    expect(run.calls).toEqual([]);
  });

  it('up with an auth dir missing one of the four files exits 2 and makes no docker call', () => {
    const dir = authDir();
    rmSync(join(dir, 'nats-eventsink.txt'));
    try {
      const run = runScript(['up'], { SCRATCH_NATS_AUTH_DIR: slash(dir) });
      expect(run.status).toBe(2);
      expect(run.stderr).toContain('nats-eventsink.txt');
      expect(run.calls).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.each([
    ['the RAM figure', { STUB_RAM_KB: 'abc' }, 'could not read free RAM or free disk as numbers'],
    [
      'the repo disk figure',
      { STUB_DISK_KB: 'abc' },
      'could not read free RAM or free disk as numbers',
    ],
    [
      'an unreadable Docker root figure',
      { STUB_DOCKER_KB: 'abc' },
      'could not read free RAM or free disk as numbers',
    ],
    ['the Docker root figure', { STUB_DOCKER_KB: '1000' }, 'gate failed'],
    ['the repo disk when the Docker root is larger', { STUB_DISK_KB: '1000' }, 'gate failed'],
    ['free RAM just below 10 GB', { STUB_RAM_KB: '10485759' }, 'gate failed'],
  ])('up exits 3 before any compose call on %s', (_name, stub, message) => {
    const run = runScript(['up'], { ...AUTH, ...stub });
    expect(run.status).toBe(3);
    expect(run.stderr).toContain(message);
    expect(started(run)).toBe(false);
  });

  it('up exits 3 with the Docker root unknown when docker info gives no root dir, before any compose call', () => {
    const run = runScript(['up'], { ...AUTH, STUB_NO_INFO: '1' });
    expect(run.status).toBe(3);
    expect(run.stderr).toContain("Docker root: 'unknown'");
    expect(started(run)).toBe(false);
  });

  // Docker Desktop on Windows reports a root inside its Linux VM: not a directory on the host, so the repo drive stands in.
  const vmRoot = (base: string) => ({ STUB_DOCKER_ROOT: slash(join(base, 'vm-root')) });

  it('reads the disk from the repo checkout when the Docker root is not a host path, and says so', () => {
    const run = runScript(['up'], (base) => ({ ...AUTH, ...vmRoot(base) }), JARS);
    expect(run.status).toBe(0);
    expect(run.stdout).toMatch(
      /gate: disk figure from the repo checkout .* \(docker root .*vm-root is not a host path\)/,
    );
    expect(run.stdout).toContain('free disk 47.7 GB (need 20 GB, the repo checkout');
    expect(started(run)).toBe(true);
  });

  it('refuses on the repo disk figure in the fallback when it is below 20 GB, before any compose call', () => {
    const run = runScript(['up'], (base) => ({ ...AUTH, ...vmRoot(base), STUB_DISK_KB: '1000' }));
    expect(run.status).toBe(3);
    expect(run.stdout).toContain('gate: disk figure from the repo checkout');
    expect(run.stderr).toContain('gate failed');
    expect(started(run)).toBe(false);
  });

  it.each([
    ['the RAM figure', { STUB_RAM_KB: 'abc' }],
    ['the repo disk figure', { STUB_DISK_KB: 'abc' }],
  ])(
    'with the Docker root not a host path and %s unreadable, refuses as before, with no fallback line',
    (_name, stub) => {
      const run = runScript(['up'], (base) => ({ ...AUTH, ...vmRoot(base), ...stub }));
      expect(run.status).toBe(3);
      expect(run.stderr).toContain(
        "could not read free RAM or free disk as numbers (Docker root: '",
      );
      expect(run.stdout).not.toContain('disk figure from');
      expect(started(run)).toBe(false);
    },
  );

  it('with the Docker root a real directory, prints the usual gate line and no fallback line', () => {
    const run = runScript(['up'], AUTH, JARS);
    expect(run.status).toBe(0);
    expect(run.stdout).toMatch(
      /gate: free RAM 19\.1 GB \(need 10 GB\), free disk 47\.7 GB \(need 20 GB, the smaller of .* and Docker root .*docker-root\)/,
    );
    expect(run.stdout).not.toContain('disk figure from');
  });

  it('with the Docker root a real directory and its figure unreadable, refuses and does not fall back to the repo disk', () => {
    const run = runScript(['up'], { ...AUTH, STUB_DOCKER_KB: 'abc' });
    expect(run.status).toBe(3);
    expect(run.stderr).toContain('could not read free RAM or free disk as numbers');
    expect(run.stdout).not.toContain('disk figure from');
    expect(started(run)).toBe(false);
  });

  it('up lists leftover containers with docker ps by the project label, before compose up, never with compose ps', () => {
    const run = runScript(['up'], AUTH, JARS);
    expect(run.status).toBe(0);
    const list = run.calls.findIndex((c) =>
      c.startsWith('ps -aq --filter label=com.docker.compose.project=scratch-a '),
    );
    const upAt = run.calls.findIndex((c) => c.startsWith('compose') && c.includes(' up -d'));
    expect(list).toBeGreaterThanOrEqual(0);
    expect(list).toBeLessThan(upAt);
    expect(run.calls.some((c) => c.startsWith('compose') && c.includes(' ps -aq'))).toBe(false);
  });

  it('up exits 1 with the secrets directory never made when docker ps fails', () => {
    const run = runScript(
      ['up'],
      { ...AUTH, STUB_FAIL_PS: '1' },
      {
        ...JARS,
        watch: ['state/geldar-scratch/scratch-a'],
      },
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('docker ps failed');
    expect(run.present['state/geldar-scratch/scratch-a']).toBe(false);
    expect(started(run)).toBe(false);
  });

  it('up exits 1 when compose is older than 2.24.4, and goes on at exactly 2.24.4', () => {
    const old = runScript(['up'], { ...AUTH, STUB_COMPOSE_VERSION: '2.24.3' }, JARS);
    expect(old.status).toBe(1);
    expect(old.stderr).toContain('older than 2.24.4');
    expect(started(old)).toBe(false);
    expect(runScript(['up'], { ...AUTH, STUB_COMPOSE_VERSION: '2.24.4' }, JARS).status).toBe(0);
  });

  it('up exits 1 when the caller uid is not GELDAR_SERVICE_UID, before any state directory is made', () => {
    const run = runScript(
      ['up'],
      { ...AUTH, GELDAR_SERVICE_UID: '999' },
      { ...JARS, watch: ['state/geldar-scratch'] },
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('run as uid 999');
    expect(run.present['state/geldar-scratch']).toBe(false);
    expect(started(run)).toBe(false);
  });

  it('up exits 1 naming the missing jar, with nothing made, when the plugins are not built', () => {
    const run = runScript(['up'], AUTH, { tree: { jars: false }, watch: ['state'] });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('missing plugin/core/build/libs/geldar-core.jar');
    expect(run.stderr).toContain('Nothing started');
    expect(run.present.state).toBe(false);
    expect(started(run)).toBe(false);
  });

  it('up with SCRATCH_NATS_OPEN=1 exits 2 before anything is written or started, with or without an auth dir', () => {
    const open = runScript(['up'], { SCRATCH_NATS_OPEN: '1' }, { ...JARS, watch: ['state'] });
    expect(open.status).toBe(2);
    expect(open.stderr).toContain('open NATS (SCRATCH_NATS_OPEN=1) is not supported');
    expect(open.stderr).toContain('the identity seed needs the NATS auth dir');
    expect(open.stderr).toContain('Set SCRATCH_NATS_AUTH_DIR');
    expect(open.stderr).toContain('Nothing started');
    expect(open.stderr).not.toContain('WARNING');
    expect(open.calls).toEqual([]);
    expect(open.present.state).toBe(false);
    expect(started(open)).toBe(false);
    const withAuth = runScript(['up'], { ...AUTH, SCRATCH_NATS_OPEN: '1' }, JARS);
    expect(withAuth.status).toBe(2);
    expect(withAuth.calls).toEqual([]);
    expect(started(withAuth)).toBe(false);
  });

  it('up with a valid auth dir writes the override, merges nats-auth.yml, and prints no warning', () => {
    const dir = authDir();
    try {
      const run = runScript(['up'], { SCRATCH_NATS_AUTH_DIR: slash(dir) }, JARS);
      expect(run.status).toBe(0);
      expect(run.stderr).not.toContain('WARNING');
      expect(run.calls.some((c) => c.includes('nats-auth.yml'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('gives the compose up call the compose variables (the stub fails compose calls without them)', () => {
    const run = runScript(['up'], AUTH, JARS);
    expect(run.status).toBe(0);
    const up = run.calls.find((c) => c.startsWith('compose') && c.includes(' up -d'));
    expect(up).toBeDefined();
    expect(up).not.toMatch(/SECRETS=(\s|$)/);
    expect(up).toContain('WORLD=scratch-a_paper-data');
  });

  it('refuses a suffix outside [a-z0-9]{1,9} with exit 2 and no docker call', () => {
    for (const suffix of ['A b', '../x', 'toolongsuffix', 'telemetry1']) {
      const run = runScript(['up', suffix], AUTH);
      expect(run.status, suffix).toBe(2);
      expect(run.stderr, suffix).toContain('[a-z0-9]{1,9}');
      expect(run.calls, suffix).toEqual([]);
    }
  });

  it('accepts the 9-character suffix telemetry and reaches compose as project scratch-telemetry', () => {
    const run = runScript(['up', 'telemetry'], AUTH, JARS);
    expect(run.status).toBe(0);
    expect(started(run)).toBe(true);
    const up = run.calls.find((c) => c.startsWith('compose') && c.includes(' up -d'));
    expect(up).toContain('-p scratch-telemetry ');
    expect(up).toContain('WORLD=scratch-telemetry_paper-data');
    expect(run.calls.some((c) => c.includes('-p scratch-a '))).toBe(false);
  });

  it('status for a project with no state prints no open-NATS warning', () => {
    const run = runScript(['status', 'zz']);
    expect(run.status).toBe(0);
    expect(run.stderr).not.toContain('WARNING');
    expect(run.stdout).toContain('no scratch stack state for scratch-zz');
  });

  it('status for a project whose secrets exist and have no override says it was not started with the auth dir', () => {
    const run = runScript(['status', 'a'], {}, { prepare: withSecrets });
    expect(run.status).toBe(0);
    expect(run.stderr).not.toContain('WARNING');
    expect(run.stdout).toContain(
      'no override for scratch-a (not started with SCRATCH_NATS_AUTH_DIR)',
    );
  });

  it('down removes a real owned state directory and exits 0', () => {
    const run = runScript(
      ['down'],
      {},
      { prepare: withSecrets, watch: ['state/geldar-scratch/scratch-a'] },
    );
    expect(run.calls.some((c) => c.includes('down -v --rmi local --remove-orphans'))).toBe(true);
    expect(run.status).toBe(0);
    expect(run.present['state/geldar-scratch/scratch-a']).toBe(false);
  });

  it('down keeps the secrets directory when compose down fails', () => {
    const run = runScript(
      ['down'],
      { STUB_FAIL_DOWN: '1' },
      { prepare: withSecrets, watch: [SECRETS_KEEP] },
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('compose down failed; the secrets directory is kept');
    expect(run.present[SECRETS_KEEP]).toBe(true);
  });

  it('down refuses a state path containing .. and keeps the directory', () => {
    const run = runScript(
      ['down'],
      (base) => ({ XDG_STATE_HOME: `${slash(join(base, 'state'))}/../state` }),
      {
        prepare: withSecrets,
        watch: [SECRETS_KEEP],
      },
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('refusing to remove');
    expect(run.present[SECRETS_KEEP]).toBe(true);
  });

  it('down refuses a regular file at the secrets path and keeps the file', () => {
    const run = runScript(
      ['down'],
      {},
      {
        prepare: (base) => {
          mkdirSync(join(base, 'state', 'geldar-scratch'), { recursive: true });
          writeFileSync(join(base, 'state', 'geldar-scratch', 'scratch-a'), 'x');
        },
        watch: ['state/geldar-scratch/scratch-a'],
      },
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('refusing to remove');
    expect(run.present['state/geldar-scratch/scratch-a']).toBe(true);
  });

  it.skipIf(!CAN_SYMLINK)(
    'down refuses a symlink at the secrets path and keeps the directory it points to',
    () => {
      const run = runScript(
        ['down'],
        {},
        {
          prepare: (base) => {
            mkdirSync(join(base, 'state', 'geldar-scratch'), { recursive: true });
            mkdirSync(join(base, 'victim'));
            writeFileSync(join(base, 'victim', 'keep.txt'), 'x');
            symlinkSync(
              join(base, 'victim'),
              join(base, 'state', 'geldar-scratch', 'scratch-a'),
              'dir',
            );
          },
          watch: ['victim/keep.txt'],
        },
      );
      expect(run.status).toBe(1);
      expect(run.stderr).toContain('refusing to remove');
      expect(run.present['victim/keep.txt']).toBe(true);
    },
  );

  it.skipIf(!HOME_UNSETTABLE)(
    'down with HOME and XDG_STATE_HOME both unset exits non-zero and makes no docker call',
    () => {
      const run = runScript(['down'], { HOME: undefined, XDG_STATE_HOME: undefined });
      expect(run.status).not.toBe(0);
      expect(run.calls).toEqual([]);
    },
  );
});

describe.skipIf(!SH)('scratch script under sh: port files', { timeout: 60_000 }, () => {
  const upCall = (run: { calls: string[] }) =>
    run.calls.find((c) => c.startsWith('compose') && c.includes(' up -d'));
  const withEnv = (envFile: string | null, jars = true) => ({ tree: { jars, envFile } });

  it('up telemetry reads telemetry.env: the compose call carries the 25432/24222/28222/45565 block', () => {
    const run = runScript(['up', 'telemetry'], AUTH, JARS);
    expect(run.status).toBe(0);
    expect(upCall(run)).toContain('PORTS=25432,24222,28222,45565');
  });

  it('status and down for telemetry also load the file, so every verb sees the same ports', () => {
    for (const verb of ['status', 'down']) {
      const run = runScript([verb, 'telemetry'], {}, JARS);
      expect(
        run.calls.some((c) => c.includes('PORTS=25432,24222,28222,45565')),
        verb,
      ).toBe(true);
    }
  });

  it('up telemetry with telemetry.env missing exits 2 and makes no docker call', () => {
    const run = runScript(['up', 'telemetry'], AUTH, withEnv(null));
    expect(run.status).toBe(2);
    expect(run.stderr).toContain('telemetry.env is missing');
    expect(run.calls).toEqual([]);
  });

  it('up scratch-a (the default suffix) sets no port variable', () => {
    const run = runScript(['up'], AUTH, JARS);
    expect(run.status).toBe(0);
    expect(upCall(run)).toContain('PORTS=,,,');
  });

  it('up scratch-a with no env file at all still works, and another suffix needs none', () => {
    for (const args of [['up'], ['up', 'zz']]) {
      const run = runScript(args, AUTH, withEnv(null));
      expect(run.status, args.join(' ')).toBe(0);
      expect(upCall(run), args.join(' ')).toContain('PORTS=,,,');
    }
  });

  it('an operator-set port variable wins over the file; the others come from the file', () => {
    const run = runScript(['up', 'telemetry'], { ...AUTH, SCRATCH_PG_PORT: '6543' }, JARS);
    expect(run.status).toBe(0);
    expect(upCall(run)).toContain('PORTS=6543,24222,28222,45565');
  });

  it.each([
    ['an unknown key', 'SCRATCH_PG_PORT=25432\nGELDAR_X=1\n', 'unknown key'],
    ['a key that only looks like a port key', 'SCRATCH_PG_PORTS=25432\n', 'unknown key'],
    ['a non-numeric value', 'SCRATCH_PG_PORT=abc\n', 'must be digits only'],
    ['a value with a trailing command', 'SCRATCH_PG_PORT=1;x\n', 'must be digits only'],
    ['an empty value', 'SCRATCH_PG_PORT=\n', 'must be digits only'],
    ['a line without an equals sign', 'SCRATCH_PG_PORT\n', 'must be digits only'],
    ['a value above 65535', 'SCRATCH_PG_PORT=65536\n', 'must be 1 to 65535'],
    ['a value of 70000', 'SCRATCH_PG_PORT=70000\n', 'must be 1 to 65535'],
    ['a value of 0', 'SCRATCH_PG_PORT=0\n', 'must be 1 to 65535'],
    ['a value of 000000', 'SCRATCH_PG_PORT=000000\n', 'must be 1 to 65535'],
  ])('up telemetry with %s in the file exits 2 and makes no docker call', (_n, text, message) => {
    const run = runScript(['up', 'telemetry'], AUTH, withEnv(text));
    expect(run.status).toBe(2);
    expect(run.stderr).toContain(message);
    expect(run.calls).toEqual([]);
  });

  it('accepts 1 and 65535, blank lines and comments', () => {
    const text = '# c\n\nSCRATCH_PG_PORT=1\nSCRATCH_NATS_PORT=65535\n# more\n';
    const run = runScript(['up', 'telemetry'], AUTH, withEnv(text));
    expect(run.status).toBe(0);
    expect(upCall(run)).toContain('PORTS=1,65535,,');
  });

  it('does not execute shell content: a command substitution value is refused and nothing runs', () => {
    const run = runScript(['up', 'telemetry'], AUTH, {
      ...withEnv('SCRATCH_PG_PORT=$(touch @BASE@/pwned)\n'),
      watch: ['pwned'],
    });
    expect(run.status).toBe(2);
    expect(run.stderr).toContain('must be digits only');
    expect(run.present.pwned).toBe(false);
    expect(run.calls).toEqual([]);
  });

  it('does not execute a command on its own line either', () => {
    const run = runScript(['up', 'telemetry'], AUTH, {
      ...withEnv('touch @BASE@/pwned\n'),
      watch: ['pwned'],
    });
    expect(run.status).toBe(2);
    expect(run.present.pwned).toBe(false);
  });
});
