/**
 * The stub harness for the scratch script tests: a copy of deploy/scratch/scratch.sh runs under sh with docker, id, uname,
 * df and powershell.exe stubbed on PATH, and the docker calls the script made are read back. Nothing here starts a
 * container. The tests that use it skip when no sh is on PATH (SH is null).
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

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
export const SCRIPT_PATH = `${ROOT}deploy/scratch/scratch.sh`;
export const SCRIPT = readFileSync(SCRIPT_PATH, 'utf8');
export const MIND_SCRIPT_PATH = `${ROOT}deploy/scratch/scratch-mind.sh`;
export const MIND_SCRIPT = readFileSync(MIND_SCRIPT_PATH, 'utf8');
export const HUMAN_SCRIPT_PATH = `${ROOT}deploy/scratch/scratch-human.sh`;
export const HUMAN_SCRIPT = readFileSync(HUMAN_SCRIPT_PATH, 'utf8');
export const LEDGER_SCRIPT_PATH = `${ROOT}deploy/scratch/scratch-ledger.sh`;
export const LEDGER_SCRIPT = readFileSync(LEDGER_SCRIPT_PATH, 'utf8');
const ENV_PATH = `${ROOT}deploy/scratch/telemetry.env`;
export const SH = spawnSync('sh', ['-c', 'exit 0']).status === 0 ? 'sh' : null;

/** For describe.skipIf and it.skipIf: true skips the sh tests when no sh is on PATH. With CI set, a missing sh throws at
 * collection instead, so the sh tests fail rather than skip. */
export function skipWithoutSh(): boolean {
  if (SH !== null) return false;
  if (process.env.CI)
    throw new Error('sh is not on PATH and CI is set: the sh script tests must run, not skip');
  return true;
}

/** Windows needs a privilege to make symlinks, so that case runs only where one can be made. */
export const CAN_SYMLINK = (() => {
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
export const HOME_UNSETTABLE =
  SH !== null &&
  spawnSync(SH, ['-c', '[ -n "$HOME" ] || echo unset'], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '', SYSTEMROOT: process.env.SYSTEMROOT ?? '' },
  }).stdout.trim() === 'unset';

export type Env = Record<string, string | undefined>;
export interface RunOpts {
  /** Runs a copy of the script in a temp tree; jars adds the two plugin jars the script checks for. */
  tree?: {
    jars: boolean;
    /** The telemetry.env in the tree: undefined copies the real file, null leaves it out, a string is its text (@BASE@ is the stub base dir). */
    envFile?: string | null;
    /** The agent pin the copied scratch-ledger.sh checks against: a test fixture's sha256 in place of the real pin. Omitted, the real pin stays. */
    agentPin?: string;
  };
  /** Sets up files under the stub base dir before the script runs. */
  prepare?: (base: string) => void;
  /** Paths relative to the stub base dir whose existence is recorded after the run. */
  watch?: string[];
}
export interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
  /** One line per docker call, with the compose variables the stub saw. */
  calls: string[];
  present: Record<string, boolean>;
}

/** Forward slashes: the script takes these paths as given, and sh on Windows reads them fine. */
export const slash = (path: string) => path.replace(/\\/g, '/');

/** The stub bin dir and the default environment. docker logs each call with the compose variables, fails compose calls
 * that lack them (as compose does for a required variable), answers compose version and info, and fails down when
 * STUB_FAIL_DOWN is set. info prints no Docker root when STUB_NO_INFO is set; any ps -aq call fails when STUB_FAIL_PS
 * is set; a ps -q call filtered on the compose service named in STUB_NO_SERVICE finds nothing. df prints STUB_DOCKER_KB for the Docker root and STUB_DISK_KB for the repo; id says 1000; uname says
 * MINGW64_NT unless STUB_UNAME is set; powershell.exe prints STUB_RAM_KB. */
export function stubs(): { base: string; env: Env } {
  const base = mkdtempSync(join(tmpdir(), 'scratch-stub-'));
  const bin = join(base, 'bin');
  mkdirSync(bin);
  mkdirSync(join(base, 'home'));
  // The Docker root is a real directory by default, so the gate reads its figure as a host path.
  mkdirSync(join(base, 'docker-root'));
  const files: Record<string, string> = {
    docker: [
      '#!/bin/sh',
      'echo "$* SECRETS=$SCRATCH_SECRETS_DIR WORLD=$GELDAR_WORLD_VOLUME PORTS=$SCRATCH_PG_PORT,$SCRATCH_NATS_PORT,$SCRATCH_NATS_MON_PORT,$SCRATCH_MC_PORT RUN=$SCRATCH_RUN_UID:$SCRATCH_RUN_GID" >>"$STUB_LOG"',
      'if [ "$1" = compose ] && { [ -z "$SCRATCH_SECRETS_DIR" ] || [ -z "$GELDAR_WORLD_VOLUME" ]; }; then',
      '  echo "required variable SCRATCH_SECRETS_DIR or GELDAR_WORLD_VOLUME is missing a value" >&2; exit 1',
      'fi',
      'case "$*" in',
      '  *"version --short"*) echo "$STUB_COMPOSE_VERSION" ;;',
      '  *"ps -aq"*) [ -z "$STUB_FAIL_PS" ] || exit 1 ;;',
      '  "ps -q --filter"*)',
      '    [ -n "$STUB_PROJECT_UP" ] || exit 0',
      '    case "$*" in *"service=$STUB_NO_SERVICE "*) [ -n "$STUB_NO_SERVICE" ] && exit 0 ;; esac',
      '    echo stub-container ;;',
      '  *" run --rm"*)',
      '    grep -q nats-body.txt "$SCRATCH_SECRETS_DIR/nats-override.yml" 2>/dev/null && echo BODY_SECRET_IN_OVERRIDE >>"$STUB_LOG"',
      '    exit "${STUB_RUN_EXIT:-0}" ;;',
      '  *" down -v"*) [ -z "$STUB_FAIL_DOWN" ] || exit 1 ;;',
      '  info*) [ -n "$STUB_NO_INFO" ] || echo "$STUB_DOCKER_ROOT" ;;',
      'esac',
      'exit 0',
      '',
    ].join('\n'),
    id: '#!/bin/sh\nif [ "$1" = -g ]; then echo "${STUB_ACCT_GID:-1000}"; else echo "${STUB_ACCT_UID:-1000}"; fi\n',
    uname: '#!/bin/sh\n[ -z "$STUB_UNAME" ] && echo MINGW64_NT || echo "$STUB_UNAME"\n',
    'powershell.exe': '#!/bin/sh\necho "$STUB_RAM_KB"\n',
    df: [
      '#!/bin/sh',
      'echo Filesystem',
      'case "$*" in',
      '  *"$STUB_DOCKER_ROOT"*) echo "x 1 1 $STUB_DOCKER_KB 1% $STUB_DOCKER_ROOT" ;;',
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
    STUB_DOCKER_ROOT: slash(join(base, 'docker-root')),
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
export function assertStubsFirst(bin: string, env: Env): void {
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

/** The ledger script with its agent pin replaced by a fixture's sha256 (the real agent jar is 26 MB and is not in the repo).
 * The check itself is unchanged: only the constant it compares against differs. Throws when the constant is not found. */
export function pinnedLedgerScript(agentPin?: string): string {
  if (agentPin === undefined) return LEDGER_SCRIPT;
  if (!/^[0-9a-f]{64}$/.test(agentPin)) throw new Error('agentPin must be 64 lowercase hex digits');
  const pinLine = /^ledger_agent_pin=[0-9a-f]{64}$/m;
  if (!pinLine.test(LEDGER_SCRIPT))
    throw new Error('scratch-ledger.sh has no ledger_agent_pin line');
  return LEDGER_SCRIPT.replace(pinLine, `ledger_agent_pin=${agentPin}`);
}

/** A copy of the script in base/tree, with the plugin jars when asked. The script finds its root from its own path. */
export function makeTree(
  base: string,
  jars: boolean,
  envFile?: string | null,
  agentPin?: string,
): string {
  const script = join(base, 'tree', 'deploy', 'scratch', 'scratch.sh');
  mkdirSync(dirname(script), { recursive: true });
  writeFileSync(script, SCRIPT);
  writeFileSync(join(dirname(script), 'scratch-mind.sh'), MIND_SCRIPT);
  writeFileSync(join(dirname(script), 'scratch-human.sh'), HUMAN_SCRIPT);
  writeFileSync(join(dirname(script), 'scratch-ledger.sh'), pinnedLedgerScript(agentPin));
  if (envFile !== null) {
    const text =
      envFile === undefined
        ? readFileSync(ENV_PATH, 'utf8')
        : envFile.replaceAll('@BASE@', slash(base));
    writeFileSync(join(dirname(script), 'telemetry.env'), text);
  }
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
export function runScript(
  args: string[],
  extra: Env | ((base: string) => Env) = {},
  opts: RunOpts = {},
): Run {
  const s = stubs();
  const env: Env = { ...s.env, ...(typeof extra === 'function' ? extra(s.base) : extra) };
  for (const key of Object.keys(env)) if (env[key] === undefined) delete env[key];
  try {
    opts.prepare?.(s.base);
    const script = opts.tree
      ? makeTree(s.base, opts.tree.jars, opts.tree.envFile, opts.tree.agentPin)
      : SCRIPT_PATH;
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

/** One valid SCRATCH_NATS_AUTH_DIR per test file, for runs that do not test NATS auth. Open NATS is refused (check_nats). */
const SHARED_AUTH = authDir();
process.on('exit', () => rmSync(SHARED_AUTH, { recursive: true, force: true }));
export const AUTH: Env = { SCRATCH_NATS_AUTH_DIR: slash(SHARED_AUTH) };
export const JARS: RunOpts = { tree: { jars: true } };
/** True when a docker call reached compose with the project flag: the stack was about to start. */
export const started = (run: Run) => run.calls.some((c) => c.includes('-p scratch-'));
/** The state directory of scratch-a, with one file in it, as a started or half-removed stack leaves it. */
export const SECRETS_KEEP = 'state/geldar-scratch/scratch-a/keep.txt';
export const withSecrets = (base: string) => {
  const dir = join(base, 'state', 'geldar-scratch', 'scratch-a');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'keep.txt'), 'x');
};

/** A directory with the four NATS files, non-empty, for SCRATCH_NATS_AUTH_DIR. */
export function authDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'scratch-auth-'));
  for (const f of [
    'nats-auth.conf',
    'nats-paper.txt',
    'nats-velocity.txt',
    'nats-eventsink.txt',
    'nats-seed.txt',
  ])
    writeFileSync(join(dir, f), 'x');
  return dir;
}
