// Tests for deploy/colo-admin.sh (decision 0133). The script runs under `sh` with a fake `docker` and a fake `stat` on
// PATH, as the colo deploy tests do (colo-deploy.test.ts). The fake docker records each call, copies any compose
// overlay it is given to <log>.overlay, and answers only `config`. The fake stat answers the POSIX mode of a file
// from a fixture. No real docker, container, node or network is used. The token file is a sentinel fixture: the
// tests check that its value never reaches stdout or stderr.
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

const DEPLOY = fileURLToPath(new URL('..', import.meta.url));
const COMPOSE = resolve(DEPLOY, '..', 'compose', 'colo.yml');
const PROJECT_FILTER = /-p geldar-colo|label=com\.docker\.compose\.project=geldar-colo/;
const SENTINEL = 'sentinel-token-value-that-must-never-print';
const ADMIN = `registry.example.invalid/geldar/admin@sha256:${'6'.repeat(64)}`;
const BODY = `registry.example.invalid/geldar/body@sha256:${'1'.repeat(64)}`;
const SECRET_FILES = ['postgres.txt', 'rcon.txt', 'velocity-forwarding.txt', 'nats-body.txt'];

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

// Same bound as colo-deploy.test.ts: each test starts several sh processes on a Windows desktop. It is a limit for
// real work, not a retry or a skip.
const SPAWN_TEST_TIMEOUT_MS = 30_000;
vi.setConfig({ testTimeout: SPAWN_TEST_TIMEOUT_MS });

// The fake docker: records its arguments, copies each *.override.yml it is given, and answers `config`.
const DOCKER_SHIM = `#!/bin/sh
printf '%s\\n' "$*" >> "$DOCKER_CALLS_LOG"
for a in "$@"; do case $a in *.override.yml) cp "$a" "$DOCKER_CALLS_LOG.overlay" ;; esac; done
case "$*" in
  "ps -a "*) [ -z "\${FAKE_PS_ALL:-}" ] || echo "$FAKE_PS_ALL"; exit 0 ;;
  "ps "*) [ -z "\${FAKE_PS_RUN:-}" ] || echo "$FAKE_PS_RUN"; exit 0 ;;
  *"config --quiet"*) exit 0 ;;
  *"config"*) cat "$DOCKER_CONFIG_FIXTURE"; exit 0 ;;
esac
exit 0
`;

// The fake stat: `stat -c %a PATH` (the mode, from $FAKE_MODE_DIR/<file name>, default 600) and `stat -c %u PATH` (the
// owner, from $FAKE_OWNER_DIR/<file name>, default 1000, the GELDAR_SERVICE_UID these tests use).
const STAT_SHIM = `#!/bin/sh
[ "$1" = "-c" ] || exit 2
name=\${3##*/}
case $2 in
  %a) if [ -f "$FAKE_MODE_DIR/$name" ]; then read -r v <"$FAKE_MODE_DIR/$name"; else v=600; fi ;;
  %u) if [ -f "$FAKE_OWNER_DIR/$name" ]; then read -r v <"$FAKE_OWNER_DIR/$name"; else v=1000; fi ;;
  *) exit 2 ;;
esac
echo "$v"
`;
// The fake id: only `id -u`, the uid of the account running the deploy (FAKE_RUNNER_UID, default 1000: not root).
const ID_SHIM = `#!/bin/sh
[ "$1" = "-u" ] || exit 2
echo "\${FAKE_RUNNER_UID:-1000}"
`;

const CONFIG = `name: geldar-colo
services:
  postgres:
    image: pgvector/pgvector@sha256:${'5'.repeat(64)}
  admin:
    image: ${ADMIN}
`;

const release = (withAdmin = true) =>
  `# test manifest\nGELDAR_BODY_IMAGE=${BODY}\n${withAdmin ? `GELDAR_ADMIN_IMAGE=${ADMIN}\n` : ''}`;
// Paths reach sh as forward slashes: MSYS sh on Windows reads C:/ paths reliably.
const posix = (p: string) => p.replace(/\\/g, '/');

interface Fixture {
  dir: string;
  env: Record<string, string>;
  callsLog: string;
  tokens: string;
  state: string;
  modes: string;
  releaseFile: string;
}

const dirs: string[] = [];

function writeShim(bin: string, name: string, text: string) {
  writeFileSync(join(bin, name), text);
  chmodSync(join(bin, name), 0o755);
}

function fixture(): Fixture {
  const dir = mkdtempSync(join(tmpdir(), 'geldar-colo-admin-test-'));
  dirs.push(dir);
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  writeShim(bin, 'docker', DOCKER_SHIM);
  writeShim(bin, 'stat', STAT_SHIM);
  writeShim(bin, 'id', ID_SHIM);
  const secrets = join(dir, 'secrets');
  mkdirSync(secrets);
  for (const f of SECRET_FILES) writeFileSync(join(secrets, f), `${f}-test-value\n`);
  const modes = join(dir, 'modes');
  mkdirSync(modes);
  const repo = join(dir, 'repo');
  mkdirSync(repo);
  const tokens = join(dir, 'tokens');
  mkdirSync(tokens);
  const releaseFile = join(dir, 'release.env');
  writeFileSync(releaseFile, release());
  const config = join(dir, 'config.yml');
  // The merged config declares the secrets the script checks (decision 0084): each NAME with its file.
  const decls = ['postgres', 'rcon', 'velocity-forwarding', 'nats-body'];
  const dirText = secrets.replace(/\\/g, '/');
  const block = decls.map((n) => `  ${n}:\n    file: ${dirText}/${n}.txt\n`).join('');
  writeFileSync(config, `${CONFIG}secrets:\n${block}`);
  const callsLog = join(dir, 'calls.log');
  const env: Record<string, string> = { ...(process.env as Record<string, string>) };
  delete env.Path;
  delete env.GELDAR_TOKENS_DIR;
  Object.assign(env, {
    // On Windows the spawn gets only Git for Windows' tools (usr/bin and mingw64/bin for curl), not the full Windows PATH: MSYS
    // converts the whole PATH on every fork, so a long PATH made one deploy run cost over a minute (see the FX-DEPLOY-WIN note).
    PATH: [
      bin,
      SH === 'sh' ? '' : dirname(SH),
      process.platform === 'win32' ? join(dirname(SH), '..', '..', 'mingw64', 'bin') : '',
      process.platform === 'win32' ? '' : (process.env.PATH ?? ''),
    ]
      .filter(Boolean)
      .join(delimiter),
    GELDAR_COLO_COMPOSE: posix(COMPOSE),
    GELDAR_COLO_ROOT: posix(repo),
    GELDAR_SECRETS_DIR: posix(secrets),
    GELDAR_RELEASE_FILE: posix(releaseFile),
    GELDAR_STATE_DIR: posix(join(dir, 'state')),
    GELDAR_MIN_FREE_KB: '1',
    DEPLOY_DRY_RUN: '1',
    DOCKER_CALLS_LOG: posix(callsLog),
    DOCKER_CONFIG_FIXTURE: posix(config),
    FAKE_MODE_DIR: posix(modes),
  });
  return { dir, env, callsLog, tokens, state: join(dir, 'state'), modes, releaseFile };
}

function setMode(fx: Fixture, file: string, mode: string) {
  writeFileSync(join(fx.modes, file), `${mode}\n`);
}

function run(fx: Fixture, extra: Record<string, string>, args: string[]) {
  const r = spawnSync(SH, [posix(join(DEPLOY, 'colo-admin.sh')), ...args], {
    env: { ...fx.env, ...extra },
    encoding: 'utf8',
  });
  return { code: r.status ?? -1, out: `${r.stdout}${r.stderr}` };
}

function calls(fx: Fixture): string[] {
  return existsSync(fx.callsLog)
    ? readFileSync(fx.callsLog, 'utf8').split('\n').filter(Boolean)
    : [];
}

// A container start: `run` (or `up`) in a compose call. config calls are not starts.
const starts = (log: string[]) => log.filter((c) => / run | up /.test(c));
const REAL = { DEPLOY_DRY_RUN: '0' };

// A token-mint run in the real mode, with a sentinel token file already in the tokens directory (the container
// would have written it through the mount).
function mintReal(fx: Fixture, mode = '600') {
  setMode(fx, 'tokens', '700');
  writeFileSync(join(fx.tokens, 'alice.token'), `${SENTINEL}\n`);
  if (mode !== '600') setMode(fx, 'alice.token', mode);
  return run(fx, { ...REAL, GELDAR_TOKENS_DIR: posix(fx.tokens) }, ['token-mint', 'alice']);
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('colo-admin.sh (decision 0133)', () => {
  it('refuses an unknown subcommand before any docker call', () => {
    const fx = fixture();
    const r = run(fx, REAL, ['drop-tables']);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("unknown subcommand 'drop-tables'");
    expect(calls(fx)).toEqual([]);
  });

  it('refuses a missing subcommand', () => {
    const fx = fixture();
    const r = run(fx, REAL, []);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('unknown subcommand');
    expect(calls(fx)).toEqual([]);
  });

  it('refuses token-mint when GELDAR_TOKENS_DIR is unset, and starts no container', () => {
    const fx = fixture();
    const r = run(fx, REAL, ['token-mint', 'alice']);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('token-mint needs GELDAR_TOKENS_DIR');
    expect(starts(calls(fx))).toEqual([]);
  });

  it('refuses a GELDAR_TOKENS_DIR that is not a directory', () => {
    const fx = fixture();
    const r = run(fx, { ...REAL, GELDAR_TOKENS_DIR: posix(join(fx.dir, 'missing')) }, [
      'token-mint',
      'alice',
    ]);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('is not a directory');
    expect(starts(calls(fx))).toEqual([]);
  });

  it('refuses a tokens directory with loose permissions (0755), and starts no container', () => {
    const fx = fixture();
    setMode(fx, 'tokens', '755');
    const r = run(fx, { ...REAL, GELDAR_TOKENS_DIR: posix(fx.tokens) }, ['token-mint', 'alice']);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('has mode 755; it must be 0700');
    expect(starts(calls(fx))).toEqual([]);
  });

  it('refuses a tokens directory inside the repo checkout', () => {
    const fx = fixture();
    const inside = join(fx.dir, 'repo', 'tokens');
    mkdirSync(inside);
    setMode(fx, 'tokens', '700');
    const r = run(fx, { ...REAL, GELDAR_TOKENS_DIR: posix(inside) }, ['token-mint', 'alice']);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('inside the repo checkout');
    expect(starts(calls(fx))).toEqual([]);
  });

  it.each([
    ['/etc/alice.token', 'must be under /run/tokens'],
    ['/run/tokens/../alice.token', "must not contain '..'"],
    ['/run/tokens/sub/alice.token', 'name one file'],
  ])('refuses --out %s', (out, message) => {
    const fx = fixture();
    setMode(fx, 'tokens', '700');
    const r = run(fx, { ...REAL, GELDAR_TOKENS_DIR: posix(fx.tokens) }, [
      'token-mint',
      'alice',
      '--out',
      out,
    ]);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain(message);
    expect(starts(calls(fx))).toEqual([]);
  });

  it('refuses a minted token file that is not mode 0600, and never shows its value', () => {
    const fx = fixture();
    const r = mintReal(fx, '644');
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('has mode 644; it must be 0600');
    expect(r.out).not.toContain(SENTINEL);
  });

  it('mints into the mounted tokens directory and prints only the path and byte length', () => {
    const fx = fixture();
    const r = mintReal(fx);
    expect(r.code).toBe(0);
    expect(r.out).toContain('alice.token');
    expect(r.out).toContain(`(${SENTINEL.length + 1} bytes)`);
    expect(r.out).not.toContain(SENTINEL);
    expect(
      calls(fx).some((c) =>
        c.endsWith('run --rm admin token-mint alice --out /run/tokens/alice.token'),
      ),
    ).toBe(true);
    const overlay = readFileSync(`${fx.callsLog}.overlay`, 'utf8');
    expect(overlay).toContain('target: /run/tokens');
    expect(overlay).toMatch(/source: ".*tokens"/);
    expect(existsSync(join(fx.state, 'admin-tokens.override.yml'))).toBe(false);
  });

  it('names the geldar-colo project in every docker call, and never runs down -v', () => {
    const fx = fixture();
    expect(mintReal(fx).code).toBe(0);
    const log = calls(fx);
    expect(log.length).toBeGreaterThan(0);
    expect(log.every((c) => PROJECT_FILTER.test(c) || /^(compose version|info)$/.test(c))).toBe(
      true,
    );
    expect(log.some((c) => /\bdown\b|--volumes/.test(c))).toBe(false);
    const text = readFileSync(join(DEPLOY, 'colo-admin.sh'), 'utf8');
    expect(text).not.toMatch(/down -v|--volumes|volume rm|system prune/);
  });

  it('dry run prints the plan and starts no container', () => {
    const fx = fixture();
    setMode(fx, 'tokens', '700');
    const r = run(fx, { GELDAR_TOKENS_DIR: posix(fx.tokens) }, ['token-mint', 'alice']);
    expect(r.code).toBe(0);
    expect(r.out).toContain('dry-run, not run');
    const log = calls(fx);
    expect(log.some((c) => c.includes('config --quiet'))).toBe(true);
    expect(starts(log)).toEqual([]);
  });

  it.each([
    ['migrate', ['migrate', '--dry-run']],
    ['owner-add', ['owner-add', 'ag-jo-01', '--cap', '20']],
    ['token-revoke', ['token-revoke', 'tk_1']],
    ['players-status', ['players-status']],
  ])('runs %s in the admin container without mounting the tokens directory', (_name, args) => {
    const fx = fixture();
    const r = run(fx, REAL, args);
    expect(r.code).toBe(0);
    expect(
      calls(fx).some((c) => c.endsWith(`--profile admin run --rm admin ${args.join(' ')}`)),
    ).toBe(true);
    expect(existsSync(`${fx.callsLog}.overlay`)).toBe(false);
  });

  it('refuses when the release manifest has no GELDAR_ADMIN_IMAGE', () => {
    const fx = fixture();
    writeFileSync(fx.releaseFile, release(false));
    const r = run(fx, REAL, ['players-status']);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('no GELDAR_ADMIN_IMAGE');
    expect(starts(calls(fx))).toEqual([]);
  });

  it('runs player-add in the admin container, and does not exit on the host path first', () => {
    const fx = fixture();
    const r = run(fx, REAL, ['player-add', 'ag-clara-01']);
    expect(r.code).toBe(0);
    expect(
      calls(fx).some((c) => c.endsWith('--profile admin run --rm admin player-add ag-clara-01')),
    ).toBe(true);
    expect(starts(calls(fx))).toHaveLength(1);
  });

  it('refuses player-add when the release manifest has no GELDAR_ADMIN_IMAGE', () => {
    const fx = fixture();
    writeFileSync(fx.releaseFile, release(false));
    const r = run(fx, REAL, ['player-add', 'ag-clara-01']);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('no GELDAR_ADMIN_IMAGE');
    expect(starts(calls(fx))).toEqual([]);
  });

  // The roster (decision 0108): roster-add and roster-list map to `mcp-tokens roster add|list` in the admin container.
  describe('roster verbs (decision 0108)', () => {
    it('runs roster-add as mcp-tokens roster add, name and owner passed as separate arguments', () => {
      const fx = fixture();
      const r = run(fx, REAL, ['roster-add', 'Picard', '--owner', 'steve']);
      expect(r.code).toBe(0);
      expect(
        calls(fx).some((c) =>
          c.endsWith('--profile admin run --rm admin roster add Picard --owner steve'),
        ),
      ).toBe(true);
      expect(existsSync(`${fx.callsLog}.overlay`)).toBe(false);
    });

    it('runs roster-list as mcp-tokens roster list, with an owner filter only when given', () => {
      const fx = fixture();
      expect(run(fx, REAL, ['roster-list']).code).toBe(0);
      expect(run(fx, REAL, ['roster-list', '--owner', 'steve']).code).toBe(0);
      const log = calls(fx);
      expect(log.some((c) => c.endsWith('--profile admin run --rm admin roster list'))).toBe(true);
      expect(
        log.some((c) => c.endsWith('--profile admin run --rm admin roster list --owner steve')),
      ).toBe(true);
    });

    it('dry run of roster-add prints the roster command and starts no container', () => {
      const fx = fixture();
      const r = run(fx, { DEPLOY_DRY_RUN: '1' }, ['roster-add', 'Picard', '--owner', 'steve']);
      expect(r.code).toBe(0);
      expect(r.out).toContain('dry-run, not run');
      expect(r.out).toContain('admin roster add Picard --owner steve');
      expect(starts(calls(fx))).toEqual([]);
    });

    it.each([
      ['a player id with a hyphen', ['roster-add', 'ag-picard-01', '--owner', 'steve']],
      ['a name with a semicolon', ['roster-add', 'Pic;ard', '--owner', 'steve']],
      ['a command substitution', ['roster-add', '$(id)', '--owner', 'steve']],
      ['a name of 17 letters', ['roster-add', 'a'.repeat(17), '--owner', 'steve']],
      ['an empty name', ['roster-add', '', '--owner', 'steve']],
      ['a path', ['roster-add', '../x', '--owner', 'steve']],
    ])('refuses roster-add with %s before any container runs', (_name, args) => {
      const fx = fixture();
      const r = run(fx, REAL, args);
      expect(r.code).not.toBe(0);
      expect(r.out).toContain('a roster name is 1 to 16 letters, digits or _');
      expect(starts(calls(fx))).toEqual([]);
    });

    it.each([
      ['an owner with a capital', ['roster-add', 'Picard', '--owner', 'Steve']],
      ['an owner with shell characters', ['roster-add', 'Picard', '--owner', 'st;eve']],
      ['an owner of 64 characters', ['roster-add', 'Picard', '--owner', 'o'.repeat(64)]],
    ])('refuses roster-add with %s before any container runs', (_name, args) => {
      const fx = fixture();
      const r = run(fx, REAL, args);
      expect(r.code).not.toBe(0);
      expect(r.out).toContain('owner id must be 1 to 63 lower-case letters, digits or dashes');
      expect(starts(calls(fx))).toEqual([]);
    });

    it.each([
      ['no owner', ['roster-add', 'Picard']],
      ['--owner with no value', ['roster-add', 'Picard', '--owner']],
      ['the owner as a positional', ['roster-add', 'Picard', 'steve']],
      ['an extra flag', ['roster-add', 'Picard', '--owner', 'steve', '--max', '4']],
      ['two names', ['roster-add', 'Picard', 'Other', '--owner', 'steve']],
    ])('refuses roster-add with %s before any container runs', (_name, args) => {
      const fx = fixture();
      const r = run(fx, REAL, args);
      expect(r.code).not.toBe(0);
      expect(r.out).toContain('roster-add takes <name> --owner <owner>');
      expect(starts(calls(fx))).toEqual([]);
    });

    it.each([
      ['an owner with a capital', ['roster-list', '--owner', 'Steve'], 'owner id must be'],
      ['a positional argument', ['roster-list', 'steve'], 'roster-list takes no arguments'],
      ['--owner with no value', ['roster-list', '--owner'], 'roster-list takes no arguments'],
      ['an unknown flag', ['roster-list', '--all'], 'roster-list takes no arguments'],
    ])('refuses roster-list with %s before any container runs', (_name, args, message) => {
      const fx = fixture();
      const r = run(fx, REAL, args);
      expect(r.code).not.toBe(0);
      expect(r.out).toContain(message);
      expect(starts(calls(fx))).toEqual([]);
    });
  });

  describe('per-player hosts (C1-10b)', () => {
    const SHARD_TEXT =
      'sovereign:\n  players:\n    - { player_id: ag-jason-01, life_id: ag_jason_01, name: Jason }\n    - { player_id: ag-clara-01, life_id: ag_clara_01, name: Clara }\n';
    const shardEnv = (fx: Fixture) => {
      const f = join(fx.dir, 'shard.yaml');
      writeFileSync(f, SHARD_TEXT);
      return { ...REAL, GELDAR_COLO_SHARD: posix(f) };
    };
    const HOST = 'geldar-colo-players-host-ag-clara-01';

    it('starts one named host per player with run -d --no-deps, the id in env and in the command', () => {
      const fx = fixture();
      const r = run(fx, shardEnv(fx), ['player-start', 'ag-clara-01']);
      expect(r.code).toBe(0);
      const log = calls(fx);
      const s = starts(log);
      expect(s).toHaveLength(1);
      expect(s[0]).toContain('-p geldar-colo');
      expect(s[0]).toContain('--profile sovereign');
      expect(s[0]).toContain(
        `run -d --rm --no-deps --name ${HOST} -e GELDAR_PLAYER_ID=ag-clara-01 players-host --player ag-clara-01`,
      );
    });

    it('leaves a host that is already running, and starts nothing', () => {
      const fx = fixture();
      const r = run(fx, { ...shardEnv(fx), FAKE_PS_RUN: HOST }, ['player-start', 'ag-clara-01']);
      expect(r.code).toBe(0);
      expect(r.out).toContain('already running');
      expect(starts(calls(fx))).toEqual([]);
    });

    it('removes a stopped leftover of the same name before it starts', () => {
      const fx = fixture();
      const r = run(fx, { ...shardEnv(fx), FAKE_PS_ALL: HOST }, ['player-start', 'ag-clara-01']);
      expect(r.code).toBe(0);
      const log = calls(fx);
      expect(log).toContain(`rm ${HOST}`);
      expect(starts(log)).toHaveLength(1);
    });

    it.each([
      ['an unlisted id', 'ag-nobody-01'],
      ['a bad pattern', 'Ag_Clara'],
      ['an id with an injected flag', 'ag-clara-01 --privileged'],
      ['a too long id', `ag-${'a'.repeat(41)}`],
    ])('refuses %s before any docker call', (_n, id) => {
      const fx = fixture();
      for (const verb of ['player-start', 'player-stop']) {
        const r = run(fx, shardEnv(fx), [verb, id]);
        expect(r.code).not.toBe(0);
      }
      expect(calls(fx)).toEqual([]);
    });

    it('stops only the named project container, and does nothing when it is absent', () => {
      const fx = fixture();
      const none = run(fx, shardEnv(fx), ['player-stop', 'ag-clara-01']);
      expect(none.code).toBe(0);
      expect(calls(fx).some((c) => c.startsWith('stop '))).toBe(false);
      const r = run(fx, { ...shardEnv(fx), FAKE_PS_ALL: HOST }, ['player-stop', 'ag-clara-01']);
      expect(r.code).toBe(0);
      const log = calls(fx);
      expect(log.filter((c) => c.startsWith('stop '))).toEqual([`stop ${HOST}`]);
      expect(log.filter((c) => c.startsWith('ps ')).every((c) => PROJECT_FILTER.test(c))).toBe(
        true,
      );
    });

    it('lists every listed player with its state', () => {
      const fx = fixture();
      const r = run(fx, { ...shardEnv(fx), FAKE_PS_RUN: 'x' }, ['player-list']);
      expect(r.code).toBe(0);
      expect(r.out).toContain('ag-jason-01: running');
      expect(r.out).toContain('ag-clara-01: running');
      const none = run(fx, shardEnv(fx), ['player-list']);
      expect(none.out).toContain('ag-clara-01: not running');
    });

    it('dry run starts and stops nothing, and needs no admin image', () => {
      const fx = fixture();
      writeFileSync(fx.releaseFile, release(false));
      const r = run(fx, { ...shardEnv(fx), DEPLOY_DRY_RUN: '1' }, ['player-start', 'ag-clara-01']);
      expect(r.code).toBe(0);
      expect(r.out).toContain('dry-run, not run');
      expect(starts(calls(fx))).toEqual([]);
    });
  });
});
