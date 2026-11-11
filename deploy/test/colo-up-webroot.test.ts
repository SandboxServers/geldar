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

// colo-up.sh makes the BlueMap webroot (bluemap/web in the Paper volume) before `up`, because bluemap-web mounts it as a
// volume subpath (ruling R28, C2-07d). Its own small fixture; colo-up-order.test.ts has the order of the other steps.
const DEPLOY = fileURLToPath(new URL('..', import.meta.url));
const ROOT = resolve(DEPLOY, '..');
const COMPOSE = resolve(ROOT, 'compose', 'colo.yml');
const SECRET_FILES = [
  'postgres.txt',
  'rcon.txt',
  'velocity-forwarding.txt',
  'nats-body.txt',
  'nats-paper.txt',
  'nats-velocity.txt',
  'nats-eventsink.txt',
  'nats-auth.conf',
];
const img = (name: string, c: string) =>
  `registry.example.invalid/geldar/${name}@sha256:${c.repeat(64)}`;
const ADMIN = img('admin', '6');
const RELEASE = `GELDAR_BODY_IMAGE=${img('body', '1')}\nGELDAR_MIND_IMAGE=${img('mind', '2')}\nGELDAR_ADMIN_IMAGE=${ADMIN}\nGELDAR_GLASS_IMAGE=${img('glass', '7')}\n`;
const posix = (p: string) => p.replace(/\\/g, '/');

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
vi.setConfig({ testTimeout: 60_000 });

const DOCKER_SHIM = `#!/bin/sh
printf '%s\\n' "$*" >> "$DOCKER_CALLS_LOG"
case "$*" in
  *"config --quiet"*) exit 0 ;;
  *"config"*) cat "$DOCKER_CONFIG_FIXTURE"; exit 0 ;;
esac
exit 0
`;
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

const dirs: string[] = [];
interface Fixture {
  env: Record<string, string>;
  calls: string;
}

function writeShim(bin: string, name: string, text: string) {
  writeFileSync(join(bin, name), text);
  chmodSync(join(bin, name), 0o755);
}

function fixture(release = RELEASE): Fixture {
  const dir = mkdtempSync(join(tmpdir(), 'geldar-colo-webroot-'));
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
  writeFileSync(releaseFile, release);
  const names = SECRET_FILES.map((f) => f.replace(/\.txt$/, ''));
  const block = names
    .map(
      (n, i) =>
        `  ${n}:\n    file: ${posix(secrets)}/${SECRET_FILES[i]}\n    name: geldar-colo_${n}\n`,
    )
    .join('');
  const config = join(dir, 'config.yml');
  writeFileSync(
    config,
    `name: geldar-colo\nservices:\n  nats:\n    secrets:\n      - source: nats-auth\n        target: /etc/nats/nats-auth.conf\nsecrets:\n${block}`,
  );
  const jarText = 'bluemap-test-jar';
  const jar = join(dir, 'bluemap.jar');
  writeFileSync(jar, jarText);
  const lock = join(dir, 'bluemap.lock.json');
  const sha = createHash('sha256').update(jarText).digest('hex');
  writeFileSync(lock, `{\n  "url": "${pathToFileURL(jar).href}",\n  "sha256": "${sha}"\n}\n`);
  const calls = join(dir, 'calls.log');
  const env: Record<string, string> = { ...(process.env as Record<string, string>) };
  delete env.Path;
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
    GELDAR_SECRETS_DIR: posix(secrets),
    GELDAR_RELEASE_FILE: posix(releaseFile),
    GELDAR_STATE_DIR: posix(join(dir, 'state')),
    GELDAR_BLUEMAP_LOCK: posix(lock),
    GELDAR_DEPLOY_ALLOW_FILE_URL: '1',
    GELDAR_MIN_FREE_KB: '1',
    GELDAR_SERVICE_UID: '1000',
    DEPLOY_DRY_RUN: '0',
    DOCKER_CALLS_LOG: posix(calls),
    DOCKER_CONFIG_FIXTURE: posix(config),
    FAKE_MODE_DIR: posix(modes),
    FAKE_OWNER_DIR: posix(modes),
  });
  return { env, calls };
}

function run(fx: Fixture, extra: Record<string, string> = {}) {
  const r = spawnSync(SH, [posix(join(DEPLOY, 'colo-up.sh'))], {
    env: { ...fx.env, ...extra },
    encoding: 'utf8',
  });
  return { code: r.status ?? -1, out: `${r.stdout}${r.stderr}` };
}

const calls = (fx: Fixture): string[] =>
  existsSync(fx.calls) ? readFileSync(fx.calls, 'utf8').split('\n').filter(Boolean) : [];
const MKDIR = / run --rm --no-deps .*mkdir -p \/data\/bluemap\/web/;

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('colo-up.sh: the BlueMap webroot (C2-07d, ruling R28)', () => {
  it('creates bluemap/web in the Paper volume once, before the first up', () => {
    const fx = fixture();
    const r = run(fx);
    expect(r.code).toBe(0);
    const log = calls(fx);
    const mk = log.filter((c) => MKDIR.test(c));
    expect(mk).toHaveLength(1);
    const at = log.findIndex((c) => MKDIR.test(c));
    const firstUp = log.findIndex((c) => / up -d /.test(c));
    expect(firstUp).toBeGreaterThan(at);
    expect(log.some((c) => c.includes(' pull') && log.indexOf(c) < at)).toBe(true);
  });

  it('runs the project-scoped admin service with only the project volume and the service uid', () => {
    const fx = fixture();
    run(fx);
    const c = calls(fx).find((x) => MKDIR.test(x)) ?? '';
    expect(c).toContain(' admin -c ');
    expect(c).toContain('-v geldar-colo_paper-data:/data');
    expect(c).toContain('-p geldar-colo ');
    expect(c).toContain('--cap-add CHOWN');
    expect(c).not.toContain('--privileged');
    expect(c).toContain('chown 1000:1000 /data/bluemap /data/bluemap/web');
    expect(c).not.toContain(' -R');
    expect(c.match(/-v /g)).toHaveLength(1);
  });

  it('is idempotent: a second run issues the same single command', () => {
    const fx = fixture();
    run(fx);
    const first = calls(fx).filter((c) => MKDIR.test(c));
    run(fx);
    const all = calls(fx).filter((c) => MKDIR.test(c));
    expect(all).toHaveLength(2);
    expect(all[1]).toBe(first[0]);
  });

  it('dry run names the step and runs nothing', () => {
    const fx = fixture();
    const r = run(fx, { DEPLOY_DRY_RUN: '1' });
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/dry-run, not run: dc run --rm .*mkdir -p \/data\/bluemap\/web/);
    expect(calls(fx).some((c) => MKDIR.test(c))).toBe(false);
  });

  it('refuses a release without the admin image, and runs nothing', () => {
    const fx = fixture(RELEASE.replace(/GELDAR_ADMIN_IMAGE=.*\n/, ''));
    const r = run(fx);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('GELDAR_ADMIN_IMAGE');
    expect(calls(fx).some((c) => MKDIR.test(c))).toBe(false);
  });
});

describe('colo-up.sh: the skins bucket and the jar sources (C2-07j)', () => {
  const SKINS = / run --rm .*admin ensure-skins-bucket/;

  it('makes the skins bucket after nats is up and before the full up that starts velocity', () => {
    const fx = fixture();
    expect(run(fx).code).toBe(0);
    const log = calls(fx);
    const at = log.findIndex((c) => SKINS.test(c));
    expect(at).toBeGreaterThan(-1);
    const natsUp = log.findIndex((c) => / up -d --wait .*postgres nats/.test(c));
    const fullUp = log.findIndex((c, i) => i > natsUp && / up -d --wait\s*$/.test(c));
    expect(natsUp).toBeLessThan(at);
    expect(fullUp).toBeGreaterThan(at);
  });

  it('refuses when a plugin jar path is a directory, names it, and starts nothing', () => {
    const fx = fixture();
    const plugins = join(dirname(fx.env.GELDAR_SECRETS_DIR), 'plugins');
    const jarDir = join(plugins, 'core', 'build', 'libs', 'geldar-core.jar');
    mkdirSync(jarDir, { recursive: true });
    const r = run(fx, { GELDAR_PLUGIN_DIR: posix(plugins) });
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('geldar-core.jar');
    expect(r.out).toContain('rmdir');
    expect(calls(fx).some((c) => / up -d /.test(c) || / pull/.test(c))).toBe(false);
  });

  it('accepts jar paths that are files or missing', () => {
    const fx = fixture();
    const plugins = join(dirname(fx.env.GELDAR_SECRETS_DIR), 'plugins');
    const libs = join(plugins, 'velocity-identity', 'build', 'libs');
    mkdirSync(libs, { recursive: true });
    writeFileSync(join(libs, 'geldar-velocity-identity.jar'), 'x');
    expect(run(fx, { GELDAR_PLUGIN_DIR: posix(plugins) }).code).toBe(0);
  });
});
