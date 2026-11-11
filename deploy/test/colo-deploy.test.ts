// Tests for the Colo deploy scripts (decision 0084). The scripts run under `sh` with a fake `docker` on PATH that
// records each call and answers only the read-only subcommands. No real docker, node or network is used: the BlueMap
// "download" is a local file:// fixture. On Windows, put Git for Windows' usr/bin on PATH so that `sh` resolves.
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
import { delimiter, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const DEPLOY = fileURLToPath(new URL('..', import.meta.url));
const COMPOSE = resolve(DEPLOY, '..', 'compose', 'colo.yml');
const SECRET_FILES = ['postgres.txt', 'rcon.txt', 'velocity-forwarding.txt', 'nats-body.txt'];
const BODY = `registry.example.invalid/geldar/body@sha256:${'1'.repeat(64)}`;
const MIND = `registry.example.invalid/geldar/mind@sha256:${'2'.repeat(64)}`;
const PREV_BODY = `registry.example.invalid/geldar/body@sha256:${'3'.repeat(64)}`;
const PROJECT_FILTER = /-p geldar-colo|label=com\.docker\.compose\.project=geldar-colo/;

// The fake docker: records its arguments and answers `config` with the fixture file. Every other call succeeds.
const SHIM = `#!/bin/sh
printf '%s\\n' "$*" >> "$DOCKER_CALLS_LOG"
case "$*" in
  *" config --quiet"*) exit 0 ;;
  *" config"*) cat "$DOCKER_CONFIG_FIXTURE"; exit 0 ;;
  *" ps -q"*) echo c0ffee01 ;;
esac
exit 0
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
    image: ${BODY}
  animus:
    image: ${MIND}
`;

const release = (body: string, mind = MIND) => `# test manifest\nGELDAR_BODY_IMAGE=${body}\nGELDAR_MIND_IMAGE=${mind}\n`;
// Paths reach sh as forward slashes: MSYS sh on Windows reads C:/ paths reliably.
const posix = (p: string) => p.replace(/\\\\/g, '/');
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

interface Fixture {
  dir: string;
  env: Record<string, string>;
  calls: string;
  secrets: string;
  release: string;
  state: string;
  lock: string;
  jarText: string;
}

const dirs: string[] = [];

function fixture(publishedPort = '25567'): Fixture {
  const dir = mkdtempSync(join(tmpdir(), 'geldar-colo-test-'));
  dirs.push(dir);
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'docker'), SHIM);
  chmodSync(join(bin, 'docker'), 0o755);
  const secrets = join(dir, 'secrets');
  mkdirSync(secrets);
  for (const f of SECRET_FILES) {
    writeFileSync(join(secrets, f), `${f}-test-value\n`);
    chmodSync(join(secrets, f), 0o600);
  }
  const releaseFile = join(dir, 'release.env');
  writeFileSync(releaseFile, release(BODY));
  chmodSync(releaseFile, 0o600);
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
    PATH: [bin, process.env.PATH ?? process.env.Path ?? ''].join(delimiter),
    GELDAR_COLO_COMPOSE: posix(COMPOSE),
    GELDAR_SECRETS_DIR: posix(secrets),
    GELDAR_RELEASE_FILE: posix(releaseFile),
    GELDAR_STATE_DIR: posix(join(dir, 'state')),
    GELDAR_BLUEMAP_LOCK: posix(lock),
    GELDAR_MIN_FREE_KB: '1',
    DEPLOY_DRY_RUN: '1',
    DOCKER_CALLS_LOG: posix(calls),
    DOCKER_CONFIG_FIXTURE: posix(config),
  });
  return { dir, env, calls, secrets, release: releaseFile, state: join(dir, 'state'), lock, jarText };
}

function lockText(url: string, sha: string): string {
  return `{\n  "url": "${url}",\n  "sha256": "${sha}"\n}\n`;
}

function run(script: string, fx: Fixture, extra: Record<string, string> = {}, args: string[] = []) {
  const r = spawnSync('sh', [posix(join(DEPLOY, script)), ...args], {
    env: { ...fx.env, ...extra },
    encoding: 'utf8',
  });
  return { code: r.status ?? -1, out: `${r.stdout}${r.stderr}` };
}

function calls(fx: Fixture): string[] {
  return existsSync(fx.calls) ? readFileSync(fx.calls, 'utf8').split('\n').filter(Boolean) : [];
}

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
    expect(log.some((c) => / (pull|up) /.test(c))).toBe(false);
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
  });

  it('refuses when a secret file is missing, and runs no pull or up', () => {
    const fx = fixture();
    rmSync(join(fx.secrets, 'rcon.txt'));
    const r = run('colo-up.sh', fx, REAL);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('rcon.txt');
    expect(calls(fx).some((c) => / (pull|up) /.test(c))).toBe(false);
  });

  it('refuses a secret file that other accounts can read', () => {
    const fx = fixture();
    chmodSync(join(fx.secrets, 'postgres.txt'), 0o644);
    const r = run('colo-up.sh', fx, REAL);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('postgres.txt has mode');
    expect(calls(fx).some((c) => / (pull|up) /.test(c))).toBe(false);
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
    expect(calls(fx).some((c) => / (pull|up) /.test(c))).toBe(false);
  });

  it('refuses a BlueMap jar whose sha256 does not match the lock', () => {
    const fx = fixture();
    writeFileSync(fx.lock, lockText(pathToFileURL(join(fx.dir, 'bluemap.jar')).href, '0'.repeat(64)));
    const r = run('colo-up.sh', fx, REAL);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('sha256 mismatch');
    expect(existsSync(join(fx.state, 'bluemap', 'bluemap.jar'))).toBe(false);
    expect(calls(fx).some((c) => / (pull|up) /.test(c))).toBe(false);
  });

  it('accepts a BlueMap jar whose sha256 matches the lock', () => {
    const fx = fixture();
    const r = run('colo-up.sh', fx, REAL);
    expect(r.code).toBe(0);
    expect(r.out).toContain('jar verified');
  });

  it('refuses when the merged config publishes 25565 or 25566', () => {
    for (const port of ['25565', '25566']) {
      const fx = fixture(port);
      const r = run('colo-up.sh', fx, REAL);
      expect(r.code).not.toBe(0);
      expect(r.out).toContain('publishes 25565 or 25566');
      expect(calls(fx).some((c) => / (pull|up) /.test(c))).toBe(false);
    }
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
      const allowed = PROJECT_FILTER.test(c) || /^(compose version|info)$/.test(c);
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
      expect(statSync(join(target, f)).mode & 0o077).toBe(0);
    }
    const before = readFileSync(join(target, 'rcon.txt'), 'utf8');
    const second = run('gen-secrets.sh', { ...fx, env }, {});
    expect(second.code).toBe(0);
    expect(second.out).toContain('kept (exists): rcon.txt');
    expect(readFileSync(join(target, 'rcon.txt'), 'utf8')).toBe(before);
  });
});
