// Tests for the Colo deploy scripts (decision 0084). The scripts run under `sh` with a fake `docker` and a fake `stat`
// on PATH. The fake docker records each call and answers only the read-only subcommands; the fake stat answers the
// POSIX mode of each secret file from a fixture (NTFS has no POSIX modes). No real docker, node or network is used:
// the BlueMap "download" is a local file:// fixture, allowed only by GELDAR_DEPLOY_ALLOW_FILE_URL=1 in these tests.
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
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const DEPLOY = fileURLToPath(new URL('..', import.meta.url));
const COMPOSE = resolve(DEPLOY, '..', 'compose', 'colo.yml');
const SECRET_FILES = ['postgres.txt', 'rcon.txt', 'velocity-forwarding.txt', 'nats-body.txt'];
const BODY = `registry.example.invalid/geldar/body@sha256:${'1'.repeat(64)}`;
const MIND = `registry.example.invalid/geldar/mind@sha256:${'2'.repeat(64)}`;
const PREV_BODY = `registry.example.invalid/geldar/body@sha256:${'3'.repeat(64)}`;
const PROJECT_FILTER = /-p geldar-colo|label=com\.docker\.compose\.project=geldar-colo/;
// `stats` takes container ids, not a filter. The ids come from the label-filtered `ps -q` call, so it is allowed.
const STATS_BY_ID = /^stats --no-stream [0-9a-f]+$/;

function findSh(): string {
  if (process.env.GELDAR_TEST_SH) return process.env.GELDAR_TEST_SH;
  if (process.platform !== 'win32') return 'sh';
  const roots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter((p): p is string => Boolean(p));
  return roots.map((root) => join(root, 'Git', 'usr', 'bin', 'sh.exe')).find((p) => existsSync(p)) ?? 'sh';
}
const SH = findSh();

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

// The fake stat: only `stat -c %a PATH` is supported. The mode is read from $FAKE_MODE_DIR/<file name>, default 600.
const STAT_SHIM = `#!/bin/sh
[ "$1" = "-c" ] && [ "$2" = "%a" ] || exit 2
name=$(basename "$3")
if [ -f "$FAKE_MODE_DIR/$name" ]; then cat "$FAKE_MODE_DIR/$name"; else echo 600; fi
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
  animus:
    image: ${MIND}
`;

const release = (body: string, mind = MIND) => `# test manifest\nGELDAR_BODY_IMAGE=${body}\nGELDAR_MIND_IMAGE=${mind}\n`;
// Paths reach sh as forward slashes: MSYS sh on Windows reads C:/ paths reliably.
const posix = (p: string) => p.replace(/\\/g, '/');
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
const secretValue = (f: string) => `${f}-test-value`;

interface Fixture {
  dir: string;
  env: Record<string, string>;
  calls: string;
  secrets: string;
  modes: string;
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
  const secrets = join(dir, 'secrets');
  mkdirSync(secrets);
  for (const f of SECRET_FILES) {
    writeFileSync(join(secrets, f), `${secretValue(f)}\n`);
  }
  const modes = join(dir, 'modes');
  mkdirSync(modes);
  const releaseFile = join(dir, 'release.env');
  writeFileSync(releaseFile, release(BODY));
  const config = join(dir, 'config.yml');
  writeFileSync(config, CONFIG(publishedPort));
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
    PATH: [bin, SH === 'sh' ? '' : dirname(SH), process.env.PATH ?? process.env.Path ?? ''].filter(Boolean).join(delimiter),
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
  });
  return { dir, env, calls, secrets, modes, release: releaseFile, state: join(dir, 'state'), lock, jarText };
}

function lockText(url: string, sha: string): string {
  return `{\n  "url": "${url}",\n  "sha256": "${sha}"\n}\n`;
}

function setMode(fx: Fixture, file: string, mode: string) {
  writeFileSync(join(fx.modes, file), `${mode}\n`);
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
    ['a latest tag', release(`registry.example.invalid/geldar/body:latest@sha256:${'1'.repeat(64)}`)],
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
    writeFileSync(fx.lock, lockText(pathToFileURL(join(fx.dir, 'bluemap.jar')).href, '0'.repeat(64)));
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
    writeFileSync(join(fx.dir, 'config.yml'), `${CONFIG('25567')}  eventsink:\n    build:\n      context: ..\n`);
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
      const allowed = PROJECT_FILTER.test(c) || STATS_BY_ID.test(c) || /^(compose version|info)$/.test(c);
      expect(allowed, `unscoped docker call: ${c}`).toBe(true);
      expect(c).not.toMatch(/\bdown\b.*(-v\b|--volumes)|--volumes/);
    }
    for (const script of ['common.sh', 'colo-up.sh', 'colo-rollback.sh', 'colo-down.sh', 'colo-status.sh']) {
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
    for (const f of SECRET_FILES) {
      const value = readFileSync(join(target, f), 'utf8').trim();
      expect(value).toMatch(/^[0-9a-f]{64}$/);
      expect(first.out).not.toContain(value);
      // NTFS reports 0666 whatever the script does, so the mode is checked on POSIX only. The script's guard is
      // `umask 077` before any file is created, and that is checked everywhere.
      if (process.platform !== 'win32') expect(statSync(join(target, f)).mode & 0o077).toBe(0);
    }
    expect(readFileSync(join(DEPLOY, 'gen-secrets.sh'), 'utf8')).toContain('umask 077');
    const before = readFileSync(join(target, 'rcon.txt'), 'utf8');
    const second = run('gen-secrets.sh', { ...fx, env }, {});
    expect(second.code).toBe(0);
    expect(second.out).toContain('kept (exists): rcon.txt');
    expect(readFileSync(join(target, 'rcon.txt'), 'utf8')).toBe(before);
  });
});
