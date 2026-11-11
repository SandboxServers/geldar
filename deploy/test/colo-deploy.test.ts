// Tests for the Colo deploy scripts (decision 0084). The scripts run under `sh` with fake `docker`, `stat`, `id` and
// `chown` on PATH; no real docker, node or network is used (the BlueMap download is a local file:// fixture).
// `sh` is Git for Windows' sh on a Windows desktop and /bin/sh elsewhere; GELDAR_TEST_SH overrides both.
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
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

const DEPLOY = fileURLToPath(new URL('..', import.meta.url));
const COMPOSE = resolve(DEPLOY, '..', 'compose', 'colo.yml');
// The secrets the merged config declares: the compose NAME and the file each reads from (compose/colo.yml with
// deploy/compose.secrets.yml). The fixture config lists these, so the script's check reads them from the config.
const SECRETS: [string, string][] = [
  ['postgres', 'postgres.txt'],
  ['rcon', 'rcon.txt'],
  ['velocity-forwarding', 'velocity-forwarding.txt'],
  ['nats-body', 'nats-body.txt'],
  ['nats-mind', 'nats-mind.txt'],
  ['postgres-mcp.txt', 'postgres-mcp.txt'],
  ['mcp-token-pepper.txt', 'mcp-token-pepper.txt'],
  ['nats-mcp', 'nats-mcp.txt'],
];
const SECRET_FILES = SECRETS.map(([, file]) => file);
// The files gen-secrets.sh creates; the NATS files are written on a trusted machine, never here.
const GENERATED = [
  'postgres.txt',
  'rcon.txt',
  'velocity-forwarding.txt',
  'nats-body.txt',
  'postgres-mcp.txt',
  'mcp-token-pepper.txt',
];
// The fake chown: records each call ("UID PATH") in $FAKE_CHOWN_LOG and changes nothing.
const CHOWN_SHIM = `#!/bin/sh
echo "$*" >>"$FAKE_CHOWN_LOG"
`;
// Creating a symlink needs developer mode or elevation on Windows; the symlink test is skipped where it is refused.
const canSymlink = (() => {
  const d = mkdtempSync(join(tmpdir(), 'geldar-colo-link-'));
  try {
    writeFileSync(join(d, 'a'), 'x');
    symlinkSync(join(d, 'a'), join(d, 'b'));
    return true;
  } catch {
    return false;
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
})();
const BODY = `registry.example.invalid/geldar/body@sha256:${'1'.repeat(64)}`;
const MIND = `registry.example.invalid/geldar/mind@sha256:${'2'.repeat(64)}`;
const PREV_BODY = `registry.example.invalid/geldar/body@sha256:${'3'.repeat(64)}`;
const PROJECT_FILTER = /-p geldar-colo|label=com\.docker\.compose\.project=geldar-colo/;
// `stats` takes container ids, not a filter. The ids come from the label-filtered `ps -q` call, so it is allowed.
const STATS_BY_ID = /^stats --no-stream [0-9a-f]+$/;

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

// Every test starts several `sh` processes; on a Windows desktop beside the full suite a test took 5-11 s, against
// vitest's 5 s default. 60 s is a bound for real work under full-suite load, not a retry or a skip.
const SPAWN_TEST_TIMEOUT_MS = 60_000;
vi.setConfig({ testTimeout: SPAWN_TEST_TIMEOUT_MS });

// The fake docker: records its arguments and answers `config` with the fixture file. Every other call succeeds.
const DOCKER_SHIM = `#!/bin/sh
printf '%s\\n' "$*" >> "$DOCKER_CALLS_LOG"
case "$*" in
  *"config --quiet"*) exit 0 ;;
  *"config"*) cat "$DOCKER_CONFIG_FIXTURE"; exit 0 ;;
  *"ps -q"*) echo c0ffee01 ;;
esac
exit 0
`;

// The fake stat: `stat -c %a PATH` (mode, from $FAKE_MODE_DIR/<file name>, default 600) and `stat -c %u PATH` (owner
// uid, from $FAKE_OWNER_DIR/<file name>, default 1000). It uses only shell builtins: each external command is slow here.
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

const CONFIG = (published: string) => `name: geldar-colo
services:
  velocity:
    image: itzg/mc-proxy@sha256:${'4'.repeat(64)}
    ports:
      - mode: ingress
        host_ip: 127.0.0.1
        target: 25565
        published: "${published}"
        protocol: tcp
  postgres:
    image: pgvector/pgvector@sha256:${'5'.repeat(64)}
  golem-body:
    build:
      context: ..
    image: ${BODY}
`;

// The top-level secrets block as `docker compose config` prints it: each NAME with the file it reads from.
function secretsBlock(dir: string, decls: [string, string][]): string {
  const entries = decls.map(
    ([n, f]) => `  ${n}:\n    file: ${dir}/${f}\n    name: geldar-colo_${n}\n`,
  );
  return `secrets:\n${entries.join('')}`;
}
function writeConfig(
  path: string,
  dir: string,
  decls: [string, string][],
  published = '25567',
  extra = '',
) {
  writeFileSync(path, `${CONFIG(published)}${extra}${secretsBlock(posix(dir), decls)}`);
}
// A service that the nats-auth overlay gives the server config as a read-only bind file.
const NATS_BIND = (conf: string) =>
  `  nats:\n    volumes:\n      - type: bind\n        source: ${conf}\n        target: /etc/nats/nats-auth.conf\n`;

const release = (body: string, mind = MIND) =>
  `# test manifest\nGELDAR_BODY_IMAGE=${body}\nGELDAR_MIND_IMAGE=${mind}\nGELDAR_ADMIN_IMAGE=registry.example.invalid/geldar/admin@sha256:${'6'.repeat(64)}\nGELDAR_GLASS_IMAGE=registry.example.invalid/geldar/glass@sha256:${'7'.repeat(64)}\n`;
// Paths reach sh as forward slashes: MSYS sh on Windows reads C:/ paths reliably.
const posix = (p: string) => p.replace(/\\/g, '/');
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
const secretValue = (f: string) => `${f}-test-value`;

interface Fixture {
  dir: string;
  env: Record<string, string>;
  calls: string;
  secrets: string;
  config: string;
  modes: string;
  owners: string;
  release: string;
  state: string;
  lock: string;
  jarText: string;
}

const dirs: string[] = [];

function writeShim(bin: string, name: string, text: string) {
  writeFileSync(join(bin, name), text);
  chmodSync(join(bin, name), 0o755);
}

function fixture(publishedPort = '25567'): Fixture {
  const dir = mkdtempSync(join(tmpdir(), 'geldar-colo-test-'));
  dirs.push(dir);
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  writeShim(bin, 'docker', DOCKER_SHIM);
  writeShim(bin, 'stat', STAT_SHIM);
  writeShim(bin, 'id', ID_SHIM);
  const secrets = join(dir, 'secrets');
  mkdirSync(secrets);
  for (const f of SECRET_FILES) {
    writeFileSync(join(secrets, f), `${secretValue(f)}\n`);
  }
  const modes = join(dir, 'modes');
  mkdirSync(modes);
  const owners = join(dir, 'owners');
  mkdirSync(owners);
  const releaseFile = join(dir, 'release.env');
  writeFileSync(releaseFile, release(BODY));
  const config = join(dir, 'config.yml');
  writeConfig(config, secrets, SECRETS, publishedPort);
  const jarText = 'bluemap-test-jar';
  const jar = join(dir, 'bluemap.jar');
  writeFileSync(jar, jarText);
  const lock = join(dir, 'bluemap.lock.json');
  writeFileSync(lock, lockText(pathToFileURL(jar).href, sha256(jarText)));
  const calls = join(dir, 'calls.log');
  const env: Record<string, string> = { ...(process.env as Record<string, string>) };
  delete env.Path;
  Object.assign(env, {
    // The shims come first. The directory of the chosen sh follows, so that Git for Windows' coreutils resolve.
    PATH: [bin, SH === 'sh' ? '' : dirname(SH), process.env.PATH ?? process.env.Path ?? '']
      .filter(Boolean)
      .join(delimiter),
    GELDAR_COLO_COMPOSE: posix(COMPOSE),
    GELDAR_SECRETS_DIR: posix(secrets),
    GELDAR_RELEASE_FILE: posix(releaseFile),
    GELDAR_STATE_DIR: posix(join(dir, 'state')),
    GELDAR_BLUEMAP_LOCK: posix(lock),
    GELDAR_DEPLOY_ALLOW_FILE_URL: '1',
    GELDAR_MIN_FREE_KB: '1',
    DEPLOY_DRY_RUN: '1',
    DOCKER_CALLS_LOG: posix(calls),
    DOCKER_CONFIG_FIXTURE: posix(config),
    FAKE_MODE_DIR: posix(modes),
    FAKE_OWNER_DIR: posix(owners),
    GELDAR_SERVICE_UID: '1000',
  });
  return {
    dir,
    env,
    calls,
    secrets,
    config,
    modes,
    owners,
    release: releaseFile,
    state: join(dir, 'state'),
    lock,
    jarText,
  };
}

function lockText(url: string, sha: string): string {
  return `{\n  "url": "${url}",\n  "sha256": "${sha}"\n}\n`;
}

function setMode(fx: Fixture, file: string, mode: string) {
  writeFileSync(join(fx.modes, file), `${mode}\n`);
}

// Sets the owner uid the fake stat reports for a file or the secrets directory (by its base name).
function setOwner(fx: Fixture, file: string, uid: string) {
  writeFileSync(join(fx.owners, file), `${uid}\n`);
}

function run(script: string, fx: Fixture, extra: Record<string, string> = {}, args: string[] = []) {
  const r = spawnSync(SH, [posix(join(DEPLOY, script)), ...args], {
    env: { ...fx.env, ...extra },
    encoding: 'utf8',
  });
  return { code: r.status ?? -1, out: `${r.stdout}${r.stderr}` };
}

function calls(fx: Fixture): string[] {
  return existsSync(fx.calls) ? readFileSync(fx.calls, 'utf8').split('\n').filter(Boolean) : [];
}

const mutates = (log: string[]) => log.some((c) => / (pull|up) /.test(c));
const REAL = { DEPLOY_DRY_RUN: '0' };

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('colo-up.sh (decision 0084)', () => {
  it('dry run prints the plan and runs only read-only compose calls', () => {
    const fx = fixture();
    const r = run('colo-up.sh', fx);
    expect(r.code).toBe(0);
    expect(r.out).toContain('project: geldar-colo');
    const log = calls(fx);
    expect(log.some((c) => c.includes('config --quiet'))).toBe(true);
    expect(mutates(log)).toBe(false);
  });

  it('deploys by pull: config checks, then pull, then up --wait, with the record written first', () => {
    const fx = fixture();
    const r = run('colo-up.sh', fx, REAL);
    expect(r.code).toBe(0);
    const log = calls(fx);
    const at = (needle: string) => log.findIndex((c) => c.includes(needle));
    expect(at('config --quiet')).toBeGreaterThanOrEqual(0);
    expect(at('config --quiet')).toBeLessThan(at(' pull'));
    expect(at(' pull')).toBeLessThan(at('up -d --wait'));
    expect(existsSync(join(fx.state, 'current.env'))).toBe(true);
    expect(readFileSync(join(fx.state, 'bluemap', 'bluemap.jar'), 'utf8')).toBe(fx.jarText);
    for (const f of SECRET_FILES) expect(r.out).not.toContain(secretValue(f));
  });

  it('refuses when a secret file is missing, and runs no pull or up', () => {
    const fx = fixture();
    rmSync(join(fx.secrets, 'rcon.txt'));
    const r = run('colo-up.sh', fx, REAL);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('rcon.txt');
    expect(mutates(calls(fx))).toBe(false);
  });

  it.each(['600', '400'])('accepts a secret file at mode %s', (mode) => {
    const fx = fixture();
    for (const f of SECRET_FILES) setMode(fx, f, mode);
    const r = run('colo-up.sh', fx);
    expect(r.code).toBe(0);
    expect(r.out).not.toContain('has mode');
  });

  it('refuses a secret file that other accounts can read (mode 644), and runs no pull or up', () => {
    const fx = fixture();
    setMode(fx, 'postgres.txt', '644');
    const r = run('colo-up.sh', fx, REAL);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('postgres.txt has mode 644');
    expect(r.out).not.toContain(secretValue('postgres.txt'));
    expect(mutates(calls(fx))).toBe(false);
  });

  it.each([
    [
      'a latest tag',
      release(`registry.example.invalid/geldar/body:latest@sha256:${'1'.repeat(64)}`),
    ],
    ['a bare tag with no digest', release('registry.example.invalid/geldar/body:0.1.0')],
  ])('refuses a release manifest that uses %s', (_name, text) => {
    const fx = fixture();
    writeFileSync(fx.release, text);
    const r = run('colo-up.sh', fx, REAL);
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/latest|digest/);
    expect(mutates(calls(fx))).toBe(false);
  });

  it('refuses a BlueMap jar whose sha256 does not match the lock', () => {
    const fx = fixture();
    writeFileSync(
      fx.lock,
      lockText(pathToFileURL(join(fx.dir, 'bluemap.jar')).href, '0'.repeat(64)),
    );
    const r = run('colo-up.sh', fx, REAL);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('sha256 mismatch');
    expect(existsSync(join(fx.state, 'bluemap', 'bluemap.jar'))).toBe(false);
    expect(mutates(calls(fx))).toBe(false);
  });

  it('accepts a BlueMap jar whose sha256 matches the lock', () => {
    const fx = fixture();
    const r = run('colo-up.sh', fx, REAL);
    expect(r.code).toBe(0);
    expect(r.out).toContain('jar verified');
  });

  it.each([
    ['a file:// url without the test-only variable', () => pathToFileURL('bluemap.jar').href, '0'],
    ['an http url', () => 'http://example.invalid/bluemap.jar', '1'],
  ])('refuses a BlueMap lock with %s before any download', (_name, url, allow) => {
    const fx = fixture();
    writeFileSync(fx.lock, lockText(url(), sha256(fx.jarText)));
    const r = run('colo-up.sh', fx, { ...REAL, GELDAR_DEPLOY_ALLOW_FILE_URL: allow });
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('must be https');
    expect(mutates(calls(fx))).toBe(false);
  });

  it('refuses when the merged config publishes 25565 or 25566', () => {
    for (const port of ['25565', '25566']) {
      const fx = fixture(port);
      const r = run('colo-up.sh', fx, REAL);
      expect(r.code).not.toBe(0);
      expect(r.out).toContain('publishes 25565 or 25566');
      expect(mutates(calls(fx))).toBe(false);
    }
  });

  it('refuses a service that would be built on the node with no pinned image', () => {
    const fx = fixture();
    writeFileSync(
      join(fx.dir, 'config.yml'),
      `${CONFIG('25567')}  eventsink:\n    build:\n      context: ..\n`,
    );
    const r = run('colo-up.sh', fx, REAL);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('built on the node without a pinned image: eventsink:');
    expect(mutates(calls(fx))).toBe(false);
  });

  it('refuses when free disk is below the threshold', () => {
    const fx = fixture();
    const r = run('colo-up.sh', fx, { ...REAL, GELDAR_MIN_FREE_KB: '999999999999' });
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('free disk');
  });
});

describe('colo-rollback, colo-down, colo-status (decision 0084)', () => {
  it('rollback re-applies the previous release with --pull never and pulls nothing', () => {
    const fx = fixture();
    mkdirSync(fx.state);
    writeFileSync(join(fx.state, 'previous.env'), release(PREV_BODY), { mode: 0o600 });
    writeFileSync(join(fx.state, 'current.env'), release(BODY), { mode: 0o600 });
    const r = run('colo-rollback.sh', fx, REAL);
    expect(r.code).toBe(0);
    const log = calls(fx);
    expect(log.some((c) => c.endsWith('up -d --wait --pull never'))).toBe(true);
    expect(log.some((c) => / pull$| pull /.test(c))).toBe(false);
    expect(readFileSync(fx.release, 'utf8')).toContain(PREV_BODY);
    expect(readFileSync(join(fx.state, 'previous.env'), 'utf8')).toContain(BODY);
  });

  it('rollback refuses when no previous release is recorded', () => {
    const fx = fixture();
    const r = run('colo-rollback.sh', fx, REAL);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('no previous release');
  });

  it('down stops the project and never removes a container, network or volume', () => {
    const fx = fixture();
    const r = run('colo-down.sh', fx, REAL);
    expect(r.code).toBe(0);
    const log = calls(fx);
    expect(log.some((c) => c.endsWith(' stop'))).toBe(true);
    expect(log.some((c) => / (down|rm|volume|network) /.test(c))).toBe(false);
  });

  it('status is read-only and reads only project containers', () => {
    const fx = fixture();
    const r = run('colo-status.sh', fx);
    expect(r.code).toBe(0);
    const log = calls(fx);
    expect(log.some((c) => / (up|pull|stop|down|rm|restart)( |$)/.test(c))).toBe(false);
    expect(log.filter((c) => c.includes('ps ')).every((c) => PROJECT_FILTER.test(c))).toBe(true);
    expect(log).toContain('stats --no-stream c0ffee01');
  });
});

describe('deploy scripts: docker scope and volumes (decision 0084)', () => {
  it('every docker call names the geldar-colo project or its label, and no script runs down -v', () => {
    const fx = fixture();
    expect(run('colo-up.sh', fx, REAL).code).toBe(0);
    expect(run('colo-status.sh', fx).code).toBe(0);
    expect(run('colo-down.sh', fx, REAL).code).toBe(0);
    const log = calls(fx);
    expect(log.length).toBeGreaterThan(0);
    for (const c of log) {
      const allowed =
        PROJECT_FILTER.test(c) || STATS_BY_ID.test(c) || /^(compose version|info)$/.test(c);
      expect(allowed, `unscoped docker call: ${c}`).toBe(true);
      expect(c).not.toMatch(/\bdown\b.*(-v\b|--volumes)|--volumes/);
    }
    for (const script of [
      'common.sh',
      'colo-up.sh',
      'colo-rollback.sh',
      'colo-down.sh',
      'colo-status.sh',
    ]) {
      const text = readFileSync(join(DEPLOY, script), 'utf8');
      expect(text, script).not.toMatch(/down -v|--volumes|volume rm|system prune/);
    }
  });
});

describe('gen-secrets.sh (decision 0084)', () => {
  it('creates missing files owner-only, never overwrites, and never prints a value', () => {
    const fx = fixture();
    const target = join(fx.dir, 'fresh-secrets');
    const env = { ...fx.env, GELDAR_SECRETS_DIR: posix(target) };
    const first = run('gen-secrets.sh', { ...fx, env }, {});
    expect(first.code).toBe(0);
    for (const f of GENERATED) {
      const value = readFileSync(join(target, f), 'utf8').trim();
      expect(value).toMatch(/^[0-9a-f]{64}$/);
      expect(first.out).not.toContain(value);
      // NTFS reports 0666 whatever the script does, so the mode is checked on POSIX only (`umask 077` everywhere).
      if (process.platform !== 'win32') expect(statSync(join(target, f)).mode & 0o077).toBe(0);
    }
    expect(readFileSync(join(DEPLOY, 'gen-secrets.sh'), 'utf8')).toContain('umask 077');
    const before = readFileSync(join(target, 'rcon.txt'), 'utf8');
    const second = run('gen-secrets.sh', { ...fx, env }, {});
    expect(second.code).toBe(0);
    expect(second.out).toContain('kept (exists): rcon.txt');
    expect(readFileSync(join(target, 'rcon.txt'), 'utf8')).toBe(before);
    // The NATS files are never generated on the node (decision 0084).
    expect(existsSync(join(target, 'nats-mind.txt'))).toBe(false);
  });
});

describe('secret files come from the merged config (decision 0084)', () => {
  it.each(SECRETS)(
    'refuses when the file of compose secret %s is missing, and names it',
    (name, file) => {
      const fx = fixture();
      rmSync(join(fx.secrets, file));
      const r = run('colo-up.sh', fx, REAL);
      expect(r.code).not.toBe(0);
      expect(r.out).toContain(`secret file missing: ${file} (compose secret: ${name},`);
      expect(mutates(calls(fx))).toBe(false);
    },
  );

  it('refuses an empty secret file, and names it', () => {
    const fx = fixture();
    writeFileSync(join(fx.secrets, 'rcon.txt'), '');
    const r = run('colo-up.sh', fx, REAL);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('secret file empty: rcon.txt (compose secret: rcon)');
    expect(mutates(calls(fx))).toBe(false);
  });

  it.skipIf(!canSymlink)(
    'refuses a symlink that resolves outside the secrets directories, and never reads its target',
    () => {
      const fx = fixture();
      const outside = join(fx.dir, 'outside.txt');
      writeFileSync(outside, 'OUTSIDE-test-value\n');
      rmSync(join(fx.secrets, 'rcon.txt'));
      symlinkSync(outside, join(fx.secrets, 'rcon.txt'));
      const r = run('colo-up.sh', fx, REAL);
      expect(r.code).not.toBe(0);
      expect(r.out).toContain('secret file rcon.txt (compose secret: rcon) resolves outside');
      expect(r.out).not.toContain('OUTSIDE-test-value');
      expect(mutates(calls(fx))).toBe(false);
    },
  );

  // The same containment check without a symlink, so it also runs where symlinks are refused.
  it('refuses a merged-config path that lies outside the secrets directory, and runs no pull or up', () => {
    const fx = fixture();
    const elsewhere = join(fx.dir, 'elsewhere');
    mkdirSync(elsewhere);
    const outsideFile = join(elsewhere, 'postgres.txt');
    writeFileSync(outsideFile, 'ELSEWHERE-test-value\n');
    const text = readFileSync(fx.config, 'utf8');
    writeFileSync(
      fx.config,
      text.split(posix(join(fx.secrets, 'postgres.txt'))).join(posix(outsideFile)),
    );
    const r = run('colo-up.sh', fx, REAL);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('secret file postgres.txt (compose secret: postgres) resolves outside');
    expect(r.out).not.toContain('ELSEWHERE-test-value');
    expect(mutates(calls(fx))).toBe(false);
  });

  it('never prints a secret file contents, even when the file is refused', () => {
    const fx = fixture();
    writeFileSync(join(fx.secrets, 'postgres.txt'), 'SENTINEL-7f3a9c\n');
    setMode(fx, 'postgres.txt', '644');
    const r = run('colo-up.sh', fx, REAL);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('secret file postgres.txt has mode 644');
    expect(r.out).not.toContain('SENTINEL-7f3a9c');
  });

  it('passes when every file the merged config declares is present and owner-only', () => {
    const fx = fixture();
    const r = run('colo-up.sh', fx);
    expect(r.code).toBe(0);
    expect(r.out).toContain('each file the merged config declares is present');
  });

  it('requires a secret added to the merged config, with no change to the script', () => {
    const fx = fixture();
    writeConfig(fx.config, fx.secrets, [...SECRETS, ['new-thing', 'new-thing.txt']]);
    const r = run('colo-up.sh', fx, REAL);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('secret file missing: new-thing.txt (compose secret: new-thing,');
    expect(mutates(calls(fx))).toBe(false);
    writeFileSync(join(fx.secrets, 'new-thing.txt'), 'new-thing-test-value\n');
    expect(run('colo-up.sh', fx, REAL).code).toBe(0);
  });

  it('refuses a merged config that declares no secret files', () => {
    const fx = fixture();
    writeConfig(fx.config, fx.secrets, []);
    const r = run('colo-up.sh', fx, REAL);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('declares no secret files');
  });

  it('names the trusted-machine step for a missing NATS file', () => {
    const fx = fixture();
    rmSync(join(fx.secrets, 'nats-mind.txt'));
    const r = run('colo-up.sh', fx, REAL);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('secret file missing: nats-mind.txt');
    expect(r.out).toContain('./geldar.ps1 shard nats-auth colo');
  });

  it('refuses when the nats-auth overlay is merged and nats-auth.conf is missing, then passes once it exists', () => {
    const fx = fixture();
    const conf = join(fx.secrets, 'nats-auth.conf');
    writeConfig(fx.config, fx.secrets, SECRETS, '25567', NATS_BIND(posix(conf)));
    const missing = run('colo-up.sh', fx, REAL);
    expect(missing.code).not.toBe(0);
    expect(missing.out).toContain('secret file missing: nats-auth.conf');
    expect(missing.out).toContain('./geldar.ps1 shard nats-auth colo');
    expect(mutates(calls(fx))).toBe(false);
    writeFileSync(conf, 'nats-auth-test-value\n');
    expect(run('colo-up.sh', fx, REAL).code).toBe(0);
  });
});

describe('service uid: root is refused and every secret is owned by GELDAR_SERVICE_UID', () => {
  it('refuses to run the deploy as uid 0, and runs no pull or up', () => {
    const fx = fixture();
    const r = run('colo-up.sh', fx, { ...REAL, FAKE_RUNNER_UID: '0' });
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('refusing to run the deploy as root');
    expect(mutates(calls(fx))).toBe(false);
  });

  it.each([
    ['0', 'must not run as root'],
    ['abc', 'must be a number'],
  ])('refuses GELDAR_SERVICE_UID=%s', (uid, msg) => {
    const r = run('colo-up.sh', fixture(), { ...REAL, GELDAR_SERVICE_UID: uid });
    expect(r.code).not.toBe(0);
    expect(r.out).toContain(msg);
  });

  it('refuses a secret file owned by another uid, names it and the expected uid, and runs no pull or up', () => {
    const fx = fixture();
    setOwner(fx, 'rcon.txt', '1001');
    const r = run('colo-up.sh', fx, REAL);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('rcon.txt is owned by uid 1001; expected uid 1000');
    expect(r.out).not.toContain(secretValue('rcon.txt'));
    expect(mutates(calls(fx))).toBe(false);
  });

  it('refuses a secrets directory owned by another uid', () => {
    const fx = fixture();
    setOwner(fx, 'secrets', '1001');
    const r = run('colo-up.sh', fx, REAL);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('secrets directory');
    expect(r.out).toContain('expected uid 1000');
  });

  it('passes when the directory and every secret file are owned by GELDAR_SERVICE_UID=1001', () => {
    const fx = fixture();
    setOwner(fx, 'secrets', '1001');
    for (const f of SECRET_FILES) setOwner(fx, f, '1001');
    expect(run('colo-up.sh', fx, { ...REAL, GELDAR_SERVICE_UID: '1001' }).code).toBe(0);
  });

  it('dry run ends with "dry-run complete", not "deployed"', () => {
    const r = run('colo-up.sh', fixture());
    expect(r.code).toBe(0);
    expect(r.out.trimEnd().split('\n').at(-1)).toContain('dry-run complete');
    expect(r.out).not.toContain('deployed:');
  });

  it('gen-secrets as root chowns the directory and each generated file to GELDAR_SERVICE_UID', () => {
    const fx = fixture();
    writeShim(join(fx.dir, 'bin'), 'chown', CHOWN_SHIM);
    const gen = join(fx.dir, 'gen');
    const log = join(fx.dir, 'chown.log');
    const r = run('gen-secrets.sh', fx, {
      FAKE_RUNNER_UID: '0',
      GELDAR_SERVICE_UID: '1001',
      GELDAR_SECRETS_DIR: posix(gen),
      FAKE_CHOWN_LOG: posix(log),
    });
    expect(r.code).toBe(0);
    const lines = readFileSync(log, 'utf8').trim().split('\n');
    expect(lines).toContain(`1001 ${posix(gen)}`);
    for (const f of GENERATED) expect(lines).toContain(`1001 ${posix(join(gen, f))}`);
  });

  it('gen-secrets as another user refuses unless that uid is GELDAR_SERVICE_UID, and creates nothing', () => {
    const fx = fixture();
    const gen = join(fx.dir, 'gen-user');
    const r = run('gen-secrets.sh', fx, {
      GELDAR_SERVICE_UID: '1001',
      GELDAR_SECRETS_DIR: posix(gen),
    });
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('uid 1000');
    expect(r.out).toContain('GELDAR_SERVICE_UID');
    expect(existsSync(gen)).toBe(false);
  });
});
