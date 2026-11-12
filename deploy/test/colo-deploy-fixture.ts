// Shared fixture for the Colo deploy script tests (decision 0084). The scripts run under `sh` with fake `docker`, `stat`, `id` and
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
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, vi } from 'vitest';

export const DEPLOY = fileURLToPath(new URL('..', import.meta.url));
export const COMPOSE = resolve(DEPLOY, '..', 'compose', 'colo.yml');
// The secrets the merged config declares: the compose NAME and the file each reads from (compose/colo.yml with
// deploy/compose.secrets.yml). The fixture config lists these, so the script's check reads them from the config.
export const SECRETS: [string, string][] = [
  ['postgres', 'postgres.txt'],
  ['rcon', 'rcon.txt'],
  ['velocity-forwarding', 'velocity-forwarding.txt'],
  ['nats-body', 'nats-body.txt'],
  ['nats-mind', 'nats-mind.txt'],
  ['postgres-mcp.txt', 'postgres-mcp.txt'],
  ['mcp-token-pepper.txt', 'mcp-token-pepper.txt'],
  ['nats-mcp', 'nats-mcp.txt'],
];
export const SECRET_FILES = SECRETS.map(([, file]) => file);
// The files gen-secrets.sh creates; the NATS files are written on a trusted machine, never here.
export const GENERATED = [
  'postgres.txt',
  'rcon.txt',
  'velocity-forwarding.txt',
  'nats-body.txt',
  'postgres-mcp.txt',
  'postgres-glass.txt',
  'postgres-register.txt',
  'register-pepper.txt',
  'mcp-token-pepper.txt',
];
// The fake chown: records each call ("UID PATH") in $FAKE_CHOWN_LOG and changes nothing.
export const CHOWN_SHIM = `#!/bin/sh
echo "$*" >>"$FAKE_CHOWN_LOG"
`;
// Creating a symlink needs developer mode or elevation on Windows; the symlink test is skipped where it is refused.
export const canSymlink = (() => {
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
export const BODY = `registry.example.invalid/geldar/body@sha256:${'1'.repeat(64)}`;
export const MIND = `registry.example.invalid/geldar/mind@sha256:${'2'.repeat(64)}`;
export const PREV_BODY = `registry.example.invalid/geldar/body@sha256:${'3'.repeat(64)}`;
export const PROJECT_FILTER = /-p geldar-colo|label=com\.docker\.compose\.project=geldar-colo/;
// `stats` takes container ids, not a filter. The ids come from the label-filtered `ps -q` call, so it is allowed.
export const STATS_BY_ID = /^stats --no-stream [0-9a-f]+$/;

export function findSh(): string {
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
export const SH = findSh();

// Every test starts several `sh` processes; on a Windows desktop beside the full suite a test took 5-11 s, against
// vitest's 5 s default. 60 s is a bound for real work under full-suite load, not a retry or a skip.
export const SPAWN_TEST_TIMEOUT_MS = 60_000;
vi.setConfig({ testTimeout: SPAWN_TEST_TIMEOUT_MS });

// The fake docker: records its arguments and answers `config` with the fixture file. Every other call succeeds.
export const DOCKER_SHIM = `#!/bin/sh
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
export const STAT_SHIM = `#!/bin/sh
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
export const ID_SHIM = `#!/bin/sh
[ "$1" = "-u" ] || exit 2
echo "\${FAKE_RUNNER_UID:-1000}"
`;

export const CONFIG = (published: string) => `name: geldar-colo
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
export function secretsBlock(dir: string, decls: [string, string][]): string {
  const entries = decls.map(
    ([n, f]) => `  ${n}:\n    file: ${dir}/${f}\n    name: geldar-colo_${n}\n`,
  );
  return `secrets:\n${entries.join('')}`;
}
export function writeConfig(
  path: string,
  dir: string,
  decls: [string, string][],
  published = '25567',
  extra = '',
) {
  writeFileSync(path, `${CONFIG(published)}${extra}${secretsBlock(posix(dir), decls)}`);
}
// A service that the nats-auth overlay gives the server config as a read-only bind file.
export const NATS_BIND = (conf: string) =>
  `  nats:\n    volumes:\n      - type: bind\n        source: ${conf}\n        target: /etc/nats/nats-auth.conf\n`;

export const release = (body: string, mind = MIND) =>
  `# test manifest\nGELDAR_BODY_IMAGE=${body}\nGELDAR_MIND_IMAGE=${mind}\nGELDAR_ADMIN_IMAGE=registry.example.invalid/geldar/admin@sha256:${'6'.repeat(64)}\nGELDAR_GLASS_IMAGE=registry.example.invalid/geldar/glass@sha256:${'7'.repeat(64)}\n`;
// Paths reach sh as forward slashes: MSYS sh on Windows reads C:/ paths reliably.
export const posix = (p: string) => p.replace(/\\/g, '/');
export const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
export const secretValue = (f: string) => `${f}-test-value`;

export interface Fixture {
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
  chunkyLock: string;
  chunkyText: string;
}

const dirs: string[] = [];

export function writeShim(bin: string, name: string, text: string) {
  writeFileSync(join(bin, name), text);
  chmodSync(join(bin, name), 0o755);
}

export function fixture(publishedPort = '25567'): Fixture {
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
  // Chunky (pregeneration) gets its own local fixture lock, so no test reaches the real Modrinth CDN.
  const chunkyText = 'chunky-test-jar';
  const chunkyJar = join(dir, 'chunky.jar');
  writeFileSync(chunkyJar, chunkyText);
  const chunkyLock = join(dir, 'chunky.lock.json');
  writeFileSync(chunkyLock, lockText(pathToFileURL(chunkyJar).href, sha256(chunkyText)));
  const calls = join(dir, 'calls.log');
  const env: Record<string, string> = { ...(process.env as Record<string, string>) };
  delete env.Path;
  Object.assign(env, {
    // The shims come first. The directory of the chosen sh follows, so that Git for Windows' coreutils resolve.
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
    GELDAR_CHUNKY_LOCK: posix(chunkyLock),
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
    chunkyLock,
    chunkyText,
  };
}

export function lockText(url: string, sha: string): string {
  return `{\n  "url": "${url}",\n  "sha256": "${sha}"\n}\n`;
}

export function setMode(fx: Fixture, file: string, mode: string) {
  writeFileSync(join(fx.modes, file), `${mode}\n`);
}

// Sets the owner uid the fake stat reports for a file or the secrets directory (by its base name).
export function setOwner(fx: Fixture, file: string, uid: string) {
  writeFileSync(join(fx.owners, file), `${uid}\n`);
}

export function run(
  script: string,
  fx: Fixture,
  extra: Record<string, string> = {},
  args: string[] = [],
) {
  const r = spawnSync(SH, [posix(join(DEPLOY, script)), ...args], {
    env: { ...fx.env, ...extra },
    encoding: 'utf8',
  });
  return { code: r.status ?? -1, out: `${r.stdout}${r.stderr}` };
}

export function calls(fx: Fixture): string[] {
  return existsSync(fx.calls) ? readFileSync(fx.calls, 'utf8').split('\n').filter(Boolean) : [];
}

export const mutates = (log: string[]) => log.some((c) => / (pull|up) /.test(c));
export const REAL = { DEPLOY_DRY_RUN: '0' };

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
