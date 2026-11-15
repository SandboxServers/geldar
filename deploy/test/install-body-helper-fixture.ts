// C7-03c2/C7-03c5: the shared fixture for the install script tests (install-body-helper*.test.ts). A temp root
// with recording fakes of systemctl, node, head, id and chown on PATH, and a stand-in pinned node under the prefix.
// The shell tests need bash: on Windows set GELDAR_SHELL_TESTS_BASH to a Git Bash binary.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEPLOY = fileURLToPath(new URL('..', import.meta.url));
export const REPO = fileURLToPath(new URL('../..', import.meta.url))
  .replaceAll('\\', '/')
  .replace(/\/$/, '');
export const SCRIPT = join(DEPLOY, 'install-body-helper.sh');
export const BASH = process.env.GELDAR_SHELL_TESTS_BASH ?? 'bash';
export const SCRIPT_SRC = readFileSync(SCRIPT, 'utf8');
export const CANARY = 'CANARY-SECRET-7f3a9c-do-not-print';
// Paths are relative to the fixture root; the script runs there with the prefix "rt".
export const UNIT_PATH = 'rt/etc/systemd/system/geldar-body-helper.service';
export const BUILD_PATH = 'rt/opt/geldar/body-helper/dist/main.js';
export const ENV_PATH = 'rt/etc/geldar/body-helper.env';
export const SECRET_DIR_PATH = 'rt/etc/geldar/secrets';
export const PG_PATH = `${SECRET_DIR_PATH}/helper-postgres.txt`;
export const NATS_PATH = `${SECRET_DIR_PATH}/nats-helper.txt`;
export const NODE_DIR_PATH = 'rt/opt/geldar/node';
export const NODE_BIN_PATH = `${NODE_DIR_PATH}/bin/node`;
export const NODE_STAMP_PATH = `${NODE_DIR_PATH}/.pinned-sha256`;
export const ON_WINDOWS = process.platform === 'win32';
// The pinned Node sha256, read from the same env file the script sources.
const PIN_ENV = readFileSync(join(DEPLOY, 'body-helper-node.env'), 'utf8');
export const PIN_SHA = PIN_ENV.match(/^BODY_HELPER_NODE_SHA256_LINUX_X64=(\S+)$/m)?.[1] ?? '';

const dirs: string[] = [];
/** Removes every fixture root made by this run. Call it from afterEach. */
export function removeFixtures(): void {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
}

export interface Fixture {
  root: string;
  bin: string;
  log: string;
  state: string;
  /** The fixture repo checkout (forward slashes: the script's path check refuses backslashes). */
  repo: string;
}

/**
 * A temp root with fake systemctl, node, head, id and chown on PATH, and a fake checkout that holds an empty
 * tools/migrate/node_modules. The fake systemctl and chown append their argv to the log. The PATH node logs
 * `path-node`; the pinned stand-in (under the prefix, see run) logs `pinned-node`. The fake head records the umask
 * it runs under in state/head-umask; state/head-empty makes it print nothing.
 */
export function fixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'geldar-ih-'));
  dirs.push(root);
  const bin = join(root, 'bin');
  const state = join(root, 'state');
  const repo = join(root, 'repo');
  mkdirSync(bin);
  mkdirSync(state);
  mkdirSync(join(repo, 'tools/migrate/node_modules'), { recursive: true });
  const record = 'echo "$(basename "$0") $*" >> "$FAKE_LOG"';
  const systemctl = [
    '#!/bin/sh',
    record,
    'case "$1" in',
    '  is-enabled) [ -f "$FAKE_STATE/enabled" ]; exit $? ;;',
    '  enable) touch "$FAKE_STATE/enabled" ;;',
    'esac',
    'exit 0',
    '',
  ].join('\n');
  const head = [
    '#!/bin/sh',
    'echo "$(umask)" > "$FAKE_STATE/head-umask"',
    '[ -f "$FAKE_STATE/head-empty" ] && exit 0',
    '[ -f "$FAKE_STATE/head-short" ] && { printf "0123456789abcdef0123456789abcde"; exit 0; }',
    "printf '0123456789abcdef0123456789abcdef'",
    '',
  ].join('\n');
  // The fake id prints 0 when FAKE_ROOT is set (the root checks), else an ordinary user's uid.
  const id = '#!/bin/sh\n[ -n "$FAKE_ROOT" ] && echo 0 || echo 1000\n';
  const pathNode = '#!/bin/sh\necho "path-node $*" >> "$FAKE_LOG"\nexit 0\n';
  const chown = '#!/bin/sh\necho "chown $*" >> "$FAKE_LOG"\nexit 0\n';
  writeFileSync(join(bin, 'systemctl'), systemctl);
  writeFileSync(join(bin, 'node'), pathNode);
  writeFileSync(join(bin, 'head'), head);
  writeFileSync(join(bin, 'id'), id);
  writeFileSync(join(bin, 'chown'), chown);
  for (const name of ['systemctl', 'node', 'head', 'id', 'chown'])
    chmodSync(join(bin, name), 0o755);
  return {
    root,
    bin,
    log: join(root, 'calls.log'),
    state,
    repo: repo.replaceAll('\\', '/'),
  };
}

/**
 * Puts the helper build and its sha256 sidecar (dist/main.js.sha256, as the CI job writes it) where the script
 * expects them. 'ok': the sidecar matches; 'bad': it names a wrong digest; 'none': no sidecar.
 */
export function withBuild(fx: Fixture, sidecar: 'ok' | 'bad' | 'none' = 'ok'): void {
  const file = join(fx.root, BUILD_PATH);
  mkdirSync(join(file, '..'), { recursive: true });
  const body = '// fake build\n';
  writeFileSync(file, body);
  const digest =
    sidecar === 'bad' ? '0'.repeat(64) : createHash('sha256').update(body).digest('hex');
  if (sidecar !== 'none') writeFileSync(`${file}.sha256`, `${digest}  main.js\n`);
}

/** Puts the env file where the script expects it. Names only, as geldar-93 writes it. */
export function withEnv(fx: Fixture): void {
  const file = join(fx.root, ENV_PATH);
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, 'GELDAR_TEST_NAME=present\n');
}

export interface RunOptions {
  prefix?: string;
  /** Runs with no directory on PATH that holds a node binary, and no pinned node under the prefix. */
  noNode?: boolean;
  /** The pinned node's stamp: the sha to write when none exists (default: the pin), or null to write none. */
  stamp?: string | null;
  /** Overrides of the run's environment; an undefined value removes that variable. */
  env?: Record<string, string | undefined>;
}

/** The environment of one run: the PG* variables are set (the apply preflight needs them) and the test marker is set. */
function testEnv(fx: Fixture, path: string, opts: RunOptions): NodeJS.ProcessEnv {
  const env: Record<string, string | undefined> = {
    ...process.env,
    PATH: path,
    FAKE_BIN: fx.bin,
    BODY_HELPER_PREFIX: opts.prefix ?? 'rt',
    BODY_HELPER_REPO: fx.repo,
    BODY_HELPER_TEST: '1',
    PGHOST: 'localhost',
    PGUSER: 'test_admin',
    PGDATABASE: 'test_db',
    FAKE_LOG: fx.log,
    FAKE_STATE: fx.state,
    ...opts.env,
  };
  for (const key of Object.keys(env)) if (env[key] === undefined) delete env[key];
  return env;
}

/** PATH without any directory that holds a node binary. */
function pathWithoutNode(): string {
  return (process.env.PATH ?? '')
    .split(delimiter)
    .filter(
      (dir) => dir !== '' && !existsSync(join(dir, 'node')) && !existsSync(join(dir, 'node.exe')),
    )
    .join(delimiter);
}

export function run(
  fx: Fixture,
  args: string[],
  opts: RunOptions = {},
): { status: number; out: string } {
  // The script runs the pinned node under <prefix>/opt/geldar/node/bin/node. A stand-in logs `pinned-node`
  // there unless the case is noNode (then the pinned node and its stamp are absent, as on a node with no Node).
  const pinnedNode = join(fx.root, NODE_BIN_PATH);
  const stamp = join(fx.root, NODE_STAMP_PATH);
  mkdirSync(join(fx.root, NODE_DIR_PATH, 'bin'), { recursive: true });
  // The fake PATH node lives in the fake bin, which every run puts on PATH (for systemctl and friends). A noNode
  // run removes it, so no node is on PATH; the other runs put it back.
  const pathShim = join(fx.bin, 'node');
  if (opts.noNode) {
    rmSync(pathShim, { force: true });
  } else if (!existsSync(pathShim)) {
    writeFileSync(pathShim, '#!/bin/sh\necho "path-node $*" >> "$FAKE_LOG"\nexit 0\n');
    chmodSync(pathShim, 0o755);
  }
  if (opts.noNode) {
    rmSync(pinnedNode, { force: true });
    rmSync(stamp, { force: true });
  } else {
    if (!existsSync(pinnedNode)) {
      writeFileSync(pinnedNode, '#!/bin/sh\necho "pinned-node $*" >> "$FAKE_LOG"\nexit 0\n');
      chmodSync(pinnedNode, 0o755);
    }
    if (opts.stamp !== null && !existsSync(stamp)) {
      writeFileSync(stamp, `${opts.stamp ?? PIN_SHA}\n`);
    }
  }
  const path = opts.noNode ? pathWithoutNode() : `${fx.bin}${delimiter}${process.env.PATH ?? ''}`;
  // Git Bash starts with /usr/bin ahead of PATH, which would hide the fake head. So the fake bin is
  // put first inside the shell, after its startup, and the script then runs in that same shell.
  const result = spawnSync(
    BASH,
    [
      '-c',
      'if [ -n "$FAKE_BIN" ]; then PATH="$FAKE_BIN:$PATH"; fi; exec bash "$0" "$@"',
      SCRIPT,
      ...args,
    ],
    {
      cwd: fx.root,
      encoding: 'utf8',
      env: testEnv(fx, path, opts),
    },
  );
  return { status: result.status ?? -1, out: `${result.stdout}${result.stderr}` };
}

export function calls(fx: Fixture): string[] {
  return existsSync(fx.log) ? readFileSync(fx.log, 'utf8').trim().split('\n').filter(Boolean) : [];
}

/** The calls that change something: `systemctl is-enabled` is a read and is left out. */
export function mutations(fx: Fixture): string[] {
  return calls(fx).filter((c) => !c.startsWith('systemctl is-enabled'));
}

/** The mode bits of a file or directory under the fixture root (Linux only). */
export function modeOf(fx: Fixture, rel: string): number {
  return statSync(join(fx.root, rel)).mode & 0o777;
}
