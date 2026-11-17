import { spawnSync } from 'node:child_process';
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
import { afterEach, describe, expect, it } from 'vitest';

// The `probe` verb of nf-deploy.sh, against stubbed docker: nothing starts. The stub answers `compose ps` from COMPOSE_PS
// and the probe's `run` with PROBE_STATUS, and logs every call.
const DEPLOY = fileURLToPath(new URL('..', import.meta.url));
const ROOT = resolve(DEPLOY, '..');
const SCRIPT_SRC = resolve(DEPLOY, 'nf-deploy.sh');
const SCRIPT_TEXT = readFileSync(SCRIPT_SRC, 'utf8');
const NF_COMPOSE_TEXT = readFileSync(resolve(ROOT, 'compose', 'nf-live.yml'), 'utf8');
const PROBE_TEXT = readFileSync(resolve(ROOT, 'compose', 'nf-live-probe.yml'), 'utf8');
const SECRET_FILES = /^SECRET_FILES="([^"]+)"$/m.exec(SCRIPT_TEXT)?.[1].split(' ') ?? [];
const UP =
  'nats running 0\npostgres running 0\neventsink running 0\nvelocity running 0\nneoforge running 0\nidentity-seed exited 0';

const STUB_SCRIPTS: Record<string, string> = {
  docker: [
    '#!/bin/sh',
    'echo "docker $*" >>"$STUB_LOG"',
    'case "$1" in',
    '  ps) printf "%s\\n" "$DOCKER_LABELS"; exit 0 ;;',
    '  compose)',
    '    case "$*" in',
    // biome-ignore lint/suspicious/noTemplateCurlyInString: a shell fixture, not a template
    '      *" run "*) exit "${PROBE_STATUS:-0}" ;;',
    '      *" ps "*) printf "%s\\n" "$COMPOSE_PS"; exit 0 ;;',
    '    esac',
    '    exit 0 ;;',
    'esac',
    'exit 0',
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

function makeRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), 'nf-deploy-probe-'));
  made.push(repo);
  mkdirSync(join(repo, 'deploy'), { recursive: true });
  mkdirSync(join(repo, 'compose', 'secrets-nf'), { recursive: true });
  mkdirSync(join(repo, 'stubs'));
  copyFileSync(SCRIPT_SRC, join(repo, 'deploy', 'nf-deploy.sh'));
  writeFileSync(join(repo, 'compose', 'nf-live.yml'), NF_COMPOSE_TEXT);
  writeFileSync(join(repo, 'compose', 'nf-live-probe.yml'), PROBE_TEXT);
  for (const f of SECRET_FILES)
    writeFileSync(join(repo, 'compose', 'secrets-nf', f), `${f} fixture\n`);
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
    COMPOSE_PS: UP,
    PROBE_STATUS: '0',
    DOCKER_LABELS: '',
    STAT_MODE: '600',
    STAT_UID: '1000',
    ...extra,
  };
}

function run(repo: string, args: string[], extra: Record<string, string> = {}) {
  const r = spawnSync('sh', [join(repo, 'deploy', 'nf-deploy.sh'), ...args], {
    env: envFor(repo, extra),
    encoding: 'utf8',
    input: '',
  });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

function calls(repo: string): string[] {
  return readFileSync(join(repo, 'calls.log'), 'utf8').split('\n').filter(Boolean);
}

const composeCalls = (repo: string) =>
  calls(repo).filter((c) => c.startsWith('docker compose -p '));
// The probe run and its cleanup: both carry the probe overlay, so they are the only calls that name it.
const runCalls = (repo: string) =>
  composeCalls(repo).filter((c) => c.endsWith(' run --rm --no-deps probe'));
const rmCalls = (repo: string) =>
  composeCalls(repo).filter((c) => c.includes(' --profile probe ') && c.endsWith(' rm -f probe'));

afterEach(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
  made = [];
});

describe('nf-deploy.sh probe: refusals (nothing is run)', () => {
  it.each([
    ['no service is up', ''],
    ['nats is not running', UP.replace('nats running 0\n', 'nats exited 0\n')],
    ['neoforge is missing', UP.replace('neoforge running 0\n', '')],
    [
      'identity-seed did not exit 0',
      UP.replace('identity-seed exited 0', 'identity-seed exited 1'),
    ],
  ])('refuses when %s, and the probe never runs', (_label, states) => {
    const repo = makeRepo();
    const r = run(repo, ['probe'], { COMPOSE_PS: states });
    expect(r.status).not.toBe(0);
    expect(r.out).toContain('Nothing started');
    expect(runCalls(repo)).toEqual([]);
    expect(rmCalls(repo)).toEqual([]);
  });

  it.each(['nats-body.txt', 'rcon.txt'])(
    'refuses when %s is missing, before the probe runs',
    (name) => {
      const repo = makeRepo();
      rmSync(join(repo, 'compose', 'secrets-nf', name));
      const r = run(repo, ['probe']);
      expect(r.status).not.toBe(0);
      expect(runCalls(repo)).toEqual([]);
    },
  );
});

describe('nf-deploy.sh probe: the run', () => {
  it('runs the probe service with both files, the project and --no-deps, and never geldar-colo', () => {
    const repo = makeRepo();
    expect(run(repo, ['probe']).status).toBe(0);
    const runs = runCalls(repo);
    expect(runs).toHaveLength(1);
    // The script's ROOT is a POSIX-style path under Git Bash, so the check reads the tokens, not the path text.
    expect(runs[0]).toMatch(
      /^docker compose -p geldar-nf -f .+compose\/nf-live\.yml -f .+compose\/nf-live-probe\.yml --profile probe run --rm --no-deps probe$/,
    );
    expect(calls(repo).join('\n')).not.toMatch(/geldar-colo/);
    expect(calls(repo).join('\n')).not.toMatch(/nf-live-telemetry/);
  });

  it.each([0, 1, 7])('exits with the probe exit code (%i)', (code) => {
    const repo = makeRepo();
    const r = run(repo, ['probe'], { PROBE_STATUS: String(code) });
    expect(r.status, r.out).toBe(code);
  });

  it('removes the leftover container after a FAILED probe, after the run, and exits with its code', () => {
    const repo = makeRepo();
    const r = run(repo, ['probe'], { PROBE_STATUS: '1' });
    expect(r.status, r.out).toBe(1);
    expect(rmCalls(repo)).toHaveLength(1);
    const all = composeCalls(repo);
    expect(all.indexOf(rmCalls(repo)[0] as string)).toBeGreaterThan(
      all.indexOf(runCalls(repo)[0] as string),
    );
  });

  it('removes the leftover container after a SUCCESSFUL probe too', () => {
    const repo = makeRepo();
    const r = run(repo, ['probe'], { PROBE_STATUS: '0' });
    expect(r.status, r.out).toBe(0);
    expect(rmCalls(repo)).toHaveLength(1);
  });
});

describe('nf-deploy.sh probe: the other verbs are unchanged', () => {
  it.each([['status'], ['down'], ['up']])(
    '%s never names the probe overlay or the probe service',
    (verb) => {
      const repo = makeRepo();
      run(repo, [verb]);
      const probeWords = /--profile probe|nf-live-probe|rm -f probe|run --rm --no-deps probe/;
      expect(calls(repo).filter((c) => probeWords.test(c))).toEqual([]);
    },
  );
});
