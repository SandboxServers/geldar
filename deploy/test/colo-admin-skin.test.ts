// Tests for `colo-admin.sh skin-import` (decision 0140 runbook): the signed skins JSON is mounted read-only from a 0700
// host directory into the one-shot admin container, and its value is never an argument or output. Same harness as
// colo-admin.test.ts: sh with a fake docker (records calls, copies the overlay) and a fake stat (modes).
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
const SENTINEL = 'sentinel-signed-value-that-must-never-print';
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
vi.setConfig({ testTimeout: 30_000 });

const DOCKER_SHIM = `#!/bin/sh
printf '%s\\n' "$*" >> "$DOCKER_CALLS_LOG"
for a in "$@"; do case $a in *.override.yml) cp "$a" "$DOCKER_CALLS_LOG.overlay" ;; esac; done
case "$*" in
  *"config --quiet"*) exit 0 ;;
  *"config"*) cat "$DOCKER_CONFIG_FIXTURE"; exit 0 ;;
esac
exit 0
`;
const STAT_SHIM = `#!/bin/sh
[ "$1" = "-c" ] || exit 2
name=\${3##*/}
case $2 in
  %a) if [ -f "$FAKE_MODE_DIR/$name" ]; then read -r v <"$FAKE_MODE_DIR/$name"; else v=600; fi ;;
  %u) v=1000 ;;
  *) exit 2 ;;
esac
echo "$v"
`;
const ID_SHIM = '#!/bin/sh\necho 1000\n';

const posix = (p: string) => p.replace(/\\/g, '/');
const dirs: string[] = [];

interface Fixture {
  dir: string;
  env: Record<string, string>;
  callsLog: string;
  skins: string;
  state: string;
}

function shim(bin: string, name: string, text: string) {
  writeFileSync(join(bin, name), text);
  chmodSync(join(bin, name), 0o755);
}

function fixture(): Fixture {
  const dir = mkdtempSync(join(tmpdir(), 'geldar-colo-skin-test-'));
  dirs.push(dir);
  const bin = join(dir, 'bin');
  const secrets = join(dir, 'secrets');
  const modes = join(dir, 'modes');
  const skins = join(dir, 'skins');
  for (const d of [bin, secrets, modes, skins, join(dir, 'repo')]) mkdirSync(d);
  shim(bin, 'docker', DOCKER_SHIM);
  shim(bin, 'stat', STAT_SHIM);
  shim(bin, 'id', ID_SHIM);
  for (const f of SECRET_FILES) writeFileSync(join(secrets, f), `${f}-test-value\n`);
  writeFileSync(join(modes, 'skins'), '700\n');
  const releaseFile = join(dir, 'release.env');
  writeFileSync(releaseFile, `GELDAR_BODY_IMAGE=${BODY}\nGELDAR_ADMIN_IMAGE=${ADMIN}\n`);
  const config = join(dir, 'config.yml');
  const decls = ['postgres', 'rcon', 'velocity-forwarding', 'nats-body'];
  const block = decls.map((n) => `  ${n}:\n    file: ${posix(secrets)}/${n}.txt\n`).join('');
  writeFileSync(
    config,
    `name: geldar-colo\nservices:\n  postgres:\n    image: pgvector/pgvector@sha256:${'5'.repeat(64)}\n  admin:\n    image: ${ADMIN}\nsecrets:\n${block}`,
  );
  const callsLog = join(dir, 'calls.log');
  const env: Record<string, string> = { ...(process.env as Record<string, string>) };
  delete env.Path;
  delete env.GELDAR_SKINS_DIR;
  Object.assign(env, {
    PATH: [
      bin,
      SH === 'sh' ? '' : dirname(SH),
      process.platform === 'win32' ? join(dirname(SH), '..', '..', 'mingw64', 'bin') : '',
      process.platform === 'win32' ? '' : (process.env.PATH ?? ''),
    ]
      .filter(Boolean)
      .join(delimiter),
    GELDAR_COLO_COMPOSE: posix(COMPOSE),
    GELDAR_COLO_ROOT: posix(join(dir, 'repo')),
    GELDAR_SECRETS_DIR: posix(secrets),
    GELDAR_RELEASE_FILE: posix(releaseFile),
    GELDAR_STATE_DIR: posix(join(dir, 'state')),
    GELDAR_MIN_FREE_KB: '1',
    DEPLOY_DRY_RUN: '0',
    DOCKER_CALLS_LOG: posix(callsLog),
    DOCKER_CONFIG_FIXTURE: posix(config),
    FAKE_MODE_DIR: posix(modes),
    GELDAR_SKINS_DIR: posix(skins),
  });
  return { dir, env, callsLog, skins, state: join(dir, 'state') };
}

function run(fx: Fixture, args: string[], extra: Record<string, string> = {}) {
  const r = spawnSync(SH, [posix(join(DEPLOY, 'colo-admin.sh')), ...args], {
    env: { ...fx.env, ...extra },
    encoding: 'utf8',
  });
  return { code: r.status ?? -1, out: `${r.stdout}${r.stderr}` };
}

const calls = (fx: Fixture): string[] =>
  existsSync(fx.callsLog) ? readFileSync(fx.callsLog, 'utf8').split('\n').filter(Boolean) : [];
const starts = (log: string[]) => log.filter((c) => / run /.test(c));
const FILE = '/run/skins/ranger-skins.json';
const put = (fx: Fixture, name = 'ranger-skins.json') =>
  writeFileSync(join(fx.skins, name), `{"ag-jason-01":{"value":"${SENTINEL}"}}`);

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('colo-admin.sh skin-import', () => {
  it('runs one admin container with the player id and the in-container path, never the value', () => {
    const fx = fixture();
    put(fx);
    const r = run(fx, ['skin-import', 'ag-jason-01', '--file', FILE]);
    expect(r.code).toBe(0);
    const started = starts(calls(fx));
    expect(started).toHaveLength(1);
    expect(started[0]).toMatch(
      /--profile admin run --rm admin skin-import ag-jason-01 \/run\/skins\/ranger-skins\.json$/,
    );
    expect(calls(fx).join('\n')).not.toContain(SENTINEL);
    expect(r.out).not.toContain(SENTINEL);
  });

  it('mounts the skins directory read-only at /run/skins in a 0600 overlay that goes away', () => {
    const fx = fixture();
    put(fx);
    run(fx, ['skin-import', 'ag-jason-01', '--file', FILE]);
    const overlay = readFileSync(`${fx.callsLog}.overlay`, 'utf8');
    expect(overlay).toContain('target: /run/skins');
    expect(overlay).toContain('read_only: true');
    expect(overlay).toMatch(/source: ".*geldar-colo-skin-test-[A-Za-z0-9]+\/skins"/);
    expect(overlay).not.toContain(SENTINEL);
    expect(existsSync(join(fx.state, 'admin-skins.override.yml'))).toBe(false);
  });

  it.each([
    ['an uppercase id', 'AG-jason-01', '--file', FILE, 'player id must match'],
    ['an id without the ag- prefix', 'jason', '--file', FILE, 'player id must match'],
    ['an id with a shell character', 'ag-a;b', '--file', FILE, 'player id must match'],
    [
      'a path outside /run/skins',
      'ag-jason-01',
      '--file',
      '/etc/ranger-skins.json',
      'under /run/skins',
    ],
    ['a path with ..', 'ag-jason-01', '--file', '/run/skins/../x.json', 'must not contain'],
    ['a nested path', 'ag-jason-01', '--file', '/run/skins/a/b.json', 'one .json file'],
    ['a non-json name', 'ag-jason-01', '--file', '/run/skins/skins.txt', 'one .json file'],
    ['a missing --file flag', 'ag-jason-01', '--out', FILE, 'takes <player-id> --file'],
  ])('refuses %s before any container starts', (_name, p, flag, file, message) => {
    const fx = fixture();
    put(fx);
    const r = run(fx, ['skin-import', p, flag, file]);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain(message);
    expect(starts(calls(fx))).toEqual([]);
  });

  it('refuses a file that is not in the skins directory, and an empty one', () => {
    const fx = fixture();
    const missing = run(fx, ['skin-import', 'ag-jason-01', '--file', FILE]);
    expect(missing.code).not.toBe(0);
    expect(missing.out).toContain('not in GELDAR_SKINS_DIR');
    writeFileSync(join(fx.skins, 'ranger-skins.json'), '');
    const empty = run(fx, ['skin-import', 'ag-jason-01', '--file', FILE]);
    expect(empty.code).not.toBe(0);
    expect(empty.out).toContain('is empty');
    expect(starts(calls(fx))).toEqual([]);
  });

  it('refuses an unset GELDAR_SKINS_DIR and a directory that is not 0700', () => {
    const fx = fixture();
    put(fx);
    const unset = run(fx, ['skin-import', 'ag-jason-01', '--file', FILE], { GELDAR_SKINS_DIR: '' });
    expect(unset.out).toContain('skin-import needs GELDAR_SKINS_DIR');
    writeFileSync(join(fx.dir, 'modes', 'skins'), '755\n');
    const loose = run(fx, ['skin-import', 'ag-jason-01', '--file', FILE]);
    expect(loose.code).not.toBe(0);
    expect(loose.out).toContain('must be 0700');
    expect(starts(calls(fx))).toEqual([]);
  });

  it('exits non-zero when the container fails, and says so without the value', () => {
    const fx = fixture();
    put(fx);
    const bin = join(fx.dir, 'bin');
    shim(
      bin,
      'docker',
      `${DOCKER_SHIM.replace('exit 0\n', '')}case "$*" in *" run "*) echo failed; exit 1 ;; esac\nexit 0\n`,
    );
    const r = run(fx, ['skin-import', 'ag-jason-01', '--file', FILE]);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('skin-import failed');
    expect(r.out).not.toContain(SENTINEL);
    expect(existsSync(join(fx.state, 'admin-skins.override.yml'))).toBe(false);
  });

  it('dry run starts nothing', () => {
    const fx = fixture();
    put(fx);
    const r = run(fx, ['skin-import', 'ag-jason-01', '--file', FILE], { DEPLOY_DRY_RUN: '1' });
    expect(r.code).toBe(0);
    expect(starts(calls(fx))).toEqual([]);
    expect(r.out).toContain('dry-run');
  });
});
