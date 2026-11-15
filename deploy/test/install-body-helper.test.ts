// C7-03c2: deploy/install-body-helper.sh is dry-run by default, idempotent, never prints a secret and
// refuses unknown flags. The shell tests run the script under a temp prefix with recording fakes of
// systemctl, node and head on PATH. They need bash (Git Bash on Windows, or any Linux shell). The file
// mode tests run on Linux only: Windows does not keep POSIX modes.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const DEPLOY = fileURLToPath(new URL('..', import.meta.url));
const REPO = fileURLToPath(new URL('../..', import.meta.url))
  .replaceAll('\\', '/')
  .replace(/\/$/, '');
const SCRIPT = join(DEPLOY, 'install-body-helper.sh');
// On Windows, plain `bash` can be the WSL launcher, which cannot run this script. Set
// GELDAR_SHELL_TESTS_BASH to a Git Bash binary there.
const BASH = process.env.GELDAR_SHELL_TESTS_BASH ?? 'bash';
const SCRIPT_SRC = readFileSync(SCRIPT, 'utf8');
const CANARY = 'CANARY-SECRET-7f3a9c-do-not-print';
// Paths are relative to the fixture root; the script runs there with the prefix "rt".
const UNIT_PATH = 'rt/etc/systemd/system/geldar-body-helper.service';
const BUILD_PATH = 'rt/opt/geldar/body-helper/dist/main.js';
const ENV_PATH = 'rt/etc/geldar/body-helper.env';
const SECRET_DIR_PATH = 'rt/etc/geldar/secrets';
const PG_PATH = `${SECRET_DIR_PATH}/helper-postgres.txt`;
const NATS_PATH = `${SECRET_DIR_PATH}/nats-helper.txt`;
const ON_WINDOWS = process.platform === 'win32';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

interface Fixture {
  root: string;
  bin: string;
  log: string;
  state: string;
  /** The fixture repo checkout (forward slashes: the script's path check refuses backslashes). */
  repo: string;
}

/**
 * A temp root with fake systemctl, node and head on PATH, and a fake checkout that holds an empty
 * tools/migrate/node_modules. The fake systemctl and node append their argv to the log. The fake
 * head records the umask it runs under in state/head-umask; state/head-empty makes it print nothing.
 */
function fixture(): Fixture {
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
  writeFileSync(join(bin, 'systemctl'), systemctl);
  writeFileSync(join(bin, 'node'), `#!/bin/sh\n${record}\nexit 0\n`);
  writeFileSync(join(bin, 'head'), head);
  writeFileSync(join(bin, 'id'), id);
  for (const name of ['systemctl', 'node', 'head', 'id']) chmodSync(join(bin, name), 0o755);
  return {
    root,
    bin,
    log: join(root, 'calls.log'),
    state,
    repo: repo.replaceAll('\\', '/'),
  };
}

/** Puts the helper build and its sha256 sidecar (dist/main.js.sha256, as the CI job writes it) where the script expects them. */
function withBuild(fx: Fixture): void {
  const file = join(fx.root, BUILD_PATH);
  mkdirSync(join(file, '..'), { recursive: true });
  const body = '// fake build\n';
  writeFileSync(file, body);
  const digest = createHash('sha256').update(body).digest('hex');
  writeFileSync(`${file}.sha256`, `${digest}  main.js\n`);
}

/** Puts the env file where the script expects it. Names only, as geldar-93 writes it. */
function withEnv(fx: Fixture): void {
  const file = join(fx.root, ENV_PATH);
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, 'GELDAR_TEST_NAME=present\n');
}

interface RunOptions {
  prefix?: string;
  /** Runs with no directory on PATH that holds a node binary. */
  noNode?: boolean;
  /** Overrides of the run's environment; an undefined value removes that variable. */
  env?: Record<string, string | undefined>;
}

/** The environment of one run: the PG* variables are set (the apply preflight needs them) and the test marker is set. */
function testEnv(fx: Fixture, path: string, opts: RunOptions): NodeJS.ProcessEnv {
  const env: Record<string, string | undefined> = {
    ...process.env,
    PATH: path,
    FAKE_BIN: opts.noNode ? '' : fx.bin,
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

function run(fx: Fixture, args: string[], opts: RunOptions = {}): { status: number; out: string } {
  // C7-03c5: the script runs the pinned node under <prefix>/opt/geldar/node/bin/node. A fake one stands
  // there unless the case is noNode (then the pinned node is absent, as on a node with no Node).
  const pinnedNode = join(fx.root, 'rt/opt/geldar/node/bin/node');
  mkdirSync(join(fx.root, 'rt/opt/geldar/node/bin'), { recursive: true });
  if (opts.noNode) rmSync(pinnedNode, { force: true });
  else writeFileSync(pinnedNode, '#!/bin/sh\necho "node $*" >> "$FAKE_LOG"\nexit 0\n');
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

function calls(fx: Fixture): string[] {
  return existsSync(fx.log) ? readFileSync(fx.log, 'utf8').trim().split('\n').filter(Boolean) : [];
}

/** The calls that change something: `systemctl is-enabled` is a read and is left out. */
function mutations(fx: Fixture): string[] {
  return calls(fx).filter((c) => !c.startsWith('systemctl is-enabled'));
}

/** The mode bits of a file or directory under the fixture root (Linux only). */
function modeOf(fx: Fixture, rel: string): number {
  return statSync(join(fx.root, rel)).mode & 0o777;
}

describe('install-body-helper.sh: static checks (C7-03c2)', () => {
  it('is committed as mode 100755, so the runbook can run it directly', () => {
    const listed = spawnSync(
      'git',
      ['-C', REPO, 'ls-files', '-s', 'deploy/install-body-helper.sh'],
      {
        encoding: 'utf8',
      },
    );
    expect(listed.stdout).toMatch(/^100755 /);
  });

  it('defaults to a dry run: APPLY starts at 0 and only --apply sets it to 1', () => {
    expect(SCRIPT_SRC).toMatch(/^APPLY=0$/m);
    expect(SCRIPT_SRC.match(/APPLY=1/g)).toHaveLength(1);
  });

  it('never runs the nats-auth tooling and never edits nats-auth.conf (comments aside)', () => {
    const code = SCRIPT_SRC.split('\n').filter((line) => !line.trim().startsWith('#'));
    expect(code.join('\n')).not.toMatch(/nats-auth/);
  });

  it('never prints a secret file: no cat, echo or head of a secret path', () => {
    expect(SCRIPT_SRC).not.toMatch(/cat\s+"?\$(PG|NATS)_SECRET/);
    expect(SCRIPT_SRC).not.toMatch(/echo\s+"?\$\(cat/);
  });

  it('writes secrets under a umask 077 subshell and pins them with chmod 600 before the mv', () => {
    expect(SCRIPT_SRC).toMatch(/umask 077/);
    expect(SCRIPT_SRC).toContain('chmod 600 "$secret.tmp"');
    expect(SCRIPT_SRC.indexOf('chmod 600 "$secret.tmp"')).toBeLessThan(
      SCRIPT_SRC.indexOf('mv "$secret.tmp" "$secret"'),
    );
  });

  it('creates the secret directory with install -d -m 0700 -o root -g root on the node only', () => {
    expect(SCRIPT_SRC).toContain('install -d -m 0700 -o root -g root "$SECRET_DIR"');
    expect(SCRIPT_SRC).toContain('mkdir -p "$SECRET_DIR" && chmod 700 "$SECRET_DIR"');
  });
});

// Each run of the script under Git Bash takes several seconds on a loaded Windows host (many short
// subprocesses), so the describe blocks that run it get the 30 s timeout the file already uses.
describe('install-body-helper.sh: dry run and flags (C7-03c2)', { timeout: 30_000 }, () => {
  it('with no flag changes nothing and runs no command', () => {
    const fx = fixture();
    withBuild(fx);
    const { status, out } = run(fx, []);
    expect(status, out).toBe(0);
    expect(out).toContain('dry run');
    expect(out).toContain('would: write unit file');
    expect(existsSync(join(fx.root, UNIT_PATH))).toBe(false);
    expect(existsSync(join(fx.root, SECRET_DIR_PATH))).toBe(false);
    expect(mutations(fx)).toEqual([]);
  });

  it('on a fresh prefix the dry run plans the geldar_helper password step (the secret would be created)', () => {
    const fx = fixture();
    withBuild(fx);
    const { status, out } = run(fx, []);
    expect(status, out).toBe(0);
    expect(out).toContain('would: set geldar_helper password from helper-postgres.txt');
    expect(existsSync(join(fx.root, PG_PATH))).toBe(false);
    expect(mutations(fx)).toEqual([]);
  });

  it('the dry run also plans the password step when the PG secret already exists', () => {
    const fx = fixture();
    withBuild(fx);
    mkdirSync(join(fx.root, SECRET_DIR_PATH), { recursive: true });
    writeFileSync(join(fx.root, PG_PATH), 'OLD-PG-VALUE');
    const { status, out } = run(fx, []);
    expect(status, out).toBe(0);
    expect(out).toContain('would: set geldar_helper password from helper-postgres.txt');
    expect(mutations(fx)).toEqual([]);
  });

  it('--dry-run is the same as no flag', () => {
    const fx = fixture();
    withBuild(fx);
    const { status } = run(fx, ['--dry-run']);
    expect(status).toBe(0);
    expect(mutations(fx)).toEqual([]);
    expect(existsSync(join(fx.root, UNIT_PATH))).toBe(false);
    expect(existsSync(join(fx.root, SECRET_DIR_PATH))).toBe(false);
  });

  it('refuses an unknown flag with exit 2 and changes nothing', () => {
    for (const flag of ['--apply-now', '--force', '--yes']) {
      const fx = fixture();
      withBuild(fx);
      const { status, out } = run(fx, [flag]);
      expect(status, flag).toBe(2);
      expect(out, flag).toContain('refused unknown argument');
      expect(existsSync(join(fx.root, UNIT_PATH)), flag).toBe(false);
      expect(existsSync(join(fx.root, SECRET_DIR_PATH)), flag).toBe(false);
      expect(mutations(fx), flag).toEqual([]);
    }
  });

  it('refuses a prefix with a shell metacharacter before any change', () => {
    const fx = fixture();
    withBuild(fx);
    const { status, out } = run(fx, ['--apply'], { prefix: 'rt;touch' });
    expect(status).toBe(1);
    expect(out).toContain('refused');
    expect(mutations(fx)).toEqual([]);
  });

  it('without a build, the apply writes no unit and enables nothing', () => {
    const fx = fixture();
    const { status, out } = run(fx, ['--apply']);
    expect(status, out).toBe(0);
    expect(out).toContain('blocked: helper build missing');
    expect(existsSync(join(fx.root, UNIT_PATH))).toBe(false);
    expect(mutations(fx).some((c) => c.startsWith('systemctl'))).toBe(false);
  });
});

describe('install-body-helper.sh: the env file and the preflight (C7-03c2)', {
  timeout: 30_000,
}, () => {
  it('with the build and no env file, --apply runs no systemctl enable and says why', () => {
    const fx = fixture();
    withBuild(fx);
    const { status, out } = run(fx, ['--apply']);
    expect(status, out).toBe(0);
    expect(out).toContain('blocked: env file missing');
    expect(out).toContain('enable blocked');
    expect(mutations(fx).some((c) => c.startsWith('systemctl enable'))).toBe(false);
  });

  it('with the build and the env file present, --apply enables the unit', () => {
    const fx = fixture();
    withBuild(fx);
    withEnv(fx);
    const { status, out } = run(fx, ['--apply']);
    expect(status, out).toBe(0);
    expect(mutations(fx)).toContain('systemctl enable --now geldar-body-helper.service');
  });

  it('--apply dies before any write when the migrate node_modules is missing', () => {
    const fx = fixture();
    withBuild(fx);
    withEnv(fx);
    rmSync(join(fx.repo, 'tools/migrate/node_modules'), { recursive: true, force: true });
    const { status, out } = run(fx, ['--apply']);
    expect(status, out).toBe(1);
    expect(out).toContain('node_modules');
    expect(existsSync(join(fx.root, UNIT_PATH))).toBe(false);
    expect(existsSync(join(fx.root, SECRET_DIR_PATH))).toBe(false);
    expect(mutations(fx)).toEqual([]);
  });

  it('--apply dies before any write when node is not on PATH', () => {
    const fx = fixture();
    withBuild(fx);
    withEnv(fx);
    const { status, out } = run(fx, ['--apply'], { noNode: true });
    expect(status, out).toBe(1);
    expect(out).toContain('needs node');
    expect(existsSync(join(fx.root, UNIT_PATH))).toBe(false);
    expect(existsSync(join(fx.root, SECRET_DIR_PATH))).toBe(false);
    expect(mutations(fx)).toEqual([]);
  });
});

describe('install-body-helper.sh: apply, idempotence and secrets (C7-03c2)', {
  timeout: 30_000,
}, () => {
  it('a first --apply writes the root-owned unit with the hardening and creates the secret files', () => {
    const fx = fixture();
    withBuild(fx);
    withEnv(fx);
    const { status, out } = run(fx, ['--apply']);
    expect(status, out).toBe(0);
    const unit = readFileSync(join(fx.root, UNIT_PATH), 'utf8');
    expect(unit).toContain('NoNewPrivileges=yes');
    expect(unit).toContain('ProtectSystem=strict');
    expect(unit).toContain('ProtectHome=yes');
    expect(unit).toContain('PrivateTmp=yes');
    expect(unit).toContain('Restart=on-failure');
    expect(unit).toContain('StartLimitBurst=5');
    expect(unit).toContain('ReadWritePaths=-/var/run/docker.sock');
    expect(unit).toContain(
      'ReadOnlyPaths=-/etc/geldar/secrets/helper-postgres.txt -/etc/geldar/secrets/nats-helper.txt',
    );
    // The only socket path named in the unit is the Docker socket.
    const sockets = unit.match(/\S*\.sock\b/g) ?? [];
    expect(sockets.every((s) => s.endsWith('/var/run/docker.sock'))).toBe(true);
    expect(existsSync(join(fx.root, PG_PATH))).toBe(true);
    expect(existsSync(join(fx.root, NATS_PATH))).toBe(true);
    const log = calls(fx);
    expect(log).toContain('systemctl daemon-reload');
    expect(log).toContain('systemctl enable --now geldar-body-helper.service');
    expect(
      log.some((c) => c.startsWith('node ') && c.includes('--set-role-password geldar_helper')),
    ).toBe(true);
  });

  it('the secret values are 64 lowercase hex characters, and the random step runs under umask 077', () => {
    const fx = fixture();
    withBuild(fx);
    withEnv(fx);
    const { status, out } = run(fx, ['--apply']);
    expect(status, out).toBe(0);
    expect(readFileSync(join(fx.root, NATS_PATH), 'utf8')).toMatch(/^[0-9a-f]{64}$/);
    expect(readFileSync(join(fx.state, 'head-umask'), 'utf8').trim()).toBe('0077');
  });

  it('the password step passes the PG secret path to --password-file, not the NATS file', () => {
    const fx = fixture();
    withBuild(fx);
    withEnv(fx);
    expect(run(fx, ['--apply']).status).toBe(0);
    const line = calls(fx).find((c) => c.startsWith('node ') && c.includes('--set-role-password'));
    expect(line).toBeDefined();
    expect(line).toMatch(/ --password-file (\S+)$/);
    expect(line?.match(/ --password-file (\S+)$/)?.[1]).toBe(PG_PATH);
  });

  it.skipIf(ON_WINDOWS)(
    'Linux modes: the unit is 0644, the secret dir 0700, the secret files 0600',
    () => {
      const fx = fixture();
      withBuild(fx);
      withEnv(fx);
      expect(run(fx, ['--apply']).status).toBe(0);
      expect(modeOf(fx, UNIT_PATH)).toBe(0o644);
      expect(modeOf(fx, SECRET_DIR_PATH)).toBe(0o700);
      expect(modeOf(fx, PG_PATH)).toBe(0o600);
      expect(modeOf(fx, NATS_PATH)).toBe(0o600);
    },
  );

  it.skipIf(ON_WINDOWS)(
    'Linux modes: an existing 0644 secret is kept and named in a warn line, its value not printed',
    () => {
      const fx = fixture();
      withBuild(fx);
      withEnv(fx);
      mkdirSync(join(fx.root, SECRET_DIR_PATH), { recursive: true });
      writeFileSync(join(fx.root, PG_PATH), CANARY);
      chmodSync(join(fx.root, PG_PATH), 0o644);
      const { status, out } = run(fx, ['--apply']);
      expect(status, out).toBe(0);
      expect(out).toContain('warn: secret file helper-postgres.txt is mode 644, expected 600');
      expect(out).not.toContain(CANARY);
      expect(readFileSync(join(fx.root, PG_PATH), 'utf8')).toBe(CANARY);
      expect(modeOf(fx, PG_PATH)).toBe(0o644);
    },
  );

  it.skipIf(ON_WINDOWS)('a dangling symlink at a secret path is kept, not replaced (Linux)', () => {
    const fx = fixture();
    withBuild(fx);
    withEnv(fx);
    mkdirSync(join(fx.root, SECRET_DIR_PATH), { recursive: true });
    const target = join(fx.root, 'rt', 'nowhere-target');
    symlinkSync(target, join(fx.root, NATS_PATH));
    const { status, out } = run(fx, ['--apply']);
    expect(status, out).toBe(0);
    expect(lstatSync(join(fx.root, NATS_PATH)).isSymbolicLink()).toBe(true);
    expect(existsSync(target)).toBe(false);
  });

  it('an empty random value is refused before the mv: no secret file appears', () => {
    const fx = fixture();
    withBuild(fx);
    withEnv(fx);
    writeFileSync(join(fx.state, 'head-empty'), '');
    const { status, out } = run(fx, ['--apply']);
    expect(status, out).toBe(1);
    expect(out).toContain('came out empty');
    expect(existsSync(join(fx.root, PG_PATH))).toBe(false);
    expect(existsSync(join(fx.root, NATS_PATH))).toBe(false);
    expect(mutations(fx).some((c) => c.startsWith('node '))).toBe(false);
  });

  it('a second --apply changes nothing: no daemon-reload, no enable, the files stay', () => {
    const fx = fixture();
    withBuild(fx);
    withEnv(fx);
    expect(run(fx, ['--apply']).status).toBe(0);
    const firstLog = mutations(fx).length;
    const { status, out } = run(fx, ['--apply']);
    expect(status, out).toBe(0);
    expect(out).toContain('already current');
    expect(out).toContain('present (not touched)');
    const second = mutations(fx).slice(firstLog);
    expect(
      second.some((c) => c.includes('daemon-reload') || c.startsWith('systemctl enable')),
    ).toBe(false);
    expect(second.every((c) => c.startsWith('node '))).toBe(true);
  }, 30_000);

  it('a changed unit on an enabled service is reloaded and restarted', () => {
    const fx = fixture();
    withBuild(fx);
    withEnv(fx);
    expect(run(fx, ['--apply']).status).toBe(0);
    writeFileSync(join(fx.root, UNIT_PATH), 'stale unit\n');
    const before = mutations(fx).length;
    const { status, out } = run(fx, ['--apply']);
    expect(status, out).toBe(0);
    const later = mutations(fx).slice(before);
    expect(later).toContain('systemctl daemon-reload');
    expect(later).toContain('systemctl restart geldar-body-helper.service');
    expect(later.some((c) => c.startsWith('systemctl enable'))).toBe(false);
    // Two full runs of the script under Git Bash take about 6 s; the default 5 s timeout is too short.
  }, 30_000);

  it('a changed unit with the env file gone is not restarted, and the plan says restart needed', () => {
    const fx = fixture();
    withBuild(fx);
    withEnv(fx);
    expect(run(fx, ['--apply']).status).toBe(0);
    rmSync(join(fx.root, ENV_PATH));
    writeFileSync(join(fx.root, UNIT_PATH), 'stale unit\n');
    const before = mutations(fx).length;
    const { status, out } = run(fx, ['--apply']);
    expect(status, out).toBe(0);
    expect(out).toContain('restart needed: geldar-body-helper.service');
    expect(
      mutations(fx)
        .slice(before)
        .some((c) => c.startsWith('systemctl restart')),
    ).toBe(false);
  }, 30_000);

  it('an existing secret file is never overwritten', () => {
    const fx = fixture();
    withBuild(fx);
    withEnv(fx);
    mkdirSync(join(fx.root, SECRET_DIR_PATH), { recursive: true });
    writeFileSync(join(fx.root, NATS_PATH), 'OLD-VALUE-KEEP');
    expect(run(fx, ['--apply']).status).toBe(0);
    expect(readFileSync(join(fx.root, NATS_PATH), 'utf8')).toBe('OLD-VALUE-KEEP');
  });

  it('prints no secret: a canary in an existing secret file and no base64-shaped value in the output', () => {
    const fx = fixture();
    withBuild(fx);
    withEnv(fx);
    mkdirSync(join(fx.root, SECRET_DIR_PATH), { recursive: true });
    writeFileSync(join(fx.root, PG_PATH), CANARY);
    const { out } = run(fx, ['--apply']);
    expect(out).not.toContain(CANARY);
    expect(out).not.toMatch(/[A-Za-z0-9+/=]{44,}/);
  });
});

describe('install-body-helper.sh: test-only settings, preflight and secret length (C7-03c2 fix)', {
  timeout: 30_000,
}, () => {
  it('refuses a prefix as root unless BODY_HELPER_TEST=1, and writes nothing', () => {
    const fx = fixture();
    withBuild(fx);
    withEnv(fx);
    const { status, out } = run(fx, ['--apply'], {
      env: { FAKE_ROOT: '1', BODY_HELPER_TEST: undefined },
    });
    expect(status, out).toBe(1);
    expect(out).toContain('is a test setting and is refused for root');
    expect(existsSync(join(fx.root, UNIT_PATH))).toBe(false);
    expect(calls(fx)).toEqual([]);
  });

  it('with BODY_HELPER_TEST=1 the same root run under a prefix applies', () => {
    const fx = fixture();
    withBuild(fx);
    withEnv(fx);
    const { status, out } = run(fx, ['--apply'], { env: { FAKE_ROOT: '1' } });
    expect(status, out).toBe(0);
    expect(existsSync(join(fx.root, UNIT_PATH))).toBe(true);
  });

  it('with a prefix, BODY_HELPER_REPO names the migrate checkout', () => {
    const fx = fixture();
    const { out } = run(fx, []);
    expect(out).toContain(`migrate checkout: ${fx.repo}`);
  });

  it('without a prefix, BODY_HELPER_REPO is ignored: the plan names the script checkout', () => {
    const fx = fixture();
    const { status, out } = run(fx, [], { prefix: '' });
    expect(status, out).toBe(0);
    expect(out).toMatch(/migrate checkout: .+/);
    expect(out).not.toContain(fx.repo);
  });

  it.each(['PGHOST', 'PGUSER', 'PGDATABASE'])(
    '--apply dies before any write when %s is unset',
    (name) => {
      const fx = fixture();
      withBuild(fx);
      withEnv(fx);
      const { status, out } = run(fx, ['--apply'], { env: { [name]: undefined } });
      expect(status, out).toBe(1);
      expect(out).toContain(`needs ${name}`);
      expect(calls(fx)).toEqual([]);
      expect(existsSync(join(fx.root, UNIT_PATH))).toBe(false);
      expect(existsSync(join(fx.root, PG_PATH))).toBe(false);
    },
  );

  it('a random value of 31 bytes is refused before the mv: no secret file appears', () => {
    const fx = fixture();
    withBuild(fx);
    withEnv(fx);
    writeFileSync(join(fx.state, 'head-short'), '');
    const { status, out } = run(fx, ['--apply']);
    expect(status, out).toBe(1);
    expect(out).toContain('is not 64 characters');
    expect(existsSync(join(fx.root, PG_PATH))).toBe(false);
    expect(existsSync(join(fx.root, `${PG_PATH}.tmp`))).toBe(false);
  });
});
