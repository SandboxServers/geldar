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
const SCRIPT_TEXT = readFileSync(SCRIPT_SRC, 'utf8');
const NF_COMPOSE_TEXT = readFileSync(resolve(ROOT, 'compose', 'nf-live.yml'), 'utf8');
const SECRET_FILES = /^SECRET_FILES="([^"]+)"$/m.exec(SCRIPT_TEXT)?.[1].split(' ') ?? [];
const JAR_BYTES = 'geldar neoforge mod fixture\n';
const LIST_BYTES = 'bundle list fixture\n';
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const MOD_SHA = sha(JAR_BYTES);
const BUNDLE_SHA = sha(LIST_BYTES);
const STUB_SCRIPTS: Record<string, string> = {
  // Logs the call. info, ps and config answer from the environment; everything else succeeds.
  docker: [
    '#!/bin/sh',
    'echo "docker $*" >>"$STUB_LOG"',
    'case "$1" in',
    '  ps) printf "%s\\n" "$DOCKER_LABELS"; exit 0 ;;',
    'esac',
    'exit 0',
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
  writeFileSync(join(repo, 'compose', 'nf-live.yml'), NF_COMPOSE_TEXT);
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
    NF_BUNDLE_DIR: join(repo, 'bundle'),
    NF_BUNDLE_SHA256: BUNDLE_SHA,
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
    // Exactly one line in the script passes -f to compose: the dc wrapper, with the project and the one file.
    const composeFileLines = SCRIPT_TEXT.split('\n').filter(
      (l) => l.includes('docker compose') && l.includes(' -f'),
    );
    expect(composeFileLines).toEqual(['  docker compose -p "$PROJECT" -f "$COMPOSE_FILE" "$@"']);
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

  it('refuses a bundle whose list sha256 does not match NF_BUNDLE_SHA256', () => {
    const repo = makeRepo();
    const r = run(repo, ['up'], { NF_BUNDLE_SHA256: '1'.repeat(64) });
    expect(r.status).toBe(1);
    expect(r.out).toContain('bundle list does not match');
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

describe('nf-deploy.sh secret list', () => {
  it('keeps its secret file list in sync with the secrets block of compose/nf-live.yml', () => {
    const declared = [
      ...NF_COMPOSE_TEXT.matchAll(/\$\{NF_SECRETS_DIR:-\.\/secrets-nf\}\/(\S+)$/gm),
    ].map((m) => m[1]);
    const declaredSet = new Set(declared);
    const missing = [...declaredSet].filter((name) => !SECRET_FILES.includes(name)).sort();
    const extra = SECRET_FILES.filter((name) => !declaredSet.has(name)).sort();
    expect({ missing, extra }).toEqual({ missing: [], extra: [] });
    expect([...SECRET_FILES].sort()).toEqual([...declaredSet].sort());
    expect(new Set(SECRET_FILES).size).toBe(SECRET_FILES.length);
  });
});
