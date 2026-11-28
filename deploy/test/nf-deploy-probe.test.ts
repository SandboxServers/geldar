import { spawn, spawnSync } from 'node:child_process';
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

// The `probe` verb of nf-deploy.sh, against stubbed docker: nothing starts. The stub answers `compose ps` from COMPOSE_PS
// and the probe's `run` with PROBE_STATUS, and logs every call.
const DEPLOY = fileURLToPath(new URL('..', import.meta.url));
const ROOT = resolve(DEPLOY, '..');
const SCRIPT_SRC = resolve(DEPLOY, 'nf-deploy.sh');
const HUMAN_LIB_SRC = resolve(DEPLOY, 'nf-human-lib.sh');
const SCRIPT_TEXT = readFileSync(SCRIPT_SRC, 'utf8');
const NF_COMPOSE_TEXT = readFileSync(resolve(ROOT, 'compose', 'nf-live.yml'), 'utf8');
const PROBE_TEXT = readFileSync(resolve(ROOT, 'compose', 'nf-live-probe.yml'), 'utf8');
const SECRET_FILES = /^SECRET_FILES="([^"]+)"$/m.exec(SCRIPT_TEXT)?.[1].split(' ') ?? [];
// The `docker compose ps -a` lines of a project `up` started: service, state, health (empty without one), exit code.
const UP =
  'nats running healthy 0\npostgres running  0\neventsink running  0\nvelocity running healthy 0\nneoforge running healthy 0\nidentity-seed exited  0';

const STUB_SCRIPTS: Record<string, string> = {
  docker: [
    '#!/bin/sh',
    'echo "docker $*" >>"$STUB_LOG"',
    'case "$1" in',
    '  ps) printf "%s\\n" "$DOCKER_LABELS"; exit 0 ;;',
    '  compose)',
    '    case "$*" in',
    // biome-ignore lint/suspicious/noTemplateCurlyInString: a shell fixture, not a template
    // PROBE_BLOCK makes the run block (the signal test kills it); otherwise it exits at once with PROBE_STATUS.
    '      *" run "*) [ -z "${PROBE_BLOCK:-}" ] || sleep 30; exit "${PROBE_STATUS:-0}" ;;',
    '      *" ps "*) printf "%s\\n" "$COMPOSE_PS"; exit 0 ;;',
    '    esac',
    '    exit 0 ;;',
    'esac',
    'exit 0',
  ].join('\n'),
  // The probe verb asks only `id -u` (check_operator); the uid is STUB_ID, 1000 unless a test says otherwise.
  // biome-ignore lint/suspicious/noTemplateCurlyInString: a shell fixture, not a template
  id: ['#!/bin/sh', 'echo "${STUB_ID:-1000}"', 'exit 0'].join('\n'),
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
  copyFileSync(HUMAN_LIB_SRC, join(repo, 'deploy', 'nf-human-lib.sh'));
  copyFileSync(resolve(DEPLOY, 'nf-rangers-lib.sh'), join(repo, 'deploy', 'nf-rangers-lib.sh'));
  copyFileSync(
    resolve(DEPLOY, 'nf-extra-mods-lib.sh'),
    join(repo, 'deploy', 'nf-extra-mods-lib.sh'),
  );
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
    STUB_ID: '1000',
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
    ['nats is not running', UP.replace('nats running healthy 0\n', 'nats exited  0\n')],
    ['neoforge is missing', UP.replace('neoforge running healthy 0\n', '')],
    [
      'identity-seed did not exit 0',
      UP.replace('identity-seed exited  0', 'identity-seed exited  1'),
    ],
    ['velocity is not running', UP.replace('velocity running healthy 0\n', 'velocity exited  0\n')],
    ['postgres is not running', UP.replace('postgres running  0\n', 'postgres exited  0\n')],
    [
      'neoforge is starting, not healthy',
      UP.replace('neoforge running healthy 0', 'neoforge running starting 0'),
    ],
    [
      'velocity is unhealthy',
      UP.replace('velocity running healthy 0', 'velocity running unhealthy 0'),
    ],
    ['nats is unhealthy', UP.replace('nats running healthy 0', 'nats running unhealthy 0')],
  ])('refuses when %s, and the probe never runs', (_label, states) => {
    const repo = makeRepo();
    const r = run(repo, ['probe'], { COMPOSE_PS: states });
    expect(r.status).not.toBe(0);
    expect(r.out).toContain('Nothing started');
    expect(runCalls(repo)).toEqual([]);
    expect(rmCalls(repo)).toEqual([]);
  });

  it.each(['nats', 'velocity', 'neoforge', 'postgres', 'eventsink', 'identity-seed'])(
    'refuses when %s is missing from the project, and the probe never runs',
    (svc) => {
      const repo = makeRepo();
      const states = UP.split('\n')
        .filter((line) => !line.startsWith(`${svc} `))
        .join('\n');
      const r = run(repo, ['probe'], { COMPOSE_PS: states });
      expect(r.status).not.toBe(0);
      expect(r.out).toContain('Nothing started');
      expect(runCalls(repo)).toEqual([]);
    },
  );

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

describe('nf-deploy.sh probe: guards (nothing is run)', () => {
  it.each([
    [
      'a geldar-nf container with a geldar-colo stack label',
      'com.docker.compose.project=geldar-nf,com.geldar.stack=colo',
    ],
    ['a container of the geldar-colo project', 'com.docker.compose.project=geldar-colo'],
  ])('refuses when %s', (_label, labels) => {
    const repo = makeRepo();
    const r = run(repo, ['probe'], { DOCKER_LABELS: labels });
    expect(r.status).toBe(1);
    expect(r.out).toContain('geldar-colo label');
    expect(composeCalls(repo)).toEqual([]);
    expect(runCalls(repo)).toEqual([]);
  });

  it.each([
    ['a secret file has mode 644', { STAT_MODE: '644' }, /has mode 644/],
    ['a secret file is owned by another uid', { STAT_UID: '1001' }, /owned by uid 1001/],
  ])('refuses when %s, and the probe never runs', (_label, extra, message) => {
    const repo = makeRepo();
    const r = run(repo, ['probe'], extra);
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(message);
    expect(runCalls(repo)).toEqual([]);
  });

  it('refuses to run as root, before any docker call that changes anything', () => {
    const repo = makeRepo();
    const r = run(repo, ['probe'], { STUB_ID: '0' });
    expect(r.status).not.toBe(0);
    expect(r.out).toContain('refusing to run as root');
    expect(composeCalls(repo)).toEqual([]);
    expect(runCalls(repo)).toEqual([]);
  });
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

describe('nf-deploy.sh probe: the image and the signals', () => {
  it('builds the probe image before the run, so a stale tag is rebuilt (run --no-deps reuses an existing tag)', () => {
    const repo = makeRepo();
    expect(run(repo, ['probe'], {}).status).toBe(0);
    const list = composeCalls(repo);
    const build = list.findIndex((c) => c.endsWith(' --profile probe build probe'));
    const exec = list.findIndex((c) => c.endsWith(' run --rm --no-deps probe'));
    expect(build).toBeGreaterThanOrEqual(0);
    expect(build).toBeLessThan(exec);
  });

  // Linux CI only: a POSIX signal to the process group, as a terminal's Ctrl-C sends it. Skipped on Windows (no SIGINT to sh).
  it.runIf(process.platform !== 'win32')(
    'on SIGINT, removes the leftover probe with its stop grace period and exits 130',
    async () => {
      const repo = makeRepo();
      const child = spawn('sh', [join(repo, 'deploy', 'nf-deploy.sh'), 'probe'], {
        env: envFor(repo, { PROBE_BLOCK: '1' }),
        detached: true,
        stdio: 'ignore',
      });
      const exited = new Promise<number | null>((res) => child.on('exit', (code) => res(code)));
      // The run is recorded when the stub starts it; it then blocks in sleep, as a probe does.
      for (let i = 0; i < 200; i++) {
        if (composeCalls(repo).some((c) => c.endsWith(' run --rm --no-deps probe'))) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      process.kill(-(child.pid ?? 0), 'SIGINT');
      expect(await exited).toBe(130);
      expect(composeCalls(repo).some((c) => c.endsWith(' --profile probe rm -f -s probe'))).toBe(
        true,
      );
    },
    20000,
  );
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
