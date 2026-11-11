import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
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
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The order of colo-up.sh and the NATS overlay: Postgres and NATS start first, both admin runs come next, and the full
// core starts last. Every compose call merges compose/nats-auth.yml. Its own fixtures; colo-deploy.test.ts has the rest.
const DEPLOY = fileURLToPath(new URL('..', import.meta.url));
const ROOT = resolve(DEPLOY, '..');
const COMPOSE = resolve(ROOT, 'compose', 'colo.yml');
const NATS_OVERLAY_TEXT = readFileSync(resolve(ROOT, 'compose', 'nats-auth.yml'), 'utf8');
const DEPLOY_SECRETS_TEXT = readFileSync(resolve(DEPLOY, 'compose.secrets.yml'), 'utf8');
// Built by concatenation: a literal dollar-brace in a plain string trips Biome.
const INTERP = `$${'{'}`;
const SECRETS: [string, string][] = [
  ['postgres', 'postgres.txt'],
  ['rcon', 'rcon.txt'],
  ['velocity-forwarding', 'velocity-forwarding.txt'],
  ['nats-body', 'nats-body.txt'],
  ['nats-paper', 'nats-paper.txt'],
  ['nats-velocity', 'nats-velocity.txt'],
  ['nats-eventsink', 'nats-eventsink.txt'],
];
const SECRET_FILES = [...SECRETS.map(([, f]) => f), 'nats-auth.conf'];
const BODY = `registry.example.invalid/geldar/body@sha256:${'1'.repeat(64)}`;
const MIND = `registry.example.invalid/geldar/mind@sha256:${'2'.repeat(64)}`;
const ADMIN = `registry.example.invalid/geldar/admin@sha256:${'6'.repeat(64)}`;
const GLASS = `registry.example.invalid/geldar/glass@sha256:${'7'.repeat(64)}`;
const RELEASE = `# test manifest\nGELDAR_BODY_IMAGE=${BODY}\nGELDAR_MIND_IMAGE=${MIND}\nGELDAR_ADMIN_IMAGE=${ADMIN}\nGELDAR_GLASS_IMAGE=${GLASS}\n`;
const GLASS_LOGIN_STEP = / run --rm admin migrate --set-role-password geldar_glass /;
const posix = (p: string) => p.replace(/\\/g, '/');
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

// MSYS sh on Windows: Git for Windows' sh, unless GELDAR_TEST_SH names another.
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
// The full suite runs beside these spawns; a deploy run took 30 s or more under that load, so the bound is 60 s.
vi.setConfig({ testTimeout: 60_000 });

// The fake docker records its arguments and answers `config` with the fixture file. Every other call succeeds.
const DOCKER_SHIM = `#!/bin/sh
printf '%s\\n' "$*" >> "$DOCKER_CALLS_LOG"
case "$*" in
  *"config --quiet"*) exit 0 ;;
  *"config"*) cat "$DOCKER_CONFIG_FIXTURE"; exit 0 ;;
  *"ps -q"*) echo c0ffee01 ;;
esac
exit 0
`;
// The fake stat reports mode 600 and owner 1000 for every file: the secrets pass, as the service uid.
const STAT_SHIM = `#!/bin/sh
[ "$1" = "-c" ] || exit 2
case $2 in
  %a) echo 600 ;;
  %u) echo 1000 ;;
  *) exit 2 ;;
esac
`;
const ID_SHIM = `#!/bin/sh
[ "$1" = "-u" ] || exit 2
echo 1000
`;

const CONFIG = `name: geldar-colo
services:
  velocity:
    image: itzg/mc-proxy@sha256:${'4'.repeat(64)}
    ports:
      - mode: ingress
        host_ip: 127.0.0.1
        target: 25565
        published: "25567"
        protocol: tcp
  postgres:
    image: pgvector/pgvector@sha256:${'5'.repeat(64)}
  golem-body:
    build:
      context: ..
    image: ${BODY}
`;
// The nats-auth overlay mounts the server config as a secret at the path nats reads (no bind volume), as the merged
// config prints it: the service names the secret, and the top-level block gives its file under GELDAR_SECRETS_DIR.
const NATS_MOUNT = `  nats:\n    secrets:\n      - source: nats-auth.conf\n        target: /etc/nats/nats-auth.conf\n`;
// The top-level secrets block as `docker compose config` prints it: each NAME with the file it reads from.
function secretsBlock(dir: string): string {
  const entries = [...SECRETS, ['nats-auth.conf', 'nats-auth.conf'] as [string, string]].map(
    ([n, f]) => `  ${n}:\n    file: ${dir}/${f}\n    name: geldar-colo_${n}\n`,
  );
  return `secrets:\n${entries.join('')}`;
}
const lockText = (url: string, sha: string) => `{\n  "url": "${url}",\n  "sha256": "${sha}"\n}\n`;

const dirs: string[] = [];
interface Fixture {
  env: Record<string, string>;
  calls: string;
}

function writeShim(bin: string, name: string, text: string) {
  writeFileSync(join(bin, name), text);
  chmodSync(join(bin, name), 0o755);
}

function fixture(): Fixture {
  const dir = mkdtempSync(join(tmpdir(), 'geldar-colo-order-'));
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
  const releaseFile = join(dir, 'release.env');
  writeFileSync(releaseFile, RELEASE);
  const config = join(dir, 'config.yml');
  writeFileSync(config, `${CONFIG}${NATS_MOUNT}${secretsBlock(posix(secrets))}`);
  const jarText = 'bluemap-test-jar';
  const jar = join(dir, 'bluemap.jar');
  writeFileSync(jar, jarText);
  const lock = join(dir, 'bluemap.lock.json');
  writeFileSync(lock, lockText(pathToFileURL(jar).href, sha256(jarText)));
  const calls = join(dir, 'calls.log');
  const env: Record<string, string> = { ...(process.env as Record<string, string>) };
  delete env.Path;
  Object.assign(env, {
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
    GELDAR_SERVICE_UID: '1000',
    DEPLOY_DRY_RUN: '1',
    DOCKER_CALLS_LOG: posix(calls),
    DOCKER_CONFIG_FIXTURE: posix(config),
    FAKE_MODE_DIR: posix(modes),
    FAKE_OWNER_DIR: posix(modes),
  });
  return { env, calls };
}

function run(script: string, fx: Fixture, extra: Record<string, string> = {}) {
  const r = spawnSync(SH, [posix(join(DEPLOY, script))], {
    env: { ...fx.env, ...extra },
    encoding: 'utf8',
  });
  return { code: r.status ?? -1, out: `${r.stdout}${r.stderr}` };
}

const calls = (fx: Fixture): string[] =>
  existsSync(fx.calls) ? readFileSync(fx.calls, 'utf8').split('\n').filter(Boolean) : [];
// Compose calls that name compose files: the fake logs each docker argument list. `compose version` (a prerequisite
// probe) names none, so it is left out.
const composeCalls = (fx: Fixture): string[] =>
  calls(fx).filter((c) => c.startsWith('compose ') && c.includes(' -f '));
const REAL = { DEPLOY_DRY_RUN: '0' };

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('colo-up.sh order (decision 0084, decision 0133)', () => {
  it('starts postgres and nats first, runs both admin steps, and starts the full core last', () => {
    const fx = fixture();
    const r = run('colo-up.sh', fx, REAL);
    expect(r.code).toBe(0);
    const log = composeCalls(fx);
    const at = (re: RegExp) => log.findIndex((c) => re.test(c));
    const pull = at(/ pull$/);
    const natsUp = at(/ up -d --wait postgres nats$/);
    const migrate = at(/ run --rm admin migrate$/);
    const roleLogin = at(/ run --rm admin migrate --set-role-password geldar_mcp /);
    const fullUp = at(/ up -d --wait$/);
    expect(pull).toBeGreaterThanOrEqual(0);
    expect(natsUp).toBeGreaterThan(pull);
    expect(migrate).toBeGreaterThan(natsUp);
    expect(roleLogin).toBeGreaterThan(migrate);
    expect(fullUp).toBeGreaterThan(roleLogin);
    // The glass login runs after the mcp one, before the full core.
    const glassLogin = at(GLASS_LOGIN_STEP);
    expect(glassLogin).toBeGreaterThan(roleLogin);
    expect(fullUp).toBeGreaterThan(glassLogin);
    expect(log[glassLogin]).toContain('--password-file /run/secrets/postgres-glass.txt');
    expect(log[log.length - 1]).toMatch(/ up -d --wait$/);
  });

  it('dry run prints each step in that order and runs no compose call that changes state', () => {
    const fx = fixture();
    const r = run('colo-up.sh', fx);
    expect(r.code).toBe(0);
    const at = (re: RegExp) => r.out.search(re);
    const natsUp = at(/dry-run, not run: dc up -d --wait postgres nats$/m);
    const migrate = at(/colo-admin\.sh migrate$/m);
    const fullUp = at(/dry-run, not run: dc up -d --wait$/m);
    expect(natsUp).toBeGreaterThanOrEqual(0);
    expect(migrate).toBeGreaterThan(natsUp);
    expect(fullUp).toBeGreaterThan(migrate);
    expect(r.out).toContain('dry-run complete');
    expect(calls(fx).some((c) => / (pull|up|run) /.test(c))).toBe(false);
  });

  it('every compose call, the admin runs included, merges the NATS overlay', () => {
    const fx = fixture();
    const r = run('colo-up.sh', fx, REAL);
    expect(r.code).toBe(0);
    const log = composeCalls(fx);
    // A real deploy issues the config checks, the pulls, the admin runs and the core: well over five calls.
    expect(log.length).toBeGreaterThan(5);
    expect(log.some((c) => / run --rm admin /.test(c))).toBe(true);
    for (const c of log) expect(c).toContain('/nats-auth.yml');
  });
});

describe('compose/nats-auth.yml (decision 0080, the node secrets directory)', () => {
  it('names its files under ./secrets with no interpolation and no bind volume (threat model section 1)', () => {
    expect(NATS_OVERLAY_TEXT).not.toContain(INTERP);
    expect(NATS_OVERLAY_TEXT).not.toMatch(/^ +volumes:/m);
    for (const f of [
      'nats-auth.conf',
      'nats-paper.txt',
      'nats-velocity.txt',
      'nats-eventsink.txt',
    ]) {
      expect(NATS_OVERLAY_TEXT).toContain(`file: ./secrets/${f}\n`);
    }
  });

  it('the deploy points each NATS file at GELDAR_SECRETS_DIR, and the up run mounts nats-auth.conf from it', () => {
    const dir = `${INTERP}GELDAR_SECRETS_DIR}`;
    for (const f of [
      'nats-auth.conf',
      'nats-paper.txt',
      'nats-velocity.txt',
      'nats-eventsink.txt',
    ]) {
      expect(DEPLOY_SECRETS_TEXT).toContain(`  ${f}:\n    file: ${dir}/${f}\n`);
    }
    const fx = fixture();
    // The merged config the deploy reads: nats mounts the secret at the path its command names, from the overlay.
    const rendered = readFileSync(fx.env.DOCKER_CONFIG_FIXTURE, 'utf8');
    expect(rendered).toContain('target: /etc/nats/nats-auth.conf');
    expect(NATS_OVERLAY_TEXT).toMatch(
      / {6}- source: nats-auth\.conf\n {8}target: \/etc\/nats\/nats-auth\.conf\n/,
    );
    expect(NATS_OVERLAY_TEXT).toContain('"-c", "/etc/nats/nats-auth.conf"');
    // A missing server config is refused by the deploy, which reads it from GELDAR_SECRETS_DIR.
    rmSync(join(fx.env.GELDAR_SECRETS_DIR, 'nats-auth.conf'));
    const r = run('colo-up.sh', fx, REAL);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('secret file missing: nats-auth.conf');
  });

  it('starts nats with the auth config mounted at /etc/nats/nats-auth.conf', () => {
    expect(NATS_OVERLAY_TEXT).toMatch(
      /command: \["-js", "-sd", "\/data", "-c", "\/etc\/nats\/nats-auth\.conf"/,
    );
  });
});
