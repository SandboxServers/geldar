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

// colo-up.sh passes --force-recreate to `up` only when a container of the geldar-colo project is attached to a network id
// that no longer exists (C2-07h: compose recreated the network, the stopped containers kept the old id). The fake docker
// answers ps/inspect/network inspect from the FAKE_* variables and records every call.
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
const RELEASE = `GELDAR_BODY_IMAGE=${img('body', '1')}\nGELDAR_MIND_IMAGE=${img('mind', '2')}\nGELDAR_ADMIN_IMAGE=${img('admin', '6')}\nGELDAR_GLASS_IMAGE=${img('glass', '7')}\n`;
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

// FAKE_CONTAINERS: ids "ps -aq" lists for the project label (and only then). FAKE_NET_OF: the network id every
// container reports. FAKE_GONE: network ids that `network inspect` refuses.
const DOCKER_SHIM = `#!/bin/sh
printf '%s\\n' "$*" >> "$DOCKER_CALLS_LOG"
case "$*" in
  *"config --quiet"*) exit 0 ;;
  "ps -aq --filter label=com.docker.compose.project=geldar-colo") for c in $FAKE_CONTAINERS; do echo "$c"; done; exit 0 ;;
  "inspect -f"*) echo "$FAKE_NET_OF "; exit 0 ;;
  "network inspect "*) for g in $FAKE_GONE; do [ "$3" = "$g" ] && exit 1; done; exit 0 ;;
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
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function writeShim(bin: string, name: string, text: string) {
  writeFileSync(join(bin, name), text);
  chmodSync(join(bin, name), 0o755);
}

function runUp(extra: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), 'geldar-colo-stale-'));
  dirs.push(dir);
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  writeShim(bin, 'docker', DOCKER_SHIM);
  writeShim(bin, 'stat', STAT_SHIM);
  writeShim(bin, 'id', ID_SHIM);
  const secrets = join(dir, 'secrets');
  mkdirSync(secrets);
  for (const f of SECRET_FILES) writeFileSync(join(secrets, f), `${f}-test-value\n`);
  const releaseFile = join(dir, 'release.env');
  writeFileSync(releaseFile, RELEASE);
  const block = SECRET_FILES.map((f) => f.replace(/\.txt$/, ''))
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
    DEPLOY_DRY_RUN: '0',
    DOCKER_CALLS_LOG: posix(calls),
    DOCKER_CONFIG_FIXTURE: posix(config),
    FAKE_CONTAINERS: '',
    FAKE_NET_OF: 'net-live',
    FAKE_GONE: '',
    ...extra,
  });
  const r = spawnSync(SH, [posix(join(DEPLOY, 'colo-up.sh'))], { env, encoding: 'utf8' });
  const log = existsSync(calls) ? readFileSync(calls, 'utf8').split('\n').filter(Boolean) : [];
  return { code: r.status ?? -1, out: `${r.stdout}${r.stderr}`, log };
}

const ups = (log: string[]) => log.filter((c) => / up -d /.test(c));

describe('colo-up.sh and containers left on a removed network', () => {
  it('adds --force-recreate to every up when a project container is on a network that is gone', () => {
    const r = runUp({ FAKE_CONTAINERS: 'c1 c2', FAKE_NET_OF: 'net-old', FAKE_GONE: 'net-old' });
    expect(r.code, r.out).toBe(0);
    const u = ups(r.log);
    expect(u).toHaveLength(3);
    for (const call of u) expect(call).toContain('--force-recreate');
    expect(r.log.some((c) => /(^| )down( |$)|volume|rm /.test(c) && !/--rm/.test(c))).toBe(false);
  });

  it('does not force a recreate when every network id still exists', () => {
    const r = runUp({ FAKE_CONTAINERS: 'c1 c2' });
    expect(r.code, r.out).toBe(0);
    expect(ups(r.log)).toHaveLength(3);
    for (const call of ups(r.log)) expect(call).not.toContain('--force-recreate');
  });

  it('does not force a recreate when the project has no container', () => {
    const r = runUp({ FAKE_NET_OF: 'net-old', FAKE_GONE: 'net-old' });
    expect(r.code, r.out).toBe(0);
    for (const call of ups(r.log)) expect(call).not.toContain('--force-recreate');
  });

  it('only asks about containers through the project label filter', () => {
    const r = runUp({ FAKE_CONTAINERS: 'c1' });
    const ps = r.log.filter((c) => c.startsWith('ps -aq'));
    expect(ps).not.toHaveLength(0);
    for (const c of ps) expect(c).toContain('label=com.docker.compose.project=geldar-colo');
  });
});
