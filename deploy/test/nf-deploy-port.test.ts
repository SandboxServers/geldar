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

// Each case runs the shell script through sh, which is slow on Windows and under load: the file's tests get an explicit 30 s
// timeout (the vitest default is 5 s).
vi.setConfig({ testTimeout: 30000 });

// The port gate of deploy/nf-deploy.sh: 127.0.0.1:46565 may be held by the project's own velocity container (plan and up
// pass); any other listener refuses. Stub docker, ss, free, df, stat and tar sit first on PATH and log every docker call.
// Nothing is started. (The other nf-deploy tests are in nf-deploy.test.ts and nf-deploy-telemetry.test.ts.)
const DEPLOY = fileURLToPath(new URL('..', import.meta.url));
const ROOT = resolve(DEPLOY, '..');
const SCRIPT_SRC = resolve(DEPLOY, 'nf-deploy.sh');
const HUMAN_LIB_SRC = resolve(DEPLOY, 'nf-human-lib.sh');
const SCRIPT_TEXT = readFileSync(SCRIPT_SRC, 'utf8');
const NF_COMPOSE_TEXT = readFileSync(resolve(ROOT, 'compose', 'nf-live.yml'), 'utf8');
const NF_OVERLAY_TEXT = readFileSync(resolve(ROOT, 'compose', 'nf-live-telemetry.yml'), 'utf8');
const SECRET_FILES = /^SECRET_FILES="([^"]+)"$/m.exec(SCRIPT_TEXT)?.[1].split(' ') ?? [];
const JAR_BYTES = 'geldar neoforge mod fixture\n';
const TARBALL_BYTES = 'bundle tarball fixture\n';
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const MOD_SHA = sha(JAR_BYTES);
const TARBALL_SHA = sha(TARBALL_BYTES);
const GOOD_NAMES = ['mods/', 'mods/geldar.jar', '.geldar-bundle.sha256'];
const GOOD_VERBOSE = [
  'drwxr-xr-x 0/0 0 2026-11-01 10:00 mods/',
  '-rw-r--r-- 0/0 12 2026-11-01 10:00 mods/geldar.jar',
  '-rw-r--r-- 0/0 30 2026-11-01 10:00 .geldar-bundle.sha256',
];
// The one listener socket of a project velocity published on loopback only (ss -Hltn columns: state, recv, send, local, peer).
const LISTEN_LOOPBACK = 'LISTEN 0 4096 127.0.0.1:46565 0.0.0.0:*';
// A `docker ps --format` row: project label, service label, Ports. The real velocity lists its EXPOSE 25577/tcp (no "->")
// before the one published mapping, so the Ports field has two comma-separated tokens.
const OWN_ROW = 'geldar-nf|velocity|25577/tcp, 127.0.0.1:46565->25565/tcp';
const PUBLISHED_ONLY_ROW = 'geldar-nf|velocity|127.0.0.1:46565->25565/tcp';
// The real `docker ps` output for the project: one row per container (five), each with its own Ports text. Only the velocity
// row publishes 46565; the eventsink row has no published or exposed port (an empty Ports field).
const PROJECT_ROWS = [
  'geldar-nf|velocity|25577/tcp, 127.0.0.1:46565->25565/tcp',
  'geldar-nf|neoforge|25565/tcp, 25575/tcp',
  'geldar-nf|eventsink|',
  'geldar-nf|postgres|5432/tcp',
  'geldar-nf|nats|4222/tcp, 6222/tcp, 8222/tcp',
];
const FIVE_ROWS = PROJECT_ROWS.join('\n');
const STUB_SCRIPTS: Record<string, string> = {
  // ps with the port format (it names the service label) answers from PS_ROWS, or fails with PS_EXIT. Other ps calls answer
  // from DOCKER_LABELS (the colo check). Everything else succeeds.
  docker: [
    '#!/bin/sh',
    'echo "docker $*" >>"$STUB_LOG"',
    'case "$1" in',
    '  ps)',
    '    case "$*" in',
    '      *com.docker.compose.service*) if [ "${PS_EXIT:-0}" != 0 ]; then exit "$PS_EXIT"; fi; printf "%s\\n" "$PS_ROWS"; exit 0 ;;',
    '    esac',
    '    printf "%s\\n" "$DOCKER_LABELS"; exit 0 ;;',
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
  tar: [
    '#!/bin/sh',
    'echo "tar $*" >>"$STUB_LOG"',
    'case "$*" in',
    '  *-tzvf*) cat "$TAR_VERBOSE" ;;',
    '  *-tzf*) cat "$TAR_NAMES" ;;',
    '  *) exit 0 ;;',
    'esac',
  ].join('\n'),
  ss: ['#!/bin/sh', 'if [ "$SS_BUSY" = 1 ]; then printf "%s\\n" "$SS_LINES"; fi', 'exit 0'].join(
    '\n',
  ),
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

// A fixture tree: the script and the compose files, the secret files, the mod jar, the bundle tarball and its listing.
function makeRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), 'nf-deploy-port-'));
  made.push(repo);
  mkdirSync(join(repo, 'deploy'), { recursive: true });
  mkdirSync(join(repo, 'compose', 'secrets-nf'), { recursive: true });
  mkdirSync(join(repo, 'stubs'));
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
  for (const [name, body] of Object.entries(STUB_SCRIPTS)) {
    const path = join(repo, 'stubs', name);
    writeFileSync(path, `${body}\n`);
    chmodSync(path, 0o755);
  }
  writeFileSync(join(repo, 'calls.log'), '');
  writeFileSync(join(repo, 'bundle-tarball.tar.gz'), TARBALL_BYTES);
  writeFileSync(join(repo, 'archive-names.txt'), `${GOOD_NAMES.join('\n')}\n`);
  writeFileSync(join(repo, 'archive-verbose.txt'), `${GOOD_VERBOSE.join('\n')}\n`);
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
    SS_LINES: LISTEN_LOOPBACK,
    PS_ROWS: '',
    PS_EXIT: '0',
    ...extra,
  };
}

function run(repo: string, args: string[], extra: Record<string, string> = {}) {
  const r = spawnSync('sh', [join(repo, 'deploy', 'nf-deploy.sh'), ...args], {
    env: envFor(repo, extra),
    encoding: 'utf8',
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

describe("nf-deploy.sh port gate: the project's own velocity may hold 127.0.0.1:46565", () => {
  it('plan and up pass when geldar-nf velocity publishes exactly 127.0.0.1:46565 and holds the port', () => {
    const repo = makeRepo();
    const env = { SS_BUSY: '1', PS_ROWS: OWN_ROW };
    const plan = run(repo, ['plan'], env);
    expect(plan.status).toBe(0);
    expect(plan.out).toContain('all gates passed');
    expect(calls(repo).some((c) => c.includes('com.docker.compose.service'))).toBe(true);
    expect(run(repo, ['up'], env).status).toBe(0);
    expect(composeCalls(repo).length).toBeGreaterThan(0);
  });

  it('plan and up pass with the five real project rows when exactly one velocity row publishes 46565', () => {
    const repo = makeRepo();
    const env = { SS_BUSY: '1', PS_ROWS: FIVE_ROWS };
    expect(run(repo, ['plan'], env).status).toBe(0);
    expect(run(repo, ['up'], env).status).toBe(0);
  });

  it('a free port still passes with no container (the gate is only consulted once a listener exists)', () => {
    const repo = makeRepo();
    expect(run(repo, ['plan']).status).toBe(0);
  });

  const refusals: [string, string, Record<string, string>][] = [
    ['another project (colo) on the port', 'geldar-colo|velocity|127.0.0.1:46565->25565/tcp', {}],
    ['another project (scratch) on the port', 'scratch|velocity|127.0.0.1:46565->25565/tcp', {}],
    [
      'a geldar-nf container that is not velocity',
      'geldar-nf|neoforge|127.0.0.1:46565->25565/tcp',
      {},
    ],
    ['the right labels published on 0.0.0.0', 'geldar-nf|velocity|0.0.0.0:46565->25565/tcp', {}],
    ['the right labels published on [::]', 'geldar-nf|velocity|[::]:46565->25565/tcp', {}],
    [
      'the own binding plus a second 0.0.0.0 binding',
      'geldar-nf|velocity|127.0.0.1:46565->25565/tcp, 0.0.0.0:46565->25565/tcp',
      {},
    ],
    ['a host process (no container owns the port)', '', {}],
    [
      'a second published mapping on loopback',
      'geldar-nf|velocity|127.0.0.1:46565->25565/tcp, 127.0.0.1:46566->25566/tcp',
      {},
    ],
    [
      '0.0.0.0 published after an exposed port',
      'geldar-nf|velocity|25577/tcp, 0.0.0.0:46565->25565/tcp',
      {},
    ],
    [
      '[::] published after an exposed port',
      'geldar-nf|velocity|25577/tcp, [::]:46565->25565/tcp',
      {},
    ],
    ['only exposed ports with the listener', 'geldar-nf|velocity|25577/tcp', {}],
    ['the own row listed twice (two containers)', `${OWN_ROW}\n${OWN_ROW}`, {}],
    ['a docker ps failure', OWN_ROW, { PS_EXIT: '1' }],
    ['docker output that does not parse', 'not a container line', {}],
    ['the label value geldar-nf-evil', 'geldar-nf-evil|velocity|127.0.0.1:46565->25565/tcp', {}],
    ['the label value geldar-nf2', 'geldar-nf2|velocity|127.0.0.1:46565->25565/tcp', {}],
    [
      'the own row plus a second listener socket on [::1]',
      OWN_ROW,
      { SS_LINES: `${LISTEN_LOOPBACK}\nLISTEN 0 4096 [::1]:46565 [::]:*` },
    ],
    [
      'the own row but the listener is on 0.0.0.0',
      OWN_ROW,
      { SS_LINES: 'LISTEN 0 4096 0.0.0.0:46565 0.0.0.0:*' },
    ],
  ];

  it.each(refusals)(
    'refuses %s, for plan and up, and runs no compose call',
    (_label, rows, extra) => {
      const repo = makeRepo();
      const env = { SS_BUSY: '1', PS_ROWS: rows, ...extra };
      for (const verb of ['plan', 'up']) {
        const r = run(repo, [verb], env);
        expect(r.status).toBe(1);
        expect(r.out).toContain('already listens on port 46565');
      }
      expect(composeCalls(repo)).toEqual([]);
    },
  );

  const accepted: [string, string][] = [
    ['the real line (an exposed port before the published mapping)', OWN_ROW],
    [
      'an exposed port after the published mapping',
      'geldar-nf|velocity|127.0.0.1:46565->25565/tcp, 25577/tcp',
    ],
    [
      'two exposed ports around the published mapping',
      'geldar-nf|velocity|25577/tcp, 127.0.0.1:46565->25565/tcp, 25578/tcp',
    ],
    ['the published mapping alone', PUBLISHED_ONLY_ROW],
  ];

  it.each(accepted)('plan and up pass with %s', (_label, rows) => {
    const repo = makeRepo();
    const env = { SS_BUSY: '1', PS_ROWS: rows };
    for (const verb of ['plan', 'up']) expect(run(repo, [verb], env).status).toBe(0);
  });

  // Each refusal names the check that failed (the message keeps "already listens on port 46565" before it).
  const reasons: [string, string, Record<string, string>, string][] = [
    ['a host process (no row)', '', {}, 'no docker row'],
    ['the own row listed twice', `${OWN_ROW}\n${OWN_ROW}`, {}, 'more than one docker ps row'],
    [
      'two velocity rows among the five project rows',
      `${FIVE_ROWS}\ngeldar-nf|velocity|127.0.0.1:46565->25565/tcp`,
      {},
      'more than one docker ps row',
    ],
    [
      'the velocity of the five rows on 0.0.0.0',
      FIVE_ROWS.replace('127.0.0.1:46565->25565/tcp', '0.0.0.0:46565->25565/tcp'),
      {},
      'published mapping is not exactly 127.0.0.1:46565->25565/tcp: 0.0.0.0:46565->25565/tcp',
    ],
    [
      'five project rows with no velocity row',
      PROJECT_ROWS.slice(1).join('\n'),
      {},
      'wrong service',
    ],
    ['a docker ps failure', OWN_ROW, { PS_EXIT: '1' }, 'docker ps failed'],
    ['output that does not parse', 'not a container line', {}, 'docker output does not parse'],
    [
      'another project',
      'geldar-colo|velocity|127.0.0.1:46565->25565/tcp',
      {},
      'wrong compose project',
    ],
    ['another service', 'geldar-nf|neoforge|127.0.0.1:46565->25565/tcp', {}, 'wrong service'],
    ['only exposed ports', 'geldar-nf|velocity|25577/tcp', {}, 'unpublished only'],
    [
      'a published mapping on another port',
      'geldar-nf|velocity|25577/tcp, 127.0.0.1:46566->25566/tcp',
      {},
      'published mapping is not exactly 127.0.0.1:46565->25565/tcp: 127.0.0.1:46566->25566/tcp',
    ],
    [
      'a second published mapping',
      'geldar-nf|velocity|127.0.0.1:46565->25565/tcp, 127.0.0.1:46566->25566/tcp',
      {},
      'more than one published mapping',
    ],
    [
      '0.0.0.0 after an exposed port',
      'geldar-nf|velocity|25577/tcp, 0.0.0.0:46565->25565/tcp',
      {},
      'published mapping is not exactly 127.0.0.1:46565->25565/tcp: 0.0.0.0:46565->25565/tcp',
    ],
    [
      'the listener on 0.0.0.0',
      OWN_ROW,
      { SS_LINES: 'LISTEN 0 4096 0.0.0.0:46565 0.0.0.0:*' },
      'ss socket not 127.0.0.1:46565',
    ],
  ];

  it.each(reasons)('names the failed check when it refuses %s', (_label, rows, extra, reason) => {
    const repo = makeRepo();
    const r = run(repo, ['plan'], { SS_BUSY: '1', PS_ROWS: rows, ...extra });
    expect(r.status).toBe(1);
    expect(r.out).toContain('already listens on port 46565');
    expect(r.out).toContain(`own velocity check failed: ${reason}`);
  });
});
