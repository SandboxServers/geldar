// Shared test helpers for the forced-command deploy channel (G3-02) and its installer (GE-04). The production wrapper has fixed paths. A
// test runs a copy in which those paths and the sudo call are replaced by plain text substitution: the copy runs a fake
// entrypoint (a script that prints its arguments and environment) and no sudo. The installer runs under a root prefix
// (GELDAR_DEPLOY_DEST) with a shim for chmod and chown on PATH that records each call. Nothing touches a node, sudo,
// sshd or the network. Each test has its own temp dir.
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SH } from './colo-deploy-fixture';

export const GENESIS = fileURLToPath(new URL('../genesis/', import.meta.url));
export const WRAPPER = join(GENESIS, 'geldar-deploy-channel.sh');
export const INSTALLER = join(GENESIS, 'install-deploy-channel.sh');
export const SUDOERS = join(GENESIS, 'geldar-deploy.sudoers.template');
export const SHA = '0123456789abcdef0123456789abcdef01234567';
// Secret-shaped canary: it is set in the process environment and written into an allow-listed envs file. It must never reach stdout.
export const CANARY = 'canary-7f3a9c1e5b2d4a60-do-not-print';
export const INSTALL_TIMEOUT = 60000;

export const dirs: string[] = [];
export function cleanup() {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
}

// sh is given forward-slash paths: Git's sh on Windows reads C:/ paths and mangles backslashes.
export const p = (s: string) => s.replace(/\\/g, '/');

export function setup() {
  const root = mkdtempSync(join(tmpdir(), 'gn-channel-'));
  dirs.push(root);
  const envDir = join(root, 'envs');
  mkdirSync(envDir);
  writeFileSync(join(envDir, 'colo.yaml'), `token: ${CANARY}\n`);
  const entry = join(root, 'entry.sh');
  writeExecutable(
    entry,
    [
      '#!/bin/sh',
      'echo "ARGS:$*"',
      `echo "CANARY:\${GELDAR_CANARY-unset}"`,
      `echo "GELDAR_DEPLOY_ENV:\${GELDAR_DEPLOY_ENV-unset}"`,
      'echo "STDIN:$(cat)"',
      'echo "stderr line" >&2',
      'exit 0',
      '',
    ].join('\n'),
  );
  const failing = join(root, 'failing.sh');
  writeExecutable(failing, '#!/bin/sh\necho "ARGS:$*"\nexit 3\n');
  // A flock stand-in on PATH for the accepted-path tests (flock is absent on Windows). It records its arguments and exits
  // with FAKE_FLOCK_RC (0 unless a test sets it: 1 stands for a lock that is not free before the timeout).
  const shimDir = join(root, 'flock-shim');
  mkdirSync(shimDir);
  const flockCalls = join(root, 'flock.log');
  writeExecutable(
    join(shimDir, 'flock'),
    `#!/bin/sh\necho "flock $*" >> ${p(flockCalls)}\nexit \${FAKE_FLOCK_RC:-0}\n`,
  );
  return {
    root,
    envDir,
    entry,
    failing,
    shimDir: p(shimDir),
    flockCalls,
    log: join(root, 'channel.log'),
    lock: join(root, 'channel.lock'),
  };
}

// Writes a file that the tests execute directly (a stub entrypoint, a PATH shim): it needs a shebang and the execute bit.
// writeFileSync alone makes a 0644 file on Linux, and the exec then fails with exit 126.
export function writeExecutable(path: string, text: string) {
  writeFileSync(path, text);
  chmodSync(path, 0o755);
}

export type Fx = ReturnType<typeof setup>;

// The test process environment, with sh's directory first on PATH (Git for Windows' sh needs its coreutils) and no
// SSH_ORIGINAL_COMMAND unless a test sets one.
export function shEnv(over: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = { ...(process.env as Record<string, string>) };
  delete env.Path;
  delete env.SSH_ORIGINAL_COMMAND;
  env.PATH =
    SH === 'sh' ? (process.env.PATH ?? '') : [dirname(SH), process.env.PATH ?? ''].join(delimiter);
  return { ...env, ...over };
}

// Writes the test copy of the wrapper: each fixed production path is replaced by a path in fx's temp dir, and the sudo call
// is removed. Throws when a substitution finds nothing, so the copy is always the real script with only those changes.
export function wrapperCopy(fx: Fx, entry: string, noFlock: boolean): string {
  let text = readFileSync(WRAPPER, 'utf8');
  const subs: [string, string][] = [
    ['ENTRY=/usr/local/libexec/geldar-deploy/run', `ENTRY=${p(entry)}`],
    ['ENV_DIR=/var/lib/geldar-deploy/envs', `ENV_DIR=${p(fx.envDir)}`],
    ['LOG=/var/lib/geldar-deploy/channel.log', `LOG=${p(fx.log)}`],
    ['LOCK=/var/lib/geldar-deploy/channel.lock', `LOCK=${p(fx.lock)}`],
    ['sudo -n "$ENTRY"', '"$ENTRY"'],
  ];
  // noFlock makes the copy's flock test fail, whatever flock this machine has, to test the refusal.
  if (noFlock) subs.push(['command -v flock >/dev/null 2>&1', 'false']);
  for (const [from, to] of subs) {
    if (!text.includes(from)) throw new Error('wrapper substitution target missing');
    text = text.split(from).join(to);
  }
  const out = join(fx.root, 'channel-under-test');
  writeFileSync(out, text);
  return p(out);
}

export interface ChannelOpts {
  entry?: string;
  // The environment argument the key is bound to; null runs with no argument at all.
  bound?: string | null;
  input?: string;
  env?: Record<string, string>;
  // true: the copy behaves as if flock were missing (no flock stand-in on PATH either).
  noFlock?: boolean;
}

// Runs the wrapper copy with SSH_ORIGINAL_COMMAND set to cmd (or unset when cmd is undefined, which is a shell request).
export function channel(fx: Fx, cmd: string | undefined, opts: ChannelOpts = {}) {
  const env = shEnv({ GELDAR_CANARY: CANARY, ...(opts.env ?? {}) });
  if (!opts.noFlock) env.PATH = [fx.shimDir, env.PATH].join(delimiter);
  if (cmd !== undefined) env.SSH_ORIGINAL_COMMAND = cmd;
  const args = [wrapperCopy(fx, opts.entry ?? fx.entry, opts.noFlock === true)];
  if (opts.bound !== null) args.push(opts.bound ?? 'colo');
  const r = spawnSync(SH, args.map(p), {
    env,
    encoding: 'utf8',
    timeout: 15000,
    input: opts.input ?? '',
  });
  return {
    code: r.status,
    out: `${r.stdout}${r.stderr}`,
    log: existsSync(fx.log) ? readFileSync(fx.log, 'utf8') : '',
  };
}

// The real chmod's path, so the shim can call it for the drift repair (tests run unprivileged on their own files).
export function realChmod(): string {
  const r = spawnSync(SH, ['-c', 'command -v chmod'], { env: shEnv({}), encoding: 'utf8' });
  return p(r.stdout.trim());
}

// A PATH directory with chmod and chown shims. Each call is appended to calls.log. chmod then runs for real; chown
// records only, because an unprivileged test cannot give a file to root.
export function shim(root: string) {
  const dir = join(root, 'shim');
  mkdirSync(dir, { recursive: true });
  const calls = join(root, 'calls.log');
  writeExecutable(
    join(dir, 'chmod'),
    `#!/bin/sh\necho "chmod $*" >> ${p(calls)}\nexec ${realChmod()} "$@"\n`,
  );
  writeExecutable(join(dir, 'chown'), `#!/bin/sh\necho "chown $*" >> ${p(calls)}\nexit 0\n`);
  return { dir: p(dir), calls };
}

export interface InstallOpts {
  args?: string[];
  env?: Record<string, string>;
  // A directory put first on PATH (a visudo shim, for one).
  prefix?: string;
  // Replaces the PATH the installer sees (the chmod and chown shim is still first).
  path?: string;
  // The spawn timeout in ms (the FIFO tests use 10 s, so a hang fails fast).
  timeout?: number;
}

export function install(dest: string, user: string, opts: InstallOpts = {}) {
  const env = shEnv({
    GELDAR_DEPLOY_DEST: p(dest),
    GELDAR_OPERATOR_USER: user,
    GELDAR_OPERATOR_HOME: `/home/${user}`,
    ...(opts.env ?? {}),
  });
  // Every install runs with the chmod and chown shim first on PATH (the shim lives next to the test's dest directory).
  env.PATH = [shim(dirname(dest)).dir, opts.prefix ?? '', opts.path ?? env.PATH]
    .filter((s) => s !== '')
    .join(delimiter);
  // Tests pass --skip-visudo by default, so they do not depend on visudo being installed; the absent-visudo test passes [].
  return spawnSync(SH, [p(INSTALLER), ...(opts.args ?? ['--skip-visudo'])], {
    env,
    encoding: 'utf8',
    timeout: opts.timeout ?? INSTALL_TIMEOUT,
  });
}

// A PATH with no visudo on it, for every machine: an empty directory first, then the PATH entries (and sh's own directory)
// with any visudo removed from view. The installer then finds no visudo and must refuse without --skip-visudo.
export function pathWithoutVisudo(root: string): string {
  const empty = join(root, 'no-visudo');
  mkdirSync(empty, { recursive: true });
  const dirsOnPath = [
    ...(SH === 'sh' ? [] : [dirname(SH)]),
    ...(process.env.PATH ?? '').split(delimiter),
  ];
  const rest = dirsOnPath.filter((d) => d !== '' && !existsSync(join(d, 'visudo')));
  return [p(empty), ...rest].join(delimiter);
}

// The permission bits of a file (POSIX only: the callers skip on Windows).
export const modeOf = (file: string) => statSync(file).mode & 0o777;

// Whether this machine can make symlinks (Windows needs developer mode or admin for them).
export function canSymlink(): boolean {
  const d = mkdtempSync(join(tmpdir(), 'gn-symlink-'));
  dirs.push(d);
  try {
    symlinkSync(d, join(d, 'l'));
    return true;
  } catch {
    return false;
  }
}
