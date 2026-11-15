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
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

// deploy/colo-supervisor.sh (C7-03b2, decision 0260): creates geldar-colo-supervisor with docker create and docker start.
// The fake docker records every call and answers the inspects from FAKE_* variables. Behavioural, no Docker needed.
const DEPLOY = fileURLToPath(new URL('..', import.meta.url));
const ROOT = resolve(DEPLOY, '..');
const SCRIPT = resolve(DEPLOY, 'colo-supervisor.sh');
const IMAGE = 'registry.example.invalid/geldar/supervisor@sha256:' + 'a'.repeat(64);
const posix = (p: string) => p.replace(/\\/g, '/');

function findSh(): string {
  if (process.env.GELDAR_SHELL_TESTS_BASH) return process.env.GELDAR_SHELL_TESTS_BASH;
  if (process.platform !== 'win32') return 'sh';
  const bash = join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Git', 'bin', 'bash.exe');
  return existsSync(bash) ? bash : 'sh';
}
const SH = findSh();
vi.setConfig({ testTimeout: 60_000 });

// The fake docker. "container inspect --format {{.State.Running}}" and "{{.Config.Image}}" answer from FAKE_RUNNING and
// FAKE_IMAGE; a bare "container inspect NAME" succeeds only when FAKE_EXISTS is set; "network inspect" fails when
// FAKE_NET_MISSING is set. Everything else exits 0.
const DOCKER_SHIM = [
  '#!/bin/sh',
  'printf \'%s\\n\' "$*" >> "$DOCKER_CALLS_LOG"',
  'case "$*" in',
  '  "network inspect "*) [ -n "$FAKE_NET_MISSING" ] && exit 1; exit 0 ;;',
  '  "container inspect --format "*State.Running*) echo "$FAKE_RUNNING"; exit 0 ;;',
  '  "container inspect --format "*Config.Image*) echo "$FAKE_IMAGE"; exit 0 ;;',
  '  "container inspect "*) [ -n "$FAKE_EXISTS" ] && exit 0; exit 1 ;;',
  'esac',
  'exit 0',
  '',
].join('\n');

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
  calls: string[];
}

function run(env: Record<string, string>, opts: { secrets?: boolean; uid?: string } = {}): Run {
  const dir = mkdtempSync(join(tmpdir(), 'geldar-colo-supervisor-'));
  dirs.push(dir);
  const bin = join(dir, 'docker');
  writeFileSync(bin, DOCKER_SHIM);
  chmodSync(bin, 0o755);
  const secrets = join(dir, 'secrets');
  mkdirSync(secrets);
  if (opts.secrets !== false) {
    writeFileSync(join(secrets, 'postgres-supervisor.txt'), 'x\n');
    writeFileSync(join(secrets, 'nats-supervisor.txt'), 'x\n');
  }
  const log = join(dir, 'calls.log');
  writeFileSync(log, '');
  const result = spawnSync(SH, [posix(SCRIPT)], {
    cwd: ROOT,
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH ?? '',
      HOME: dir,
      DOCKER: posix(bin),
      DOCKER_CALLS_LOG: posix(log),
      GELDAR_SUPERVISOR_IMAGE: IMAGE,
      GELDAR_SECRETS_DIR: posix(secrets),
      GELDAR_SERVICE_UID: opts.uid ?? '1000',
      ...env,
    },
  });
  const calls = readFileSync(log, 'utf8').split('\n').filter(Boolean);
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, calls };
}

const created = (calls: string[]) => calls.filter((c) => c.startsWith('create '));
const started = (calls: string[]) => calls.filter((c) => c === 'start geldar-colo-supervisor');

describe('deploy/colo-supervisor.sh: first run (C7-03b2, decision 0260)', () => {
  it('creates the container with docker create and then starts it with docker start', () => {
    const r = run({});
    expect(r.status, r.stderr).toBe(0);
    expect(created(r.calls)).toHaveLength(1);
    expect(started(r.calls)).toHaveLength(1);
    expect(r.calls.indexOf(started(r.calls)[0])).toBeGreaterThan(
      r.calls.findIndex((c) => c.startsWith('create ')),
    );
  });

  it('passes the compose limits and the no-swap memory pair, with the same values as compose', () => {
    const create = created(run({}).calls)[0] ?? '';
    expect(create).toContain('--name geldar-colo-supervisor');
    expect(create).toContain('--network geldar-colo');
    expect(create).toContain('--cpus 0.25');
    expect(create).toContain('--memory 128m --memory-swap 128m');
    expect(create).toContain('--user 1000:1000');
    expect(create).toContain('--read-only');
    expect(create).toContain('--cap-drop ALL');
    expect(create).toContain('--security-opt no-new-privileges:true');
    expect(create).toContain('--pids-limit 64');
    expect(create).toContain('--restart unless-stopped');
    expect(create).toContain(`${IMAGE}`);
  });

  it('mounts only the two secret files, read-only, and passes no secret value in env', () => {
    const create = created(run({}).calls)[0] ?? '';
    expect(create).toMatch(/target=\/run\/secrets\/postgres-supervisor\.txt,readonly/);
    expect(create).toMatch(/target=\/run\/secrets\/nats-supervisor\.txt,readonly/);
    expect(create).not.toMatch(/--env [A-Z_]*(PASSWORD|SECRET|TOKEN)=/);
  });

  it('uses the uid from GELDAR_SERVICE_UID', () => {
    const create = created(run({}, { uid: '4321' }).calls)[0] ?? '';
    expect(create).toContain('--user 4321:4321');
  });
});

describe('deploy/colo-supervisor.sh: re-runs and refusals (C7-03b2)', () => {
  it('a second run with a running container on the same image is a no-op', () => {
    const r = run({ FAKE_EXISTS: '1', FAKE_RUNNING: 'true', FAKE_IMAGE: IMAGE });
    expect(r.status, r.stderr).toBe(0);
    expect(created(r.calls)).toHaveLength(0);
    expect(started(r.calls)).toHaveLength(0);
  });

  it('refuses an existing container that is stopped, and removes nothing', () => {
    const r = run({ FAKE_EXISTS: '1', FAKE_RUNNING: 'false', FAKE_IMAGE: IMAGE });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('replaces nothing');
    expect(created(r.calls)).toHaveLength(0);
    expect(started(r.calls)).toHaveLength(0);
  });

  it('refuses an existing running container on another image', () => {
    const r = run({
      FAKE_EXISTS: '1',
      FAKE_RUNNING: 'true',
      FAKE_IMAGE: 'other@sha256:' + 'b'.repeat(64),
    });
    expect(r.status).toBe(1);
    expect(created(r.calls)).toHaveLength(0);
  });

  it('refuses when the geldar-colo network is missing, and creates nothing', () => {
    const r = run({ FAKE_NET_MISSING: '1' });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('never creates a network');
    expect(created(r.calls)).toHaveLength(0);
  });

  it('refuses when a secret file is missing', () => {
    const r = run({}, { secrets: false });
    expect(r.status).toBe(1);
    expect(created(r.calls)).toHaveLength(0);
  });

  it('refuses uid 0 and a non-numeric uid', () => {
    expect(run({}, { uid: '0' }).status).toBe(1);
    expect(run({}, { uid: 'root' }).status).toBe(1);
    expect(created(run({}, { uid: '0' }).calls)).toHaveLength(0);
  });
});

describe('deploy/colo-supervisor.sh: no compose, no network change, no removal (C7-03b2)', () => {
  it('no recorded docker call is compose, down, rm, network create or network rm, or --force-recreate', () => {
    const banned = /(^| )(compose|down|rm)( |$)|network (create|rm)|--force-recreate/;
    const calls = [
      run({}).calls,
      run({ FAKE_EXISTS: '1', FAKE_RUNNING: 'false', FAKE_IMAGE: IMAGE }).calls,
      run({ FAKE_NET_MISSING: '1' }).calls,
    ].flat();
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.filter((c) => banned.test(c))).toEqual([]);
  });

  it('the script runs no compose, down, rm, network create or network rm command (comments and operator echo lines excluded)', () => {
    const code = readFileSync(SCRIPT, 'utf8')
      .split('\n')
      .filter((line) => !/^\s*(#|echo\s)/.test(line))
      .join('\n');
    expect(code).not.toMatch(
      /docker\s+compose|\bdown\b|\brm\b|network\s+(create|rm)|--force-recreate/,
    );
  });
});

describe('the supervisor profile is never named by the deploy path (C7-03b2)', () => {
  it('colo-up.sh, colo-cd.sh and common.sh do not start the supervisor profile', () => {
    for (const file of ['colo-up.sh', 'colo-cd.sh', 'common.sh']) {
      const text = readFileSync(join(DEPLOY, file), 'utf8');
      expect(text, file).not.toMatch(/--profile\s+supervisor|COMPOSE_PROFILES[^\n]*supervisor/);
    }
  });

  it('the compose file keeps the supervisor service behind its profile', () => {
    const text = readFileSync(resolve(ROOT, 'compose', 'colo.yml'), 'utf8');
    expect(text).toMatch(/supervisor:\n\s+profiles: \[supervisor\]/);
  });
});
