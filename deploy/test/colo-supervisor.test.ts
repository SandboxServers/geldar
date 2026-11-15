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
const IMAGE = `registry.example.invalid/geldar/supervisor@sha256:${'a'.repeat(64)}`;
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

// The fake stat: "stat -c %u PATH" prints FAKE_OWNER, or the uid the script runs as (GELDAR_SERVICE_UID) when it is unset.
// biome-ignore lint/suspicious/noTemplateCurlyInString: this is shell source for the shim, not a JS template
const STAT_SHIM = ['#!/bin/sh', 'echo "${FAKE_OWNER:-$GELDAR_SERVICE_UID}"', ''].join('\n');

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
  const statBin = join(dir, 'stat');
  writeFileSync(statBin, STAT_SHIM);
  chmodSync(statBin, 0o755);
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
      STAT: posix(statBin),
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

// CI runs the deploy scripts under sh, which is dash on Linux. Git's bash accepts pipefail and [[ ]], so a bashism would pass
// the behavioural tests on Windows. These checks read the source, so they catch one on any host.
describe('deploy/colo-supervisor.sh is POSIX sh (C7-03b2)', () => {
  const text = readFileSync(SCRIPT, 'utf8');
  const code = text
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n');

  it('starts with #!/bin/sh and sets -eu, with no pipefail', () => {
    expect(text.split('\n')[0]).toBe('#!/bin/sh');
    expect(code).toMatch(/^set -eu$/m);
    expect(code).not.toMatch(/pipefail/);
  });

  it('uses no bash-only syntax: no [[ ]], no =~, no local, no process substitution, no echo -e', () => {
    expect(code).not.toMatch(/\[\[|=~|\blocal\s|<\(|>\(|\bdeclare\s|\becho -e\b/);
  });

  it('parses under the shell the tests run it with (sh -n)', () => {
    const parsed = spawnSync(SH, ['-n', SCRIPT], { encoding: 'utf8' });
    expect(parsed.stderr).toBe('');
    expect(parsed.status).toBe(0);
  });
});

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

  it('sets the env block the compose service sets, and no GELDAR_NATS_URL (the supervisor reads SUPERVISOR_NATS_URL)', () => {
    const create = created(run({}).calls)[0] ?? '';
    for (const env of [
      '--env SUPERVISOR_SHARD=colo',
      '--env SUPERVISOR_NATS_URL=nats://nats:4222',
      '--env SUPERVISOR_DB_PASSWORD_FILE=/run/secrets/postgres-supervisor.txt',
      '--env POSTGRES_HOST=postgres',
      '--env POSTGRES_PORT=5432',
      '--env POSTGRES_DB=geldar',
      '--env GELDAR_NATS_USER=supervisor',
      '--env GELDAR_NATS_PASSWORD_FILE=/run/secrets/nats-supervisor.txt',
    ]) {
      expect(create, env).toContain(env);
    }
    expect(create).not.toContain('GELDAR_NATS_URL');
  });

  it('sets the two labels and the json-file log options of the compose service', () => {
    const create = created(run({}).calls)[0] ?? '';
    expect(create).toContain('--label com.centurylinklabs.watchtower.enable=false');
    expect(create).toContain('--label com.geldar.stack=colo');
    expect(create).toContain('--log-driver json-file --log-opt max-size=10m --log-opt max-file=3');
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
      FAKE_IMAGE: `other@sha256:${'b'.repeat(64)}`,
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

  it('refuses an image that is a tag, a value that starts with a dash, or a digest that is not exactly 64 lowercase hex, and creates nothing', () => {
    const digest = (hex: string) => `registry.example.invalid/geldar/supervisor@sha256:${hex}`;
    const images = [
      'geldar-supervisor:c7',
      `-${IMAGE}`,
      digest('a'.repeat(63)),
      digest('a'.repeat(65)),
      digest('A'.repeat(64)),
      `${IMAGE}x`,
    ];
    for (const image of images) {
      const r = run({ GELDAR_SUPERVISOR_IMAGE: image });
      expect(r.status, image).toBe(1);
      expect(r.stderr, image).toContain('must be a digest reference');
      expect(created(r.calls), image).toHaveLength(0);
    }
  });

  it('reads the owner with stat -L, so a symlink is judged by its target and not by the link', () => {
    const script = readFileSync(SCRIPT, 'utf8');
    expect(script).toMatch(/"\$STAT" -L -c %u "\$path"/);
  });

  it('refuses a secrets dir that is relative, or has a comma in it, and creates nothing', () => {
    const cases: [string, string][] = [
      ['secrets', 'must be an absolute path'],
      ['/var/lib/geldar,colo', 'must not contain a comma'],
    ];
    for (const [dir, message] of cases) {
      const r = run({ GELDAR_SECRETS_DIR: dir });
      expect(r.status, dir).toBe(1);
      expect(r.stderr, dir).toContain(message);
      expect(created(r.calls), dir).toHaveLength(0);
    }
  });

  it('refuses a secret file whose owner is not the uid the container runs as, and creates nothing', () => {
    const owned0 = run({ FAKE_OWNER: '0' });
    expect(owned0.status).toBe(1);
    expect(owned0.stderr).toContain('owned by uid 0');
    expect(created(owned0.calls)).toHaveLength(0);
    const owned1000 = run({ FAKE_OWNER: '1000' }, { uid: '4321' });
    expect(owned1000.status).toBe(1);
    expect(created(owned1000.calls)).toHaveLength(0);
  });

  it('accepts the files when their owner is the container uid (the owner check is not a blanket refusal)', () => {
    const r = run({ FAKE_OWNER: '4321' }, { uid: '4321' });
    expect(r.status, r.stderr).toBe(0);
    expect(created(r.calls)).toHaveLength(1);
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
