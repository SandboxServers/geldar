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
import { type CollectionTag, parse } from 'yaml';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const OVERLAY_TEXT = readFileSync(`${ROOT}compose/opt-in/scratch.yml`, 'utf8');
const SCRIPT_PATH = `${ROOT}deploy/scratch/scratch.sh`;
const SCRIPT = readFileSync(SCRIPT_PATH, 'utf8');
const PHASE0_TEXT = readFileSync(`${ROOT}compose/phase0.yml`, 'utf8');

/** compose replaces the list under !override instead of appending to it; the parsed value is marked. */
const OVERRIDE: CollectionTag = {
  tag: '!override',
  collection: 'seq',
  resolve: (node: unknown) => ({ override: true, items: (node as { toJSON(): unknown }).toJSON() }),
};

interface Service {
  ports?: { override: boolean; items: string[] } | string[];
  deploy?: { resources: { limits: { memory: string; cpus: string } } };
  memswap_limit?: string;
  restart?: string;
  labels?: Record<string, string>;
}
interface Overlay {
  services: Record<string, Service>;
  secrets: Record<string, { file: string }>;
}

const OVERLAY = parse(OVERLAY_TEXT, { customTags: [OVERRIDE] }) as Overlay;
const BASE = parse(PHASE0_TEXT) as { services: Record<string, { ports?: string[] }> };
const OVERLAY_SERVICES = ['postgres', 'nats', 'paper', 'velocity', 'eventsink'];

/** The host port of a published mapping such as "127.0.0.1:5432:5432" (host is the second field from the end). */
function hostPort(mapping: string): number {
  const match = mapping.match(/(\d+):\d+$/);
  if (!match?.[1]) throw new Error(`no host port in ${mapping}`);
  return Number(match[1]);
}

describe('scratch overlay: ports', () => {
  it('replaces the ports of postgres, nats and velocity with exact loopback mappings', () => {
    expect(OVERLAY.services.postgres?.ports).toEqual({
      override: true,
      items: [`127.0.0.1:\${SCRATCH_PG_PORT:-15432}:5432`],
    });
    expect(OVERLAY.services.nats?.ports).toEqual({
      override: true,
      items: [
        `127.0.0.1:\${SCRATCH_NATS_PORT:-14222}:4222`,
        `127.0.0.1:\${SCRATCH_NATS_MON_PORT:-18222}:8222`,
      ],
    });
    expect(OVERLAY.services.velocity?.ports).toEqual({
      override: true,
      items: [`127.0.0.1:\${SCRATCH_MC_PORT:-35565}:25565`],
    });
  });

  it('gives paper and eventsink no ports key, so they publish nothing', () => {
    expect(OVERLAY.services.paper).not.toHaveProperty('ports');
    expect(OVERLAY.services.eventsink).not.toHaveProperty('ports');
  });

  it('uses the four defaults the runbook names, and none of them is a phase0 host port', () => {
    const defaults = [...OVERLAY_TEXT.matchAll(/\$\{SCRATCH_[A-Z_]+:-(\d+)\}/g)].map((m) =>
      Number(m[1]),
    );
    expect(defaults.sort((a, b) => a - b)).toEqual([14222, 15432, 18222, 35565]);
    const phase0Hosts = Object.values(BASE.services).flatMap((s) => (s.ports ?? []).map(hostPort));
    expect(phase0Hosts).toContain(5432);
    for (const port of defaults) expect(phase0Hosts).not.toContain(port);
  });

  it('binds every overlay mapping to 127.0.0.1 and no other address', () => {
    expect(OVERLAY_TEXT).not.toMatch(/0\.0\.0\.0/);
    const addresses = OVERLAY_TEXT.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g) ?? [];
    expect(addresses.filter((address) => address !== '127.0.0.1')).toEqual([]);
    expect(OVERLAY_TEXT).not.toMatch(/container_name/);
  });
});

describe('scratch overlay: caps and secrets', () => {
  it.each(OVERLAY_SERVICES)(
    'caps %s, sets memswap to the memory cap, restart "no", and the label',
    (name) => {
      const service = OVERLAY.services[name];
      const limits = service?.deploy?.resources.limits;
      expect(limits?.memory).toMatch(/^\d+m$/);
      expect(limits?.cpus).toMatch(/^[\d.]+$/);
      expect(service?.memswap_limit).toBe(limits?.memory);
      expect(service?.restart).toBe('no');
      expect(service?.labels).toEqual({ 'geldar.scratch': 'true' });
    },
  );

  it('caps every service that phase0.yml defines, so a new service cannot run uncapped', () => {
    for (const name of Object.keys(BASE.services)) {
      expect(OVERLAY.services[name]?.deploy?.resources.limits.memory, name).toBeDefined();
    }
  });

  it('keeps the paper heap default at 2G and the paper cap at 3072m', () => {
    expect(OVERLAY_TEXT).toContain(`MEMORY: \${PAPER_MEMORY:-2G}`);
    expect(OVERLAY.services.paper?.deploy?.resources.limits.memory).toBe('3072m');
  });

  it('takes the postgres, rcon and forwarding secrets from the state directory only', () => {
    expect(OVERLAY.secrets.postgres?.file).toBe(
      `\${SCRATCH_SECRETS_DIR:?set by deploy/scratch/scratch.sh}/postgres.txt`,
    );
    expect(OVERLAY_TEXT).not.toContain('./secrets/');
  });
});

describe('scratch script: text', () => {
  it('tears down with -v, the local images and orphans, and never names /tmp', () => {
    expect(SCRIPT).toContain('down -v --rmi local --remove-orphans');
    expect(SCRIPT).not.toMatch(/TMPDIR|\/tmp/);
  });

  it('reads free disk on the Docker data root as well as the repo', () => {
    expect(SCRIPT).toContain('{{.DockerRootDir}}');
  });

  it('sets the compose variables first, then checks NATS, the gate and the jars, before compose up', () => {
    const up = SCRIPT.slice(SCRIPT.indexOf('do_up() {'), SCRIPT.indexOf('do_status() {'));
    const at = (needle: string) => up.indexOf(needle);
    expect(at('set_env')).toBeGreaterThanOrEqual(0);
    expect(at('set_env')).toBeLessThan(at('check_compose'));
    expect(at('set_env')).toBeLessThan(
      at('docker ps -aq --filter "label=com.docker.compose.project=$PROJECT"'),
    );
    expect(up).not.toContain('compose_run ps -aq');
    expect(at('check_nats')).toBeLessThan(at('  gate'));
    expect(at('  gate')).toBeLessThan(at('check_plugins'));
    expect(at('check_plugins')).toBeLessThan(at('compose_run up'));
  });
});

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
    id: '#!/bin/sh\necho 1000\n',
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
const STUBBED = ['docker', 'id', 'uname', 'df'];

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
    const present = Object.fromEntries(
      (opts.watch ?? []).map((rel) => [rel, existsSync(join(s.base, rel))]),
    );
    return { status: result.status, stdout: result.stdout, stderr: result.stderr, calls, present };
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
