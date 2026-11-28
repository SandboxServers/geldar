import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Each case runs the shell script several times (sh startup is slow on Windows), so the file's tests get a longer timeout.
vi.setConfig({ testTimeout: 120000 });

// deploy/nf-deploy.sh (the operator script for the geldar-nf project) runs against a fixture tree. Stub docker, ss, free,
// df and stat sit first on PATH and log every docker call, so a test reads what the script would have run. Nothing is started.
const DEPLOY = fileURLToPath(new URL('..', import.meta.url));
const ROOT = resolve(DEPLOY, '..');
const SCRIPT_SRC = resolve(DEPLOY, 'nf-deploy.sh');
const HUMAN_LIB_SRC = resolve(DEPLOY, 'nf-human-lib.sh');
const SCRIPT_TEXT = readFileSync(SCRIPT_SRC, 'utf8');
const NF_COMPOSE_TEXT = readFileSync(resolve(ROOT, 'compose', 'nf-live.yml'), 'utf8');
const NF_OVERLAY_TEXT = readFileSync(resolve(ROOT, 'compose', 'nf-live-telemetry.yml'), 'utf8');
const SECRET_FILES = /^SECRET_FILES="([^"]+)"$/m.exec(SCRIPT_TEXT)?.[1].split(' ') ?? [];
// The ranger files are required only with NF_RANGERS=on, so they live in deploy/nf-rangers-lib.sh, not in SECRET_FILES.
const RANGER_SECRETS =
  /^RANGER_SECRETS="([^"]+)"$/m
    .exec(readFileSync(resolve(ROOT, 'deploy', 'nf-rangers-lib.sh'), 'utf8'))?.[1]
    .split(' ') ?? [];
const JAR_BYTES = 'geldar neoforge mod fixture\n';
const LIST_BYTES = 'bundle list fixture\n';
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const MOD_SHA = sha(JAR_BYTES);
const TARBALL_BYTES = 'bundle tarball fixture\n';
const TARBALL_SHA = sha(TARBALL_BYTES);
const GOOD_NAMES = ['mods/', 'mods/geldar.jar', '.geldar-bundle.sha256'];
const GOOD_VERBOSE = [
  'drwxr-xr-x 0/0 0 2026-11-01 10:00 mods/',
  '-rw-r--r-- 0/0 12 2026-11-01 10:00 mods/geldar.jar',
  '-rw-r--r-- 0/0 30 2026-11-01 10:00 .geldar-bundle.sha256',
];
const STUB_SCRIPTS: Record<string, string> = {
  // Logs the call. info, ps and config answer from the environment; everything else succeeds.
  docker: [
    '#!/bin/sh',
    'echo "docker $*" >>"$STUB_LOG"',
    'case "$1" in',
    '  ps) printf "%s\\n" "$DOCKER_LABELS"; exit 0 ;;',
    '  volume) exit "${VOLUME_MISSING:-0}" ;;',
    '  network) exit "${NETWORK_MISSING:-0}" ;;',
    '  run)',
    '    case "$*" in',
    '      *"ls -A"*) printf "%s\\n" "$VOLUME_CONTENT"; exit 0 ;;',
    '      *"sha256sum -c"*) exit "${MARKER_STATUS:-0}" ;;',
    '    esac',
    '    exit 0 ;;',
    'esac',
    'exit 0',
  ].join('\n'),
  // The archive listings come from fixture files (names, and names with types), so no test depends on the host tar.
  tar: [
    '#!/bin/sh',
    'echo "tar $*" >>"$STUB_LOG"',
    'case "$*" in',
    '  *-tzvf*) cat "$TAR_VERBOSE" ;;',
    '  *-tzf*) cat "$TAR_NAMES" ;;',
    '  *) exit 0 ;;',
    'esac',
  ].join('\n'),
  ss: [
    '#!/bin/sh',
    'if [ "$SS_BUSY" = 1 ]; then echo "LISTEN 0 4096 127.0.0.1:46565 0.0.0.0:*"; fi',
    'exit 0',
  ].join('\n'),
  free: ['#!/bin/sh', 'printf "Mem: 1 1 1 1 1 %s\\n" "$FREE_KB"'].join('\n'),
  df: [
    '#!/bin/sh',
    'printf "Filesystem 1024-blocks Used Available Capacity Mounted\\n"',
    'printf "fixture 1 1 %s 1%% /\\n" "$DISK_KB"',
  ].join('\n'),
  stat: [
    '#!/bin/sh',
    'case "$*" in',
    '  *%a*) echo "$STAT_MODE" ;;',
    '  *%u*) echo "$STAT_UID" ;;',
    'esac',
  ].join('\n'),
};

let made: string[] = [];

// A fixture tree: the script and compose/nf-live.yml, the eight secret files, the mod jar and the bundle list.
function makeRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), 'nf-deploy-'));
  made.push(repo);
  mkdirSync(join(repo, 'deploy'), { recursive: true });
  mkdirSync(join(repo, 'compose', 'secrets-nf'), { recursive: true });
  mkdirSync(join(repo, 'stubs'));
  mkdirSync(join(repo, 'bundle'));
  copyFileSync(SCRIPT_SRC, join(repo, 'deploy', 'nf-deploy.sh'));
  copyFileSync(HUMAN_LIB_SRC, join(repo, 'deploy', 'nf-human-lib.sh'));
  copyFileSync(resolve(DEPLOY, 'nf-rangers-lib.sh'), join(repo, 'deploy', 'nf-rangers-lib.sh'));
  copyFileSync(
    resolve(DEPLOY, 'nf-extra-mods-lib.sh'),
    join(repo, 'deploy', 'nf-extra-mods-lib.sh'),
  );
  writeFileSync(join(repo, 'compose', 'nf-live.yml'), NF_COMPOSE_TEXT);
  writeFileSync(join(repo, 'compose', 'nf-live-telemetry.yml'), NF_OVERLAY_TEXT);
  for (const f of SECRET_FILES)
    writeFileSync(join(repo, 'compose', 'secrets-nf', f), `${f} fixture\n`);
  writeFileSync(join(repo, 'mod.jar'), JAR_BYTES);
  writeFileSync(join(repo, 'bundle', '.geldar-bundle.sha256'), LIST_BYTES);
  for (const [name, body] of Object.entries(STUB_SCRIPTS)) {
    const path = join(repo, 'stubs', name);
    writeFileSync(path, `${body}\n`);
    chmodSync(path, 0o755);
  }
  writeFileSync(join(repo, 'calls.log'), '');
  writeFileSync(join(repo, 'bundle-tarball.tar.gz'), TARBALL_BYTES);
  writeListing(repo, GOOD_NAMES, GOOD_VERBOSE);
  return repo;
}

function envFor(repo: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const k of Object.keys(env)) {
    if (/^(PATH|GELDAR_PROJECT|GELDAR_COLO_COMPOSE|DEPLOY_DRY_RUN|NF_[A-Z_]+)$/i.test(k))
      delete env[k];
  }
  return {
    ...env,
    PATH: `${join(repo, 'stubs')}${delimiter}${process.env.PATH ?? ''}`,
    STUB_LOG: join(repo, 'calls.log'),
    NF_MOD_JAR_HOST: join(repo, 'mod.jar'),
    NF_MOD_SHA256: MOD_SHA,
    NF_BUNDLE_TARBALL: join(repo, 'bundle-tarball.tar.gz'),
    NF_BUNDLE_TARBALL_SHA256: TARBALL_SHA,
    TAR_NAMES: join(repo, 'archive-names.txt'),
    TAR_VERBOSE: join(repo, 'archive-verbose.txt'),
    VOLUME_MISSING: '0',
    VOLUME_CONTENT: '',
    MARKER_STATUS: '0',
    FREE_KB: '40000000',
    DISK_KB: '200000000',
    STAT_MODE: '600',
    STAT_UID: '1000',
    DOCKER_LABELS: '',
    SS_BUSY: '0',
    ...extra,
  };
}

function run(repo: string, args: string[], extra: Record<string, string> = {}, input = '') {
  const r = spawnSync('sh', [join(repo, 'deploy', 'nf-deploy.sh'), ...args], {
    env: envFor(repo, extra),
    encoding: 'utf8',
    input,
  });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

function calls(repo: string): string[] {
  return readFileSync(join(repo, 'calls.log'), 'utf8').split('\n').filter(Boolean);
}

// The compose calls only (the docker ps and info reads are not compose).
function composeCalls(repo: string): string[] {
  return calls(repo).filter((c) => c.startsWith('docker compose -p '));
}

afterEach(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
  made = [];
});

describe('nf-deploy.sh constants and the one compose file', () => {
  it('uses the constant project and file, and every compose call passes exactly those', () => {
    const repo = makeRepo();
    expect(SCRIPT_TEXT).toMatch(/^PROJECT=geldar-nf$/m);
    expect(SCRIPT_TEXT).toMatch(/^COMPOSE_FILE=\$ROOT\/compose\/nf-live\.yml$/m);
    // Every script line that runs docker compose (the version probe excepted) must be one of exactly two known
    // shapes, each present once: dc (every call; the overlays are prepended to "$@" by set -- inside dc) and probe_dc
    // (the probe overlay, one run). Any other compose line, or one without the project and file flags, fails here.
    const allowed = [
      'docker compose -p "$PROJECT" -f "$COMPOSE_FILE" "$@"',
      'docker compose -p "$PROJECT" -f "$COMPOSE_FILE" -f "$PROBE_FILE" --profile probe "$@"',
    ];
    // Each overlay is one guarded set -- in dc(): human (NF_HUMAN=on), then telemetry (on) or the explicit off (rollback).
    expect(SCRIPT_TEXT).toContain('if [ "$HUMAN" = 1 ]; then set -- -f "$HUMAN_FILE" "$@"; fi');
    expect(SCRIPT_TEXT).toContain(
      'if [ "$TELEMETRY" = 1 ]; then\n    set -- -f "$TELEMETRY_FILE" "$@"',
    );
    expect(SCRIPT_TEXT).toContain(
      'elif [ "$TELEMETRY_OFF" = 1 ]; then\n    set -- -f "$OFF_FILE" "$@"',
    );
    const composeLines = SCRIPT_TEXT.split('\n')
      .map((l) => l.trim())
      // Command position only: a die message that names "docker compose ps" is not a call.
      .filter(
        (l) =>
          /(^|[;&|(]|\$\()\s*docker compose\b/.test(l) && !l.includes('docker compose version'),
      );
    expect(composeLines.filter((l) => !allowed.includes(l))).toEqual([]);
    expect([...composeLines].sort()).toEqual([...allowed].sort());
    expect(run(repo, ['up'], {}).status).toBe(0);
    // The script's ROOT is a POSIX-style path under Git Bash, so the test checks the tokens, not the path text.
    for (const c of composeCalls(repo)) {
      const tokens = c.split(' ');
      expect(tokens.slice(0, 5)).toEqual(['docker', 'compose', '-p', 'geldar-nf', '-f']);
      expect(tokens[5]?.endsWith('nf-live.yml')).toBe(true);
      expect(tokens.filter((t) => t === '-f')).toHaveLength(1);
    }
  });

  it('never reads GELDAR_PROJECT or GELDAR_COLO_COMPOSE except to refuse them', () => {
    expect(SCRIPT_TEXT).not.toMatch(/\$\{?GELDAR_PROJECT[}:]?[^+]/);
    expect(SCRIPT_TEXT).not.toMatch(/\$\{?GELDAR_COLO_COMPOSE[}:]?[^+]/);
    expect(SCRIPT_TEXT).not.toMatch(/\bsudo\b/);
  });
});

describe('nf-deploy.sh refusals', () => {
  it('refuses when GELDAR_PROJECT is set, even to an empty value', () => {
    const repo = makeRepo();
    const r = run(repo, ['plan'], { GELDAR_PROJECT: 'geldar-colo' });
    expect(r.status).toBe(1);
    expect(r.out).toContain('GELDAR_PROJECT is set');
    expect(run(repo, ['plan'], { GELDAR_PROJECT: '' }).status).toBe(1);
    expect(calls(repo)).toEqual([]);
  });

  it('refuses when GELDAR_COLO_COMPOSE is set', () => {
    const repo = makeRepo();
    const r = run(repo, ['up'], { GELDAR_COLO_COMPOSE: '/x/compose/colo.yml' });
    expect(r.status).toBe(1);
    expect(r.out).toContain('GELDAR_COLO_COMPOSE is set');
    expect(calls(repo)).toEqual([]);
  });

  it('refuses a git checkout unless --local, and runs there with --local', () => {
    const repo = makeRepo();
    writeFileSync(join(repo, '.git'), 'gitdir: fixture\n');
    const refused = run(repo, ['plan']);
    expect(refused.status).toBe(1);
    expect(refused.out).toContain('git checkout');
    expect(run(repo, ['plan', '--local']).status).toBe(0);
  });

  it('refuses a missing secret file, and names the file', () => {
    const repo = makeRepo();
    rmSync(join(repo, 'compose', 'secrets-nf', 'nats-sink.txt'));
    const r = run(repo, ['up']);
    expect(r.status).toBe(1);
    expect(r.out).toContain('secret file missing: nats-sink.txt');
    expect(composeCalls(repo)).toEqual([]);
  });

  it('refuses a secret file with a mode other than 0600 or 0400', () => {
    const repo = makeRepo();
    const r = run(repo, ['up'], { STAT_MODE: '644' });
    expect(r.status).toBe(1);
    expect(r.out).toContain('has mode 644');
  });

  it('refuses a secret file owned by another uid', () => {
    const repo = makeRepo();
    const r = run(repo, ['up'], { STAT_UID: '0' });
    expect(r.status).toBe(1);
    expect(r.out).toContain('owned by uid 0');
  });

  it('refuses a mod jar whose sha256 does not match NF_MOD_SHA256', () => {
    const repo = makeRepo();
    const r = run(repo, ['up'], { NF_MOD_SHA256: '0'.repeat(64) });
    expect(r.status).toBe(1);
    expect(r.out).toContain('does not match NF_MOD_SHA256');
    expect(composeCalls(repo)).toEqual([]);
  });

  it('a bundle list sha256 that does not match is no gate for up (the seeded volume marker is)', () => {
    const repo = makeRepo();
    // The bundle directory gate is gone (the seeded volume's marker is the gate): a wrong bundle sha no longer stops up.
    const r = run(repo, ['up'], { NF_BUNDLE_SHA256: '1'.repeat(64) });
    expect(r.status).toBe(0);
    expect(r.out).not.toContain('bundle list');
  });

  it('refuses low free RAM (below the caps plus the margin)', () => {
    const repo = makeRepo();
    // 16640 MiB caps + 8192 MiB margin = 24832 MiB; 24831 MiB is one short.
    const r = run(repo, ['up'], { FREE_KB: String(24831 * 1024) });
    expect(r.status).toBe(1);
    expect(r.out).toContain('free RAM 24831 MiB is below 24832 MiB');
    expect(run(repo, ['plan'], { FREE_KB: String(24832 * 1024) }).status).toBe(0);
  });

  it('refuses low free disk (below the floor)', () => {
    const repo = makeRepo();
    const r = run(repo, ['up'], { DISK_KB: '52428799' });
    expect(r.status).toBe(1);
    expect(r.out).toContain('below the floor');
  });

  it('refuses when something already listens on 46565', () => {
    const repo = makeRepo();
    const r = run(repo, ['up'], { SS_BUSY: '1' });
    expect(r.status).toBe(1);
    expect(r.out).toContain('already listens on port 46565');
    expect(composeCalls(repo)).toEqual([]);
  });

  it('refuses up when a geldar-nf container carries a geldar-colo label', () => {
    const repo = makeRepo();
    const labels = 'com.docker.compose.project=geldar-nf,com.geldar.stack=colo';
    const r = run(repo, ['up'], { DOCKER_LABELS: labels });
    expect(r.status).toBe(1);
    expect(r.out).toContain('geldar-colo label');
    expect(composeCalls(repo)).toEqual([]);
  });

  it('refuses down when a geldar-nf container carries a geldar-colo label', () => {
    const repo = makeRepo();
    const r = run(repo, ['down'], { DOCKER_LABELS: 'com.docker.compose.project=geldar-colo' });
    expect(r.status).toBe(1);
    expect(composeCalls(repo)).toEqual([]);
  });
});

describe('nf-deploy.sh verbs', () => {
  it('plan runs only read-only docker calls and changes nothing', () => {
    const repo = makeRepo();
    expect(run(repo, ['plan']).out).toContain('all gates passed');
    const verbs = composeCalls(repo).map((c) => c.split(' ').slice(6).join(' '));
    expect(verbs).toEqual(['config --quiet']);
    for (const c of calls(repo)) {
      expect(/\b(up|down|run|stop|rm|restart|start|pull|build)\b/.test(c)).toBe(false);
    }
  });

  it('up runs nats and postgres, then the identity-seed one-shot, then the rest, then velocity', () => {
    const repo = makeRepo();
    const r = run(repo, ['up']);
    expect(r.out).toContain('started');
    const verbs = composeCalls(repo).map((c) => c.split(' ').slice(6).join(' '));
    const order = [
      'config --quiet',
      'up -d --wait nats postgres',
      'up --no-deps --exit-code-from identity-seed identity-seed',
      'up -d --wait eventsink neoforge',
      'up -d --wait velocity',
    ];
    expect(verbs).toEqual(order);
    expect(verbs.join('\n')).not.toMatch(/golem-body|players-host/);
  });

  it('DEPLOY_DRY_RUN=1 up prints the steps and runs none of them', () => {
    const repo = makeRepo();
    const r = run(repo, ['up'], { DEPLOY_DRY_RUN: '1' });
    expect(r.out).toContain('dry-run, not run');
    expect(r.out).toContain('dry-run, not run: dc up -d --wait nats postgres');
    expect(composeCalls(repo).map((c) => c.split(' ').slice(6).join(' '))).toEqual([
      'config --quiet',
    ]);
  });

  it('down removes the project without volumes, and the label filter is the exact project', () => {
    const repo = makeRepo();
    expect(run(repo, ['down']).status).toBe(0);
    const verbs = composeCalls(repo).map((c) => c.split(' ').slice(6).join(' '));
    expect(verbs).toEqual(['down']);
    expect(calls(repo).some((c) => c.includes('label=com.docker.compose.project=geldar-nf'))).toBe(
      true,
    );
  });

  it('down --volumes needs the typed project name', () => {
    const repo = makeRepo();
    const none = run(repo, ['down', '--volumes'], {}, '');
    expect(none.status).toBe(1);
    expect(none.out).toContain('did not match geldar-nf');
    const wrong = run(repo, ['down', '--volumes'], {}, 'geldar-colo\n');
    expect(wrong.status).toBe(1);
    expect(composeCalls(repo)).toEqual([]);
    const typed = run(repo, ['down', '--volumes'], {}, 'geldar-nf\n');
    expect(typed.status).toBe(0);
    expect(composeCalls(repo).map((c) => c.split(' ').slice(6).join(' '))).toEqual([
      'down --volumes',
    ]);
  });

  it('--volumes is refused for any verb but down', () => {
    const repo = makeRepo();
    expect(run(repo, ['up', '--volumes']).status).toBe(1);
    expect(composeCalls(repo)).toEqual([]);
  });

  it('logs goes through the project and accepts only a known service', () => {
    const repo = makeRepo();
    expect(run(repo, ['logs', 'velocity']).status).toBe(0);
    expect(composeCalls(repo).map((c) => c.split(' ').slice(6).join(' '))).toEqual([
      'logs --tail 200 velocity',
    ]);
    expect(run(repo, ['logs', 'golem-body']).status).toBe(1);
    expect(run(repo, ['logs', 'players-host']).status).toBe(1);
    expect(run(repo, ['logs']).status).toBe(1);
  });

  it('status is read-only (compose ps)', () => {
    const repo = makeRepo();
    expect(run(repo, ['status']).status).toBe(0);
    expect(composeCalls(repo).map((c) => c.split(' ').slice(6).join(' '))).toEqual(['ps -a']);
  });
});

// The archive listing the tar stub prints: names (tar -tzf) and names with entry types (tar -tzvf).
function writeListing(repo: string, names: string[], verbose: string[]): void {
  writeFileSync(join(repo, 'archive-names.txt'), `${names.join('\n')}\n`);
  writeFileSync(join(repo, 'archive-verbose.txt'), `${verbose.join('\n')}\n`);
}

// The extract call: the one docker run that unpacks the tarball.
function extractCalls(repo: string): string[] {
  return calls(repo).filter((c) => c.includes('tar -xzf'));
}

const NEOFORGE_IMAGE =
  /^ {2}neoforge:\n(?:(?! {2}\S).*\n)*? {4}image: (\S+)$/m.exec(NF_COMPOSE_TEXT)?.[1] ?? '';

describe('nf-deploy.sh seed-bundle', () => {
  it('takes the neoforge image from compose/nf-live.yml, and names the volume as compose does', () => {
    expect(NEOFORGE_IMAGE).toMatch(/^itzg\/minecraft-server:[^@]+@sha256:[0-9a-f]{64}$/);
    expect(SCRIPT_TEXT).not.toContain(NEOFORGE_IMAGE);
    expect(NF_COMPOSE_TEXT).toMatch(/^ {2}neoforge-data: \{\}$/m);
    expect(NF_COMPOSE_TEXT).not.toContain('name: geldar-nf_neoforge-data');
    expect(SCRIPT_TEXT).not.toMatch(/\bsudo\b/);
  });

  it('refuses a seeded volume and never extracts into it', () => {
    const repo = makeRepo();
    const r = run(repo, ['seed-bundle'], { VOLUME_CONTENT: 'server.properties' });
    expect(r.status).toBe(1);
    expect(r.out).toContain('is not empty');
    expect(extractCalls(repo)).toEqual([]);
  });

  it('extracts into a volume that is absent or empty', () => {
    const empty = makeRepo();
    expect(run(empty, ['seed-bundle']).status).toBe(0);
    expect(extractCalls(empty)).toHaveLength(1);
    const absent = makeRepo();
    expect(run(absent, ['seed-bundle'], { VOLUME_MISSING: '1' }).status).toBe(0);
    expect(extractCalls(absent)).toHaveLength(1);
  });

  it('refuses a bad or malformed tarball sha256 before any extract', () => {
    const repo = makeRepo();
    expect(run(repo, ['seed-bundle'], { NF_BUNDLE_TARBALL_SHA256: 'f'.repeat(64) }).status).toBe(1);
    expect(run(repo, ['seed-bundle'], { NF_BUNDLE_TARBALL_SHA256: 'ABC' }).status).toBe(1);
    expect(extractCalls(repo)).toEqual([]);
  });

  it('refuses a relative or missing tarball path before any extract', () => {
    const repo = makeRepo();
    const rel = run(repo, ['seed-bundle'], { NF_BUNDLE_TARBALL: 'bundle-tarball.tar.gz' });
    expect(rel.status).toBe(1);
    expect(rel.out).toContain('absolute path');
    const missing = run(repo, ['seed-bundle'], { NF_BUNDLE_TARBALL: join(repo, 'nope.tar.gz') });
    expect(missing.status).toBe(1);
    expect(extractCalls(repo)).toEqual([]);
  });

  it('refuses an archive with an absolute, ../ or link entry, or no marker, before any extract', () => {
    const bad: Array<[string[], string[]]> = [
      [
        [...GOOD_NAMES, '/etc/passwd'],
        [...GOOD_VERBOSE, '-rw-r--r-- 0/0 1 2026-11-01 10:00 /etc/passwd'],
      ],
      [
        [...GOOD_NAMES, 'mods/../../x'],
        [...GOOD_VERBOSE, '-rw-r--r-- 0/0 1 2026-11-01 10:00 mods/../../x'],
      ],
      [
        [...GOOD_NAMES, 'libraries/a'],
        [...GOOD_VERBOSE, 'lrwxrwxrwx 0/0 0 2026-11-01 10:00 libraries/a -> /etc'],
      ],
      [
        [...GOOD_NAMES, 'mods/b'],
        [...GOOD_VERBOSE, 'hrw-r--r-- 0/0 0 2026-11-01 10:00 mods/b link to mods/geldar.jar'],
      ],
      [['mods/geldar.jar'], ['-rw-r--r-- 0/0 12 2026-11-01 10:00 mods/geldar.jar']],
    ];
    for (const [names, verbose] of bad) {
      const repo = makeRepo();
      writeListing(repo, names, verbose);
      expect(run(repo, ['seed-bundle']).status).toBe(1);
      expect(extractCalls(repo)).toEqual([]);
    }
  });

  it('extracts with --network none, the tarball read-only, --rm, root only in the container, the pinned image', () => {
    const repo = makeRepo();
    expect(run(repo, ['seed-bundle'], { NF_SERVICE_UID: '1001' }).status).toBe(0);
    const [extract] = extractCalls(repo);
    expect(extract).toContain('docker run --rm --network none --user 0 ');
    expect(extract).toMatch(/--mount type=bind,source=\S+,target=\/in\/bundle\.tar\.gz,readonly /);
    // The extract keeps only the three capabilities tar and chown need, and gains no privileges.
    expect(extract).toContain(
      '--user 0 --cap-drop ALL --cap-add CHOWN --cap-add FOWNER --cap-add DAC_OVERRIDE --security-opt no-new-privileges --mount ',
    );
    expect(extract).toContain(
      `--entrypoint /bin/sh ${NEOFORGE_IMAGE} -c tar -xzf /in/bundle.tar.gz -C /data && chown -R 1001:1001 /data && chmod -R u+rwX,go-w /data`,
    );
    expect(extract).not.toContain('--reference');
    expect(extract).not.toMatch(/chown -R 1000:/);
    for (const c of calls(repo).filter((c) => c.startsWith('docker run '))) {
      expect(c).toContain('--network none');
    }
  });

  it('touches only the geldar-nf neoforge-data volume, and never prunes or removes a volume', () => {
    const repo = makeRepo();
    run(repo, ['seed-bundle']);
    run(repo, ['up']);
    run(repo, ['down', '--volumes'], {}, 'geldar-nf\n');
    const volumeCalls = calls(repo).filter((c) => /docker (volume|run) /.test(c));
    expect(volumeCalls.length).toBeGreaterThan(0);
    for (const c of calls(repo)) {
      expect(c).not.toMatch(/prune|volume rm|volume remove/);
      for (const v of c.matchAll(/-v ([^:\s]+):/g)) expect(v[1]).toBe('geldar-nf_neoforge-data');
    }
    expect(volumeCalls.some((c) => c.includes('volume inspect geldar-nf_neoforge-data'))).toBe(
      true,
    );
  });

  it('DEPLOY_DRY_RUN=1 names the extract and runs none of it', () => {
    const repo = makeRepo();
    const r = run(repo, ['seed-bundle'], { DEPLOY_DRY_RUN: '1' });
    expect(r.status).toBe(0);
    expect(r.out).toContain('dry-run, not run: docker run --rm --network none --user 0');
    expect(extractCalls(repo)).toEqual([]);
  });

  it('a marker that does not verify after the extract fails closed', () => {
    const repo = makeRepo();
    const r = run(repo, ['seed-bundle'], { MARKER_STATUS: '1' });
    expect(r.status).toBe(1);
    expect(r.out).toContain('marker check');
  });

  it('up refuses an unseeded volume and names seed-bundle; plan does not check the volume', () => {
    const absent = makeRepo();
    const r = run(absent, ['up'], { VOLUME_MISSING: '1' });
    expect(r.status).toBe(1);
    expect(r.out).toContain('seed-bundle');
    expect(composeCalls(absent).map((c) => c.split(' ').slice(6).join(' '))).toEqual([
      'config --quiet',
    ]);
    const badMarker = makeRepo();
    expect(run(badMarker, ['up'], { MARKER_STATUS: '1' }).out).toContain('seed-bundle');
    expect(run(makeRepo(), ['plan'], { VOLUME_MISSING: '1', MARKER_STATUS: '1' }).status).toBe(0);
  });

  it('up passes the seed check when the marker verifies', () => {
    const repo = makeRepo();
    expect(run(repo, ['up']).status).toBe(0);
    expect(calls(repo).some((c) => c.includes('sha256sum -c --strict'))).toBe(true);
  });

  it('runs the marker check as the same uid:gid that seed-bundle chowned the volume to', () => {
    const repo = makeRepo();
    expect(run(repo, ['seed-bundle'], { NF_SERVICE_UID: '1001' }).status).toBe(0);
    const markers = calls(repo).filter((c) => c.includes('sha256sum -c --strict'));
    expect(markers).toHaveLength(1);
    expect(markers[0]).toContain('--user 1001:1001 ');
    expect(markers[0]).not.toContain('--user 1000');
  });

  it('lists the volume as root, so a half-seeded /data the service uid cannot read is still listed', () => {
    const repo = makeRepo();
    expect(run(repo, ['seed-bundle'], { NF_SERVICE_UID: '1001' }).status).toBe(0);
    const listings = calls(repo).filter((c) => c.includes('ls -A /data'));
    expect(listings).toHaveLength(1);
    expect(listings[0]).toContain('--user 0 ');
    expect(listings[0]).not.toContain('--user 1001');
  });

  it('checks the marker as uid:gid at gid 1002 on seed-bundle and on up, never uid:uid', () => {
    const seeded = makeRepo();
    const extract = run(seeded, ['seed-bundle'], {
      NF_SERVICE_UID: '1001',
      NF_SERVICE_GID: '1002',
    });
    expect(extract.status, extract.out).toBe(0);
    const seedMarkers = calls(seeded).filter((c) => c.includes('sha256sum -c --strict'));
    expect(seedMarkers).toHaveLength(1);
    expect(seedMarkers[0]).toContain('--user 1001:1002 ');
    expect(seedMarkers[0]).not.toContain('--user 1001:1001 ');
    const upRepo = makeRepo();
    const up = run(upRepo, ['up'], {
      NF_SERVICE_UID: '1001',
      NF_SERVICE_GID: '1002',
      STAT_UID: '1001',
    });
    expect(up.status, up.out).toBe(0);
    const upMarkers = calls(upRepo).filter((c) => c.includes('sha256sum -c --strict'));
    expect(upMarkers).toHaveLength(1);
    expect(upMarkers[0]).toContain('--user 1001:1002 ');
    expect(upMarkers[0]).not.toContain('--user 1001:1001 ');
  });

  it('takes NF_SERVICE_GID separately, and refuses a non-numeric or root gid', () => {
    const repo = makeRepo();
    expect(
      run(repo, ['seed-bundle'], { NF_SERVICE_UID: '1001', NF_SERVICE_GID: '1002' }).status,
    ).toBe(0);
    expect(extractCalls(repo)[0]).toContain('chown -R 1001:1002 /data');
    expect(run(makeRepo(), ['plan'], { NF_SERVICE_GID: 'x' }).status).toBe(1);
    expect(run(makeRepo(), ['plan'], { NF_SERVICE_GID: '0' }).status).toBe(1);
  });

  it('plan and up need no bundle directory (the volume marker is the gate)', () => {
    const planRepo = makeRepo();
    const plan = run(planRepo, ['plan'], {
      NF_BUNDLE_DIR: join(planRepo, 'no-such-bundle-dir'),
      NF_BUNDLE_SHA256: 'f'.repeat(64),
    });
    expect(plan.status).toBe(0);
    expect(plan.out).not.toContain('NF_BUNDLE_DIR');
    const upRepo = makeRepo();
    const up = run(upRepo, ['up'], { NF_BUNDLE_DIR: join(upRepo, 'no-such-bundle-dir') });
    expect(up.status).toBe(0);
    expect(up.out).not.toContain('NF_BUNDLE_DIR');
  });
});

describe('nf-deploy.sh secret list', () => {
  it('keeps its secret file list in sync with the secrets block of compose/nf-live.yml', () => {
    // The declared set is nf-live.yml's secrets block plus the probe overlay's (nats-body.txt, mounted only by the probe) plus
    // the rangers overlay's (the four ranger files, mounted only with NF_RANGERS=on). SECRET_FILES lists the base set and
    // RANGER_SECRETS the four ranger files (required only with NF_RANGERS=on); together they are the union.
    const probeText = readFileSync(join(ROOT, 'compose', 'nf-live-probe.yml'), 'utf8');
    const rangersText = readFileSync(join(ROOT, 'compose', 'nf-live-rangers.yml'), 'utf8');
    const declared = [
      ...`${NF_COMPOSE_TEXT}\n${probeText}\n${rangersText}`.matchAll(
        /\$\{NF_SECRETS_DIR:-\.\/secrets-nf\}\/(\S+)$/gm,
      ),
    ].map((m) => m[1]);
    const declaredSet = new Set(declared);
    const listed = [...SECRET_FILES, ...RANGER_SECRETS];
    const missing = [...declaredSet].filter((name) => !listed.includes(name)).sort();
    const extra = listed.filter((name) => !declaredSet.has(name)).sort();
    expect({ missing, extra }).toEqual({ missing: [], extra: [] });
    expect([...listed].sort()).toEqual([...declaredSet].sort());
    expect(new Set(listed).size).toBe(listed.length);
    expect(RANGER_SECRETS.filter((name) => SECRET_FILES.includes(name))).toEqual([]);
  });
});
