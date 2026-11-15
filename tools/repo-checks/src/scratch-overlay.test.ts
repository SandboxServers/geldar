/**
 * The scratch stack overlay (compose/opt-in/scratch.yml) and its script (deploy/scratch/scratch.sh). The overlay is parsed
 * with the yaml package, the !override tag as a custom tag, so the exact ports and limits are checked. The script's
 * gates, NATS rule, up order and down rules run under sh with docker, id, uname, df and powershell.exe stubbed on PATH;
 * those tests skip when no sh is on PATH. Nothing here starts a container.
 */
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SCRIPT_PATH = `${ROOT}deploy/scratch/scratch.sh`;
const SCRIPT = readFileSync(SCRIPT_PATH, 'utf8');

const SH = spawnSync('sh', ['-c', 'exit 0']).status === 0 ? 'sh' : null;

/** Windows needs a privilege to make symlinks, so that case runs only where one can be made. */
const CAN_SYMLINK = (() => {
  const dir = mkdtempSync(join(tmpdir(), 'scratch-link-'));
  try {
    writeFileSync(join(dir, 'target'), 'x');
    symlinkSync(join(dir, 'target'), join(dir, 'link'));
    return true;
  } catch {
    return false;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
})();

/** MSYS sh fills HOME in when it is unset, so the unset-HOME case runs only where sh really sees no HOME. */
const HOME_UNSETTABLE =
  SH !== null &&
  spawnSync(SH, ['-c', '[ -n "$HOME" ] || echo unset'], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '', SYSTEMROOT: process.env.SYSTEMROOT ?? '' },
  }).stdout.trim() === 'unset';

type Env = Record<string, string | undefined>;
interface RunOpts {
  /** Runs a copy of the script in a temp tree; jars adds the two plugin jars the script checks for. */
  tree?: { jars: boolean };
  /** Sets up files under the stub base dir before the script runs. */
  prepare?: (base: string) => void;
  /** Paths relative to the stub base dir whose existence is recorded after the run. */
  watch?: string[];
}
interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
  /** One line per docker call, with the compose variables the stub saw. */
  calls: string[];
  /** One line per chmod call, as its arguments (mode then path). */
  chmods: string[];
  present: Record<string, boolean>;
}

/** Forward slashes: the script takes these paths as given, and sh on Windows reads them fine. */
const slash = (path: string) => path.replace(/\\/g, '/');

/** The stub bin dir and the default environment. docker logs each call with the compose variables, fails compose calls
 * that lack them (as compose does for a required variable), answers compose version and info, and fails down when
 * STUB_FAIL_DOWN is set. info prints no Docker root when STUB_NO_INFO is set; any ps -aq call fails when STUB_FAIL_PS
 * is set. df prints STUB_DOCKER_KB for the Docker root and STUB_DISK_KB for the repo; id says 1000; uname says
 * MINGW64_NT unless STUB_UNAME is set; powershell.exe prints STUB_RAM_KB. */
function stubs(): { base: string; env: Env } {
  const base = mkdtempSync(join(tmpdir(), 'scratch-stub-'));
  const bin = join(base, 'bin');
  mkdirSync(bin);
  mkdirSync(join(base, 'home'));
  const files: Record<string, string> = {
    docker: [
      '#!/bin/sh',
      'echo "$* SECRETS=$SCRATCH_SECRETS_DIR WORLD=$GELDAR_WORLD_VOLUME" >>"$STUB_LOG"',
      'if [ "$1" = compose ] && { [ -z "$SCRATCH_SECRETS_DIR" ] || [ -z "$GELDAR_WORLD_VOLUME" ]; }; then',
      '  echo "required variable SCRATCH_SECRETS_DIR or GELDAR_WORLD_VOLUME is missing a value" >&2; exit 1',
      'fi',
      'case "$*" in',
      '  *"version --short"*) echo "$STUB_COMPOSE_VERSION" ;;',
      '  *"ps -aq"*) [ -z "$STUB_FAIL_PS" ] || exit 1 ;;',
      '  *" down -v"*) [ -z "$STUB_FAIL_DOWN" ] || exit 1 ;;',
      '  info*) [ -n "$STUB_NO_INFO" ] || echo /var/lib/docker ;;',
      'esac',
      'exit 0',
      '',
    ].join('\n'),
    id: '#!/bin/sh\necho "${STUB_UID:-1000}"\n',
    // chmod, stat and getfacl are stubs so the mode and ACL rules run the same on every host. chmod logs to its own
    // file, not to the docker log; stat prints STUB_MODE (default 700); getfacl prints STUB_ACL for every path.
    chmod: '#!/bin/sh\necho "$*" >>"$STUB_CHMOD_LOG"\nexit 0\n',
    stat: '#!/bin/sh\necho "${STUB_MODE:-700}"\n',
    getfacl: '#!/bin/sh\nprintf "%s\\n" "$STUB_ACL"\n',
    uname: '#!/bin/sh\n[ -z "$STUB_UNAME" ] && echo MINGW64_NT || echo "$STUB_UNAME"\n',
    'powershell.exe': '#!/bin/sh\necho "$STUB_RAM_KB"\n',
    df: [
      '#!/bin/sh',
      'echo Filesystem',
      'case "$*" in',
      '  */var/lib/docker*) echo "x 1 1 $STUB_DOCKER_KB 1% /var/lib/docker" ;;',
      '  *) echo "x 1 1 $STUB_DISK_KB 1% /" ;;',
      'esac',
      '',
    ].join('\n'),
  };
  for (const [name, text] of Object.entries(files)) {
    const path = join(bin, name);
    writeFileSync(path, text, { mode: 0o755 });
    chmodSync(path, 0o755);
  }
  const env: Env = {
    PATH: `${bin}${delimiter}${process.env.PATH ?? ''}`,
    HOME: slash(join(base, 'home')),
    XDG_STATE_HOME: slash(join(base, 'state')),
    SYSTEMROOT: process.env.SYSTEMROOT ?? '',
    STUB_LOG: slash(join(base, 'docker.log')),
    STUB_CHMOD_LOG: slash(join(base, 'chmod.log')),
    STUB_RAM_KB: '20000000',
    STUB_DISK_KB: '50000000',
    STUB_DOCKER_KB: '50000000',
    STUB_COMPOSE_VERSION: '2.30.0',
    STUB_FAIL_DOWN: '',
  };
  return { base, env };
}

/** The tools the stubs replace. On Linux sh skips a file without the exec bit and runs the real tool, so the guard checks
 * that each one resolves inside the stub bin dir. */
const STUBBED = ['docker', 'id', 'uname', 'df', 'chmod', 'stat', 'getfacl'];

/** Throws before any script starts unless sh, with this PATH, resolves every stubbed tool inside the stub bin dir. */
function assertStubsFirst(bin: string, env: Env): void {
  // sh does the comparison in its own path form (MSYS maps Windows temp dirs to /tmp), so $1 is the bin dir as given.
  const checks = STUBBED.map(
    (t) => `p=$(command -v ${t}); case "$p" in "$B/${t}") echo OK ;; *) echo "$p" ;; esac`,
  );
  const probe = spawnSync(
    SH as string,
    ['-c', `B=$(cd "$1" && pwd); ${checks.join('; ')}`, 'guard', slash(bin)],
    {
      encoding: 'utf8',
      env: { PATH: env.PATH ?? '', SYSTEMROOT: env.SYSTEMROOT ?? '' },
    },
  );
  const lines = probe.stdout.trim().split('\n');
  STUBBED.forEach((tool, i) => {
    if (lines[i] !== 'OK') {
      throw new Error(
        `stub guard: sh resolves ${tool} to '${lines[i] ?? ''}', not inside ${bin}; refusing to run`,
      );
    }
  });
}

/** A copy of the script in base/tree, with the plugin jars when asked. The script finds its root from its own path. */
function makeTree(base: string, jars: boolean): string {
  const script = join(base, 'tree', 'deploy', 'scratch', 'scratch.sh');
  mkdirSync(dirname(script), { recursive: true });
  writeFileSync(script, SCRIPT);
  if (jars) {
    for (const jar of [
      'plugin/core/build/libs/geldar-core.jar',
      'plugin/velocity-identity/build/libs/geldar-velocity-identity.jar',
    ]) {
      mkdirSync(dirname(join(base, 'tree', jar)), { recursive: true });
      writeFileSync(join(base, 'tree', jar), 'jar');
    }
  }
  return script;
}

/** Runs the script under sh with the stubs. Only the given environment is passed (an undefined value removes a key), so
 * no SCRATCH_* variable leaks in. The extra environment may be a function of the stub base dir. */
function runScript(
  args: string[],
  extra: Env | ((base: string) => Env) = {},
  opts: RunOpts = {},
): Run {
  const s = stubs();
  const env: Env = { ...s.env, ...(typeof extra === 'function' ? extra(s.base) : extra) };
  for (const key of Object.keys(env)) if (env[key] === undefined) delete env[key];
  try {
    opts.prepare?.(s.base);
    const script = opts.tree ? makeTree(s.base, opts.tree.jars) : SCRIPT_PATH;
    assertStubsFirst(join(s.base, 'bin'), env);
    const result = spawnSync(SH as string, [script, ...args], {
      encoding: 'utf8',
      env: env as Record<string, string>,
    });
    const log = join(s.base, 'docker.log');
    const calls = existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean) : [];
    const chmodLog = join(s.base, 'chmod.log');
    const chmods = existsSync(chmodLog)
      ? readFileSync(chmodLog, 'utf8').split('\n').filter(Boolean)
      : [];
    const present = Object.fromEntries(
      (opts.watch ?? []).map((rel) => [rel, existsSync(join(s.base, rel))]),
    );
    return {
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
      calls,
      chmods,
      present,
    };
  } finally {
    rmSync(s.base, { recursive: true, force: true });
  }
}

const OPEN: Env = { SCRATCH_NATS_OPEN: '1' };
const JARS: RunOpts = { tree: { jars: true } };
/** True when a docker call reached compose with the project flag: the stack was about to start. */
const started = (run: Run) => run.calls.some((c) => c.includes('-p scratch-'));
/** The state directory of scratch-a, with one file in it, as a started or half-removed stack leaves it. */
const SECRETS_KEEP = 'state/geldar-scratch/scratch-a/keep.txt';
const withSecrets = (base: string) => {
  const dir = join(base, 'state', 'geldar-scratch', 'scratch-a');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'keep.txt'), 'x');
};

/** A directory with the four NATS files, non-empty, for SCRATCH_NATS_AUTH_DIR. */
function authDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'scratch-auth-'));
  for (const f of ['nats-auth.conf', 'nats-paper.txt', 'nats-velocity.txt', 'nats-eventsink.txt'])
    writeFileSync(join(dir, f), 'x');
  return dir;
}

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
      { ...OPEN, XDG_STATE_HOME: 'state' },
      'XDG_STATE_HOME must be an absolute path',
    ],
    [
      'a newline in XDG_STATE_HOME',
      { ...OPEN, XDG_STATE_HOME: '/var/state\n/x' },
      'XDG_STATE_HOME must be an absolute path',
    ],
    [
      'a drive-letter XDG_STATE_HOME on Linux',
      { ...OPEN, XDG_STATE_HOME: 'C:/state', STUB_UNAME: 'Linux' },
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
    const run = runScript(['up'], { ...OPEN, ...stub });
    expect(run.status).toBe(3);
    expect(run.stderr).toContain(message);
    expect(started(run)).toBe(false);
  });

  it('up exits 3 with the Docker root unknown when docker info gives no root dir, before any compose call', () => {
    const run = runScript(['up'], { ...OPEN, STUB_NO_INFO: '1' });
    expect(run.status).toBe(3);
    expect(run.stderr).toContain("Docker root: 'unknown'");
    expect(started(run)).toBe(false);
  });

  it('up lists leftover containers with docker ps by the project label, before compose up, never with compose ps', () => {
    const run = runScript(['up'], OPEN, JARS);
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
      { ...OPEN, STUB_FAIL_PS: '1' },
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
    const old = runScript(['up'], { ...OPEN, STUB_COMPOSE_VERSION: '2.24.3' }, JARS);
    expect(old.status).toBe(1);
    expect(old.stderr).toContain('older than 2.24.4');
    expect(started(old)).toBe(false);
    expect(runScript(['up'], { ...OPEN, STUB_COMPOSE_VERSION: '2.24.4' }, JARS).status).toBe(0);
  });

  it('up exits 1 when the caller uid is not GELDAR_SERVICE_UID, before any state directory is made', () => {
    const run = runScript(
      ['up'],
      { ...OPEN, GELDAR_SERVICE_UID: '999' },
      { ...JARS, watch: ['state/geldar-scratch'] },
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('run as uid 999');
    expect(run.present['state/geldar-scratch']).toBe(false);
    expect(started(run)).toBe(false);
  });

  it('up exits 1 naming the missing jar, with nothing made, when the plugins are not built', () => {
    const run = runScript(['up'], OPEN, { tree: { jars: false }, watch: ['state'] });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('missing plugin/core/build/libs/geldar-core.jar');
    expect(run.stderr).toContain('Nothing started');
    expect(run.present.state).toBe(false);
    expect(started(run)).toBe(false);
  });

  it('up with SCRATCH_NATS_OPEN=1 prints the multi-line warning, starts, and never merges nats-auth.yml', () => {
    const run = runScript(['up'], OPEN, {
      ...JARS,
      watch: ['state/geldar-scratch/scratch-a/postgres.txt'],
    });
    expect(run.status).toBe(0);
    expect(run.stderr).toContain('WARNING: NATS IS OPEN for scratch-a');
    expect(run.stderr).toContain('No role ACLs. Any local user or process can connect');
    expect(run.calls.some((c) => c.includes('up -d --wait --build'))).toBe(true);
    expect(run.calls.some((c) => c.includes('nats-auth.yml'))).toBe(false);
    expect(run.present['state/geldar-scratch/scratch-a/postgres.txt']).toBe(true);
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
    const run = runScript(['up'], OPEN, JARS);
    expect(run.status).toBe(0);
    const up = run.calls.find((c) => c.startsWith('compose') && c.includes(' up -d'));
    expect(up).toBeDefined();
    expect(up).not.toMatch(/SECRETS=(\s|$)/);
    expect(up).toContain('WORLD=scratch-a_paper-data');
  });

  it('refuses a suffix outside [a-z0-9]{1,8} with exit 2 and no docker call', () => {
    for (const suffix of ['A b', '../x', 'toolongsuffix']) {
      const run = runScript(['up', suffix], OPEN);
      expect(run.status, suffix).toBe(2);
      expect(run.calls, suffix).toEqual([]);
    }
  });

  it('status for a project with no state prints no open-NATS warning', () => {
    const run = runScript(['status', 'zz']);
    expect(run.status).toBe(0);
    expect(run.stderr).not.toContain('WARNING');
    expect(run.stdout).toContain('no scratch stack state for scratch-zz');
  });

  it('status for a project whose secrets exist and have no override prints the open-NATS warning', () => {
    const run = runScript(['status', 'a'], {}, { prepare: withSecrets });
    expect(run.status).toBe(0);
    expect(run.stderr).toContain('WARNING: NATS IS OPEN for scratch-a');
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

/** The secrets dir of scratch-a, relative to the stub base dir, and the uid settings for a container uid of 1000. */
const SECRETS_DIR_REL = 'state/geldar-scratch/scratch-a';
const OTHER_UID: Env = { SCRATCH_CONTAINER_UID: '1000', STUB_UID: '1001' };

describe.skipIf(!SH)('scratch script: container uid', { timeout: 60_000 }, () => {
  it('keeps the 0600 secret files when the account and container uids are equal', () => {
    const run = runScript(['up'], OPEN, JARS);
    expect(started(run)).toBe(true);
    expect(run.chmods.filter((c) => /^(644|711) /.test(c))).toEqual([]);
  });

  it('makes the secrets dir 0711 and the three secret files 0644 when the uids differ', () => {
    const run = runScript(['up'], { ...OPEN, ...OTHER_UID }, JARS);
    expect(started(run)).toBe(true);
    expect(run.chmods.some((c) => /^711 .*geldar-scratch\/scratch-a$/.test(c))).toBe(true);
    const files = ['postgres.txt', 'rcon.txt', 'velocity-forwarding.txt'];
    for (const f of files) {
      expect(run.chmods.some((c) => c.startsWith('644 ') && c.endsWith(`scratch-a/${f}`))).toBe(
        true,
      );
    }
    expect(run.chmods.filter((c) => c.startsWith('644 '))).toHaveLength(3);
  });

  it('refuses with exit 1 when the state dir is not 0700, before the secrets dir is made', () => {
    const extra = { ...OPEN, ...OTHER_UID, STUB_MODE: '755' };
    const run = runScript(['up'], extra, { ...JARS, watch: [SECRETS_DIR_REL] });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('not mode 0700');
    expect(started(run)).toBe(false);
    expect(run.chmods.some((c) => /^(644|711) /.test(c))).toBe(false);
    expect(run.present[SECRETS_DIR_REL]).toBe(false);
  });

  it.each(['0', '', 'abc', '10 00', '-1'])(
    'rejects SCRATCH_CONTAINER_UID=%j with exit 2 and no compose call',
    (uid) => {
      const run = runScript(['up'], { ...OPEN, SCRATCH_CONTAINER_UID: uid }, JARS);
      expect(run.status).toBe(2);
      expect(run.stderr).toContain('SCRATCH_CONTAINER_UID');
      expect(started(run)).toBe(false);
    },
  );

  it('exits 2 and changes no file when the NATS dir has no ACL for the container uid', () => {
    const extra = { ...OTHER_UID, SCRATCH_NATS_AUTH_DIR: slash(authDir()) };
    const run = runScript(['up'], extra, JARS);
    expect(run.status).toBe(2);
    expect(run.stderr).toContain('setfacl -m u:1000:r');
    expect(started(run)).toBe(false);
    expect(run.chmods).toEqual([]);
  });

  it('goes on when the NATS dir ACL gives the container uid read and others nothing', () => {
    const dir = slash(authDir());
    const extra = {
      ...OTHER_UID,
      SCRATCH_NATS_AUTH_DIR: dir,
      STUB_ACL: 'user:1000:r-x\nother::---',
    };
    const run = runScript(['up'], extra, JARS);
    expect(run.status).toBe(0);
    expect(started(run)).toBe(true);
  });
});
