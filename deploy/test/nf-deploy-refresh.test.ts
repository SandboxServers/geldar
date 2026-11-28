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

// The refresh-secrets verb of deploy/nf-deploy.sh: the recorded compose calls, their order, and the refusals. The stubs answer
// docker ps and compose ps from the environment; every docker call is logged to calls.log, as in nf-deploy-telemetry.test.ts.
vi.setConfig({ testTimeout: 120000 });

const DEPLOY = fileURLToPath(new URL('..', import.meta.url));
const ROOT = resolve(DEPLOY, '..');
const SCRIPT_SRC = resolve(DEPLOY, 'nf-deploy.sh');
const HUMAN_LIB_SRC = resolve(DEPLOY, 'nf-human-lib.sh');
const SCRIPT_TEXT = readFileSync(SCRIPT_SRC, 'utf8');
const NF_COMPOSE_TEXT = readFileSync(resolve(ROOT, 'compose', 'nf-live.yml'), 'utf8');
const SECRET_FILES = /^SECRET_FILES="([^"]+)"$/m.exec(SCRIPT_TEXT)?.[1].split(' ') ?? [];
const JAR_BYTES = 'geldar neoforge mod fixture\n';
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const MOD_SHA = sha(JAR_BYTES);
// The project up and healthy: nats, postgres, velocity, eventsink and neoforge running, identity-seed exited 0.
const ALL_UP = [
  'nats running healthy',
  'postgres running healthy',
  'velocity running healthy',
  'eventsink running ',
  'neoforge running healthy',
  'identity-seed exited 0',
].join('\n');
const STUB_SCRIPTS: Record<string, string> = {
  // Logs every call. docker ps answers DOCKER_LABELS; compose ps answers COMPOSE_PS; identity-seed exits SEED_EXIT.
  docker: [
    '#!/bin/sh',
    'echo "docker $*" >>"$STUB_LOG"',
    'case "$1" in',
    '  ps) printf "%s\\n" "$DOCKER_LABELS"; exit 0 ;;',
    '  compose)',
    '    case "$*" in',
    '      *" ps "*) printf "%s\\n" "$COMPOSE_PS"; exit 0 ;;',
    '      *identity-seed*) exit "${SEED_EXIT:-0}" ;;',
    '    esac',
    '    exit 0 ;;',
    'esac',
    'exit 0',
  ].join('\n'),
  ss: ['#!/bin/sh', 'exit 0'].join('\n'),
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

// A fixture tree: the script, the real compose/nf-live.yml, the secret files (mode 0600, owned by the service uid), the mod jar.
function makeRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), 'nf-refresh-'));
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
  for (const f of SECRET_FILES)
    writeFileSync(
      join(repo, 'compose', 'secrets-nf', f),
      f === 'nats-auth.conf'
        ? 'user: "human", permissions: { publish: { allow: ["_INBOX.human.>"] }, subscribe: { allow: ["_INBOX.human.>"] } }\n'
        : `${f} fixture\n`,
    );
  writeFileSync(join(repo, 'mod.jar'), JAR_BYTES);
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
    FREE_KB: '40000000',
    DISK_KB: '200000000',
    STAT_MODE: '600',
    STAT_UID: '1000',
    DOCKER_LABELS: '',
    COMPOSE_PS: ALL_UP,
    SEED_EXIT: '0',
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

// The compose calls only (docker ps, info and version are not compose calls).
function compose(repo: string): string[] {
  return calls(repo).filter((c) => c.startsWith('docker compose -p '));
}

// A compose call without its constant prefix (the project and the -f files). A status read is shortened to "ps", so the
// assertions read the service and the flags only.
function tail(call: string): string {
  return call.replace(/^docker compose -p geldar-nf (-f \S+ )+/, '').replace(/^ps .*$/, 'ps');
}

// The human lane's inputs, as nf-deploy-human.test.ts stages them: the overlay, the proxy config and the identity jar.
function addHuman(repo: string): void {
  mkdirSync(join(repo, 'compose', 'velocity'), { recursive: true });
  mkdirSync(join(repo, 'plugin', 'velocity-identity', 'build', 'libs'), { recursive: true });
  copyFileSync(
    join(ROOT, 'compose', 'nf-live-human.yml'),
    join(repo, 'compose', 'nf-live-human.yml'),
  );
  copyFileSync(
    join(ROOT, 'compose', 'velocity', 'velocity-nf-human.toml'),
    join(repo, 'compose', 'velocity', 'velocity-nf-human.toml'),
  );
  writeFileSync(
    join(repo, 'plugin', 'velocity-identity', 'build', 'libs', 'geldar-velocity-identity.jar'),
    'jar fixture\n',
  );
  // check_human_inputs needs the human NATS password non-empty when NF_HUMAN=on (only addHuman sets the lane on).
  writeFileSync(join(repo, 'compose', 'secrets-nf', 'nats-human.txt'), 'nats-human.txt fixture\n');
}

afterEach(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
  made = [];
});

describe('nf-deploy.sh refresh-secrets', () => {
  it('recreates nats first and waits for it healthy, then velocity and eventsink, identity-seed and neoforge', () => {
    const repo = makeRepo();
    const r = run(repo, ['refresh-secrets']);
    expect(r.status).toBe(0);
    expect(r.out).toContain('nats: running and healthy');
    expect(compose(repo).map(tail)).toEqual([
      'config --quiet',
      'ps',
      'up -d --force-recreate --no-deps nats',
      'ps',
      'up -d --wait --force-recreate --no-deps velocity eventsink',
      'up --force-recreate --no-deps --exit-code-from identity-seed identity-seed',
      'up -d --wait --force-recreate --no-deps neoforge',
    ]);
  });

  it('every compose call carries the constant project and the base file, and postgres is never named', () => {
    const repo = makeRepo();
    expect(run(repo, ['refresh-secrets']).status).toBe(0);
    expect(compose(repo).length).toBeGreaterThan(0);
    for (const c of compose(repo))
      expect(c).toMatch(/^docker compose -p geldar-nf -f \S*nf-live\.yml /);
    expect(compose(repo).some((c) => c.includes('postgres'))).toBe(false);
  });

  it('with NF_TELEMETRY=off every compose call adds the off overlay; unset adds no overlay', () => {
    const off = makeRepo();
    expect(run(off, ['refresh-secrets'], { NF_TELEMETRY: 'off' }).status).toBe(0);
    for (const c of compose(off)) expect(c).toMatch(/-f \S*nf-live-telemetry-off\.yml /);
    const unset = makeRepo();
    expect(run(unset, ['refresh-secrets']).status).toBe(0);
    expect(compose(unset).some((c) => c.includes('telemetry'))).toBe(false);
  });

  it('refuses a missing secret file before any compose call', () => {
    const repo = makeRepo();
    rmSync(join(repo, 'compose', 'secrets-nf', 'rcon.txt'));
    const r = run(repo, ['refresh-secrets']);
    expect(r.status).toBe(1);
    expect(r.out).toContain('secret file missing: rcon.txt');
    expect(compose(repo)).toEqual([]);
  });

  it('refuses to run as root before any compose call', () => {
    const repo = makeRepo();
    const id = join(repo, 'stubs', 'id');
    writeFileSync(id, '#!/bin/sh\necho 0\n');
    chmodSync(id, 0o755);
    const r = run(repo, ['refresh-secrets']);
    expect(r.status).toBe(1);
    expect(r.out).toContain('refusing to run as root');
    expect(compose(repo)).toEqual([]);
  });

  it('refuses when the project is not up (nothing to refresh) and recreates nothing', () => {
    const repo = makeRepo();
    const r = run(repo, ['refresh-secrets'], { COMPOSE_PS: 'nats running healthy' });
    expect(r.status).toBe(1);
    expect(r.out).toContain('postgres is not running');
    expect(compose(repo).map(tail)).toEqual(['config --quiet', 'ps']);
  });

  it('refuses an NF_TELEMETRY value other than on or off, and runs no compose call', () => {
    const repo = makeRepo();
    const r = run(repo, ['refresh-secrets'], { NF_TELEMETRY: 'maybe' });
    expect(r.status).toBe(1);
    expect(r.out).toContain('NF_TELEMETRY must be on or off');
    expect(compose(repo)).toEqual([]);
  });

  it('a nats health timeout stops before velocity, eventsink, identity-seed and neoforge are touched', () => {
    const repo = makeRepo();
    const r = run(repo, ['refresh-secrets'], {
      COMPOSE_PS: ALL_UP.replace('nats running healthy', 'nats running starting'),
      NF_REFRESH_HEALTH_TRIES: '2',
    });
    expect(r.status).toBe(1);
    expect(r.out).toContain('nats is not healthy after 2 checks');
    expect(compose(repo).map(tail)).toEqual([
      'config --quiet',
      'ps',
      'up -d --force-recreate --no-deps nats',
      'ps',
      'ps',
    ]);
  });

  it('a failed identity-seed (exit 1) fails the verb by name and neoforge is not recreated', () => {
    const repo = makeRepo();
    const r = run(repo, ['refresh-secrets'], { SEED_EXIT: '1' });
    expect(r.status).toBe(1);
    expect(r.out).toContain('identity-seed did not exit 0');
    const names = compose(repo).map(tail);
    expect(names[names.length - 1]).toBe(
      'up --force-recreate --no-deps --exit-code-from identity-seed identity-seed',
    );
    expect(names.some((n) => n.includes('neoforge'))).toBe(false);
  });

  // NF_HUMAN=on: velocity-human is recreated in the velocity step (one call, after nats is healthy), so a rotated secret reaches it.
  it('with NF_HUMAN=on recreates velocity-human with velocity and eventsink, after nats, under the human overlay', () => {
    const repo = makeRepo();
    addHuman(repo);
    const r = run(repo, ['refresh-secrets'], { NF_HUMAN: 'on', NF_HUMAN_BIND: '127.0.0.1' });
    expect(r.status, r.out).toBe(0);
    expect(compose(repo).map(tail)).toEqual([
      'config --quiet',
      'ps',
      'up -d --force-recreate --no-deps nats',
      'ps',
      'up -d --wait --force-recreate --no-deps velocity eventsink velocity-human',
      'up --force-recreate --no-deps --exit-code-from identity-seed identity-seed',
      'up -d --wait --force-recreate --no-deps neoforge',
    ]);
    for (const c of compose(repo)) expect(c).toMatch(/-f \S*nf-live-human\.yml /);
  });

  // P5: a failed recreate of velocity, eventsink and velocity-human stops velocity-human and nothing else.
  it('with NF_HUMAN=on, a failed velocity/eventsink/velocity-human recreate stops only velocity-human', () => {
    const repo = makeRepo();
    addHuman(repo);
    const failing = [
      '#!/bin/sh',
      'echo "docker $*" >>"$STUB_LOG"',
      'case "$*" in',
      '  *"--force-recreate --no-deps velocity eventsink velocity-human"*) exit 1 ;;',
      '  *"stop velocity-human"*) exit 0 ;;',
      'esac',
      STUB_SCRIPTS.docker.split('\n').slice(2).join('\n'),
    ].join('\n');
    writeFileSync(join(repo, 'stubs', 'docker'), `${failing}\n`);
    const r = run(repo, ['refresh-secrets'], { NF_HUMAN: 'on', NF_HUMAN_BIND: '127.0.0.1' });
    expect(r.status).not.toBe(0);
    const stops = calls(repo).filter((l) => / stop /.test(l));
    expect(stops).toHaveLength(1);
    expect(stops[0]).toMatch(/ compose -p geldar-nf .* stop velocity-human$/);
    for (const svc of ['velocity', 'nats', 'neoforge', 'eventsink', 'postgres']) {
      expect(stops.some((l) => l.endsWith(` stop ${svc}`))).toBe(false);
    }
    expect(calls(repo).some((l) => l.includes('identity-seed'))).toBe(false);
  });

  // NF_HUMAN unset or off: the velocity step names no human service, so the recorded args are those of the default run.
  it('with NF_HUMAN=off the velocity step is unchanged and names no human service', () => {
    const repo = makeRepo();
    expect(run(repo, ['refresh-secrets'], { NF_HUMAN: 'off' }).status).toBe(0);
    expect(compose(repo).map(tail)).toContain(
      'up -d --wait --force-recreate --no-deps velocity eventsink',
    );
    expect(compose(repo).some((c) => c.includes('human'))).toBe(false);
  });
});
