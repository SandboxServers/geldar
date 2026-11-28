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

// The NF_HUMAN cases of deploy/nf-deploy.sh: the overlay (compose/nf-live-human.yml), the refusals, the port gate with
// multi-row docker ps fixtures, and the byte-identical calls when the lane is off. The fixture tree and stubs are small
// copies of the ones in nf-deploy-telemetry.test.ts (the same stub contract: docker, ss, free, df, stat, tar).
vi.setConfig({ testTimeout: 120000 });

const DEPLOY = fileURLToPath(new URL('..', import.meta.url));
const ROOT = resolve(DEPLOY, '..');
const SCRIPT_SRC = resolve(DEPLOY, 'nf-deploy.sh');
const HUMAN_LIB_SRC = resolve(DEPLOY, 'nf-human-lib.sh');
const SCRIPT_TEXT = readFileSync(SCRIPT_SRC, 'utf8');
const SECRET_FILES = /^SECRET_FILES="([^"]+)"$/m.exec(SCRIPT_TEXT)?.[1].split(' ') ?? [];
const JAR_BYTES = 'geldar neoforge mod fixture\n';
const MOD_SHA = createHash('sha256').update(JAR_BYTES).digest('hex');
const IDENTITY_JAR = 'identity plugin fixture\n';
// The human lane's NATS password. check_human_inputs needs it non-empty when NF_HUMAN=on; only the generator writes it.
const HUMAN_SECRET = 'nats-human.txt';

const STUB_SCRIPTS: Record<string, string> = {
  // Logs every call. ps answers the rows of the fixture for the service-label format and nothing for the labels format.
  docker: [
    '#!/bin/sh',
    'echo "docker $*" >>"$STUB_LOG"',
    'case "$1" in',
    '  ps) case "$*" in *compose.service*) printf "%s\\n" "$DOCKER_PS_ROWS" ;; esac; exit 0 ;;',
    '  volume) exit 0 ;;',
    '  run) exit 0 ;;',
    'esac',
    'exit 0',
  ].join('\n'),
  // The listener of each host port: 46565 is the live velocity port, 46566 the human port.
  ss: [
    '#!/bin/sh',
    'case "$*" in',
    '  *46565*) [ -n "$SS_LIVE" ] && printf "%s\\n" "$SS_LIVE" ;;',
    '  *46566*) [ -n "$SS_HUMAN" ] && printf "%s\\n" "$SS_HUMAN" ;;',
    'esac',
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
  tar: ['#!/bin/sh', 'exit 0'].join('\n'),
};

// Five project rows as docker ps prints them: neoforge (exposed only), velocity (the live mapping), velocity-human (the human
// mapping), nats (exposed only) and postgres (exposed only).
const LIVE_ROW = 'geldar-nf|velocity|127.0.0.1:46565->25565/tcp';
const HUMAN_ROW = 'geldar-nf|velocity-human|127.0.0.1:46566->25565/tcp';
// The one-shot init after it has exited: docker ps -a prints the row with an empty Ports field.
const INIT_ROW = 'geldar-nf|velocity-human-init|';
const FIVE_ROWS = [
  'geldar-nf|neoforge|25565/tcp',
  LIVE_ROW,
  HUMAN_ROW,
  'geldar-nf|nats|4222/tcp, 6222/tcp, 8222/tcp',
  'geldar-nf|postgres|5432/tcp',
].join('\n');
const LISTEN_LIVE = 'LISTEN 0 4096 127.0.0.1:46565 0.0.0.0:*';
const LISTEN_HUMAN = 'LISTEN 0 4096 127.0.0.1:46566 0.0.0.0:*';

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

// The fixture tree: the script, the real overlay, toml and compose file, the secrets, the mod jar and the identity jar.
// human: false omits nats-human.txt (the NF_HUMAN off and unset cases, and the refusal without it).
function makeRepo(opts: { human?: boolean } = {}): string {
  const repo = mkdtempSync(join(tmpdir(), 'nf-human-'));
  made.push(repo);
  for (const dir of [
    'deploy',
    'compose/secrets-nf',
    'compose/velocity',
    'compose/neoforge',
    'stubs',
  ]) {
    mkdirSync(join(repo, dir), { recursive: true });
  }
  mkdirSync(join(repo, 'plugin', 'velocity-identity', 'build', 'libs'), { recursive: true });
  copyFileSync(SCRIPT_SRC, join(repo, 'deploy', 'nf-deploy.sh'));
  copyFileSync(HUMAN_LIB_SRC, join(repo, 'deploy', 'nf-human-lib.sh'));
  copyFileSync(resolve(DEPLOY, 'nf-rangers-lib.sh'), join(repo, 'deploy', 'nf-rangers-lib.sh'));
  copyFileSync(
    resolve(DEPLOY, 'nf-extra-mods-lib.sh'),
    join(repo, 'deploy', 'nf-extra-mods-lib.sh'),
  );
  for (const f of ['nf-live.yml', 'nf-live-human.yml']) {
    copyFileSync(join(ROOT, 'compose', f), join(repo, 'compose', f));
  }
  copyFileSync(
    join(ROOT, 'compose', 'velocity', 'velocity-nf-human.toml'),
    join(repo, 'compose', 'velocity', 'velocity-nf-human.toml'),
  );
  writeFileSync(join(repo, 'compose', 'neoforge', 'neoforge-entrypoint.sh'), '#!/bin/sh\n');
  // nats-auth.conf holds the human line as the generator writes it now (own inbox only): check_human_conf reads it, never printed.
  const humanLine =
    'user: "human", permissions: { publish: { allow: ["_INBOX.human.>"] }, subscribe: { allow: ["_INBOX.human.>"] } }\n';
  for (const f of SECRET_FILES)
    writeFileSync(
      join(repo, 'compose', 'secrets-nf', f),
      f === 'nats-auth.conf' ? humanLine : `${f}\n`,
    );
  if (opts.human ?? true) {
    writeFileSync(join(repo, 'compose', 'secrets-nf', HUMAN_SECRET), `${HUMAN_SECRET}\n`);
  }
  writeFileSync(join(repo, 'mod.jar'), JAR_BYTES);
  writeFileSync(
    join(repo, 'plugin', 'velocity-identity', 'build', 'libs', 'geldar-velocity-identity.jar'),
    IDENTITY_JAR,
  );
  for (const [name, body] of Object.entries(STUB_SCRIPTS)) {
    const path = join(repo, 'stubs', name);
    writeFileSync(path, `${body}\n`);
    chmodSync(path, 0o755);
  }
  writeFileSync(join(repo, 'calls.log'), '');
  return repo;
}

interface Opts {
  env?: Record<string, string | undefined>;
  rows?: string;
  live?: string;
  human?: string;
  args?: string[];
}

// Runs the script in the fixture with the stubs first on PATH. A key set to undefined is removed from the environment.
function run(repo: string, opts: Opts = {}) {
  const env: Record<string, string> = {
    PATH: `${join(repo, 'stubs')}${delimiter}${process.env.PATH ?? ''}`,
    STUB_LOG: join(repo, 'calls.log'),
    DOCKER_PS_ROWS: opts.rows ?? FIVE_ROWS,
    SS_LIVE: opts.live ?? '',
    SS_HUMAN: opts.human ?? '',
    FREE_KB: '100000000',
    DISK_KB: '100000000',
    STAT_MODE: '600',
    STAT_UID: '1000',
    NF_MOD_JAR_HOST: join(repo, 'mod.jar'),
    NF_MOD_SHA256: MOD_SHA,
    NF_HUMAN: 'on',
    NF_HUMAN_BIND: '127.0.0.1',
    NF_SECRETS_DIR: join(repo, 'compose', 'secrets-nf'),
  };
  for (const [key, value] of Object.entries(opts.env ?? {})) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return spawnSync(
    'sh',
    [join(repo, 'deploy', 'nf-deploy.sh'), ...(opts.args ?? ['plan', '--local'])],
    {
      cwd: repo,
      env: { ...process.env, ...env } as NodeJS.ProcessEnv,
      encoding: 'utf8',
    },
  );
}

const calls = (repo: string): string[] =>
  readFileSync(join(repo, 'calls.log'), 'utf8')
    .split('\n')
    .filter((l) => l !== '');
const COMPOSE_CALL = /-f \S*compose\/nf-live\.yml/;
const HUMAN_CALL = /-f \S*compose\/nf-live-human\.yml/;

describe('nf-deploy.sh human lane (NF_HUMAN)', () => {
  it('off (unset) calls compose with the base file only, the same calls as before the lane', () => {
    const repo = makeRepo({ human: false });
    const res = run(repo, {
      env: { NF_HUMAN: undefined, NF_HUMAN_BIND: undefined },
      rows: LIVE_ROW,
    });
    expect(res.status).toBe(0);
    // Byte-identical to the pre-lane call: one -f (the base file) and nothing else.
    const compose = calls(repo).filter((l) => l.startsWith('docker compose -p'));
    expect(compose).toHaveLength(1);
    expect(compose[0]).toMatch(
      /^docker compose -p geldar-nf -f \S*compose\/nf-live\.yml config --quiet$/,
    );
  });

  it('off (explicit) is the same as unset: no human overlay in any compose call', () => {
    const repo = makeRepo({ human: false });
    const res = run(repo, {
      env: { NF_HUMAN: 'off', NF_HUMAN_BIND: undefined },
      rows: LIVE_ROW,
      args: ['up', '--local'],
    });
    expect(res.status).toBe(0);
    const compose = calls(repo).filter((l) => l.startsWith('docker compose -p'));
    expect(compose.length).toBeGreaterThan(0);
    for (const line of compose) expect(line).not.toContain('nf-live-human');
    expect(compose.some((l) => l.endsWith('up -d --wait velocity'))).toBe(true);
  });

  it('on adds the human overlay after the base file to every compose call, and up adds velocity-human with no force-recreate', () => {
    const repo = makeRepo();
    const res = run(repo, {
      env: { NF_HUMAN_PORT: undefined },
      args: ['up', '--local'],
      live: LISTEN_LIVE,
      rows: [LIVE_ROW, HUMAN_ROW].join('\n'),
    });
    expect(res.status).toBe(0);
    const compose = calls(repo).filter((l) => l.startsWith('docker compose -p'));
    for (const line of compose) {
      expect(line).toMatch(COMPOSE_CALL);
      expect(line).toMatch(HUMAN_CALL);
      expect(line.indexOf('nf-live.yml')).toBeLessThan(line.indexOf('nf-live-human.yml'));
    }
    const up = compose.find((l) => l.endsWith('up -d --wait velocity-human'));
    expect(up).toBeDefined();
    expect(compose.join('\n')).not.toMatch(/force-recreate|\bstop\b|\brm\b|\bdown\b/);
  });

  it('status with the lane on adds the human overlay only (status never reads the telemetry switch)', () => {
    const repo = makeRepo();
    const res = run(repo, { env: { NF_TELEMETRY: 'off' }, args: ['status', '--local'] });
    expect(res.status).toBe(0);
    const line = calls(repo).find((l) => l.startsWith('docker compose -p') && l.endsWith('ps -a'));
    expect(line).toMatch(/-f \S*nf-live\.yml -f \S*nf-live-human\.yml ps -a$/);
  });

  it('plan with the lane on prints the human line and changes no state', () => {
    const repo = makeRepo();
    const res = run(repo, { live: LISTEN_LIVE, human: LISTEN_HUMAN });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('velocity-human publishes 127.0.0.1:46566->25565');
    expect(res.stdout).toContain('5. up -d --wait velocity-human');
    expect(
      calls(repo).some(
        (l) => /\b(up|down|rm|stop)\b/.test(l) && !l.startsWith('docker compose version'),
      ),
    ).toBe(false);
  });

  it('passes the port gate with five project rows, the human mapping held by velocity-human, and exposed-only tokens', () => {
    const repo = makeRepo();
    const res = run(repo, { live: LISTEN_LIVE, human: LISTEN_HUMAN });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('all gates passed');
  });

  it('refuses a human port listener when velocity-human publishes a second mapping on another address', () => {
    const repo = makeRepo();
    const rows = [
      LIVE_ROW,
      'geldar-nf|velocity-human|127.0.0.1:46566->25565/tcp, 0.0.0.0:46567->25565/tcp',
    ].join('\n');
    const res = run(repo, { rows, human: LISTEN_HUMAN });
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('more than one published mapping');
  });

  it('refuses when velocity-human publishes 0.0.0.0 on the human port', () => {
    const repo = makeRepo();
    const rows = [LIVE_ROW, 'geldar-nf|velocity-human|0.0.0.0:46566->25565/tcp'].join('\n');
    const res = run(repo, { rows, human: LISTEN_HUMAN });
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('is not exactly 127.0.0.1:46566->25565/tcp');
  });

  it('refuses when the human port is held and no velocity-human row exists (only the exposed token of another service)', () => {
    const repo = makeRepo();
    const res = run(repo, {
      rows: FIVE_ROWS.replace(HUMAN_ROW, 'geldar-nf|velocity-human|25565/tcp'),
      human: LISTEN_HUMAN,
    });
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('unpublished only');
  });

  it('refuses a human listener that is not on the human bind address', () => {
    const repo = makeRepo();
    const res = run(repo, { rows: FIVE_ROWS, human: 'LISTEN 0 4096 0.0.0.0:46566 0.0.0.0:*' });
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('ss socket not 127.0.0.1:46566');
  });

  it('keeps the live gate on velocity rows only: a velocity-human row never satisfies the live port', () => {
    const repo = makeRepo();
    const rows =
      'geldar-nf|velocity-human|127.0.0.1:46565->25565/tcp\n' +
      FIVE_ROWS.replace(LIVE_ROW, 'geldar-nf|velocity|25565/tcp');
    const res = run(repo, { rows, live: LISTEN_LIVE, human: LISTEN_HUMAN });
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('unpublished only (no published mapping)');
  });

  it('refuses a human port that is not free of a second velocity-human row', () => {
    const repo = makeRepo();
    const res = run(repo, {
      rows: [LIVE_ROW, HUMAN_ROW, HUMAN_ROW].join('\n'),
      human: LISTEN_HUMAN,
    });
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('more than one docker ps row');
  });

  const refusals: [string, Record<string, string | undefined>, string][] = [
    ['NF_HUMAN_BIND unset', { NF_HUMAN_BIND: undefined }, 'NF_HUMAN_BIND must be set'],
    ['NF_HUMAN_BIND empty', { NF_HUMAN_BIND: '' }, 'NF_HUMAN_BIND must be set'],
    ['NF_HUMAN_BIND blank (spaces)', { NF_HUMAN_BIND: '   ' }, 'NF_HUMAN_BIND must be set'],
    ['NF_HUMAN_BIND 0.0.0.0', { NF_HUMAN_BIND: '0.0.0.0' }, 'wildcard'],
    ['NF_HUMAN_BIND ::', { NF_HUMAN_BIND: '::' }, 'wildcard'],
    ['NF_HUMAN_PORT 25565', { NF_HUMAN_PORT: '25565' }, 'reserved'],
    ['NF_HUMAN_PORT 25566', { NF_HUMAN_PORT: '25566' }, 'reserved'],
    ['NF_HUMAN_PORT 46565 (the live port)', { NF_HUMAN_PORT: '46565' }, 'reserved'],
    ['NF_HUMAN_PORT with a leading zero', { NF_HUMAN_PORT: '046566' }, 'leading zero'],
    ['NF_HUMAN_PORT not numeric', { NF_HUMAN_PORT: 'abc' }, 'leading zero'],
    ['NF_HUMAN_PORT above 65535', { NF_HUMAN_PORT: '70000' }, 'above 65535'],
    ['NF_HUMAN value yes', { NF_HUMAN: 'yes' }, 'NF_HUMAN must be on or off'],
  ];
  it.each(refusals)(
    'refuses %s, names the reason, and makes no docker call',
    (_name, env, reason) => {
      const repo = makeRepo();
      const res = run(repo, { env });
      expect(res.status).toBe(1);
      expect(res.stderr).toContain(reason);
      expect(calls(repo)).toEqual([]);
    },
  );

  it('refuses when the human toml is missing, and makes no docker call', () => {
    const repo = makeRepo();
    rmSync(join(repo, 'compose', 'velocity', 'velocity-nf-human.toml'));
    const res = run(repo);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('velocity-nf-human.toml is missing');
    expect(calls(repo)).toEqual([]);
  });

  it('refuses when the identity plugin jar is missing, and makes no docker call', () => {
    const repo = makeRepo();
    rmSync(
      join(repo, 'plugin', 'velocity-identity', 'build', 'libs', 'geldar-velocity-identity.jar'),
    );
    const res = run(repo);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('identity plugin jar is missing');
    expect(calls(repo)).toEqual([]);
  });

  // H5: NF_HUMAN=on without nats-human.txt refuses at plan and at up, names the file, and makes no docker call.
  it.each(['plan', 'up'])(
    'refuses NF_HUMAN=on without nats-human.txt at %s, names the file, and makes no docker call',
    (verb) => {
      const repo = makeRepo({ human: false });
      const res = run(repo, { args: [verb, '--local'] });
      expect(res.status).toBe(1);
      expect(res.stderr).toContain('nats-human.txt');
      expect(calls(repo)).toEqual([]);
    },
  );

  it('down reads the switch and removes velocity-human with the human overlay', () => {
    const repo = makeRepo();
    const res = run(repo, { args: ['down', '--local'] });
    expect(res.status).toBe(0);
    const line = calls(repo).find((l) => l.startsWith('docker compose -p') && l.endsWith(' down'));
    expect(line).toMatch(HUMAN_CALL);
  });
});

// The fail-closed fixes: the bind and port rules, the empty identity jar, a failed start (only velocity-human is stopped),
// human-down with the flag unset, and logs for velocity-human.
describe('nf-deploy.sh human lane: fail-closed fixes', () => {
  const BAD_BINDS = [
    '192.0.2.010',
    '192.0.2.04',
    '::0',
    '0::',
    '0:0:0:0:0:0:0:0',
    '::ffff:0.0.0.0',
    '::1',
    '2001:db8::1',
    '[::1]',
    '0',
    '00.0.0.0',
    '0.0.0.0',
    '256.1.1.1',
    '192.0.2',
    '192.0.2.4.5',
    '192.0.2.4.',
    '1..2.3',
    '0192.0.2.4',
    '192.0.2.1\n',
    '192.0.2.1 ',
    '192.0.2.1;x',
    'localhost',
    '',
  ];
  it.each(BAD_BINDS)('refuses NF_HUMAN_BIND %s before any compose call', (bind) => {
    const repo = makeRepo();
    const r = run(repo, { env: { NF_HUMAN_BIND: bind } });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('NF_HUMAN_BIND');
    expect(calls(repo).filter((l) => l.includes(' compose -p '))).toEqual([]);
  });

  it.each(['192.0.2.10', '127.0.0.1'])('accepts NF_HUMAN_BIND %s', (bind) => {
    const repo = makeRepo();
    expect(run(repo, { env: { NF_HUMAN_BIND: bind } }).status).toBe(0);
  });

  it.each(['25565', '25566', '46565', '025565', '1023', '65536', '0', '1', ''])(
    'refuses NF_HUMAN_PORT %s',
    (port) => {
      const repo = makeRepo();
      const r = run(repo, { env: { NF_HUMAN_PORT: port } });
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain('NF_HUMAN_PORT');
    },
  );

  it.each(['1024', '65535'])('accepts NF_HUMAN_PORT %s (the range ends)', (port) => {
    const repo = makeRepo();
    expect(run(repo, { env: { NF_HUMAN_PORT: port } }).status).toBe(0);
  });

  it('refuses an empty identity jar (zero bytes) before any compose call', () => {
    const repo = makeRepo();
    writeFileSync(
      join(repo, 'plugin', 'velocity-identity', 'build', 'libs', 'geldar-velocity-identity.jar'),
      '',
    );
    const r = run(repo);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('empty');
    expect(calls(repo).filter((l) => l.includes(' compose -p '))).toEqual([]);
  });

  it('stops only velocity-human when its up --wait fails, and exits non-zero', () => {
    const repo = makeRepo();
    const failing = [
      '#!/bin/sh',
      'echo "docker $*" >>"$STUB_LOG"',
      'case "$*" in *"up -d --wait velocity-human"*) exit 1 ;; esac',
      STUB_SCRIPTS.docker.split('\n').slice(2).join('\n'),
    ].join('\n');
    writeFileSync(join(repo, 'stubs', 'docker'), `${failing}\n`);
    const r = run(repo, { args: ['up', '--local'] });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('velocity-human is stopped');
    const all = calls(repo);
    const at = all.findIndex((l) => l.includes('up -d --wait velocity-human'));
    expect(at).toBeGreaterThan(-1);
    const after = all.slice(at + 1);
    expect(after).toHaveLength(1);
    expect(after[0]).toMatch(/ compose -p geldar-nf .* stop velocity-human$/);
  });

  it('human-down removes only velocity-human and velocity-human-init, with the overlay, and works with NF_HUMAN unset', () => {
    const repo = makeRepo({ human: false });
    const r = run(repo, { env: { NF_HUMAN: undefined }, args: ['human-down', '--local'] });
    expect(r.status).toBe(0);
    const compose = calls(repo).filter((l) => l.includes(' compose -p '));
    expect(compose).toHaveLength(1);
    expect(compose[0]).toMatch(/-f \S*compose\/nf-live-human\.yml/);
    expect(compose[0]).toMatch(/ rm -sf velocity-human velocity-human-init$/);
    // Exactly the two service names after rm -sf: no other service, no flag.
    expect(compose[0]?.split(' rm -sf ')[1]).toBe('velocity-human velocity-human-init');
  });

  // Off with a velocity-human container (multi-row, as docker ps prints the project): these verbs refuse before any compose call.
  const NO_HUMAN_ROWS = FIVE_ROWS.split('\n')
    .filter((l) => !l.includes('velocity-human'))
    .join('\n');
  const OFF = { NF_HUMAN: undefined, NF_HUMAN_BIND: undefined } as Record<
    string,
    string | undefined
  >;
  it.each([
    ['plan', ['plan', '--local']],
    ['up', ['up', '--local']],
    ['refresh-secrets', ['refresh-secrets', '--local']],
    ['probe', ['probe', '--local']],
  ])(
    'off refuses %s while a velocity-human container exists, naming both ways out, with no compose call',
    (_verb, args) => {
      const repo = makeRepo({ human: false });
      const res = run(repo, { env: OFF, rows: FIVE_ROWS, args });
      expect(res.status).not.toBe(0);
      expect(res.stderr).toContain('velocity-human container exists');
      expect(res.stderr).toContain('human-down');
      expect(res.stderr).toContain('NF_HUMAN=on');
      expect(calls(repo).filter((l) => l.startsWith('docker compose -p'))).toEqual([]);
    },
  );

  it.each([
    ['status', ['status', '--local']],
    ['logs', ['logs', 'velocity', '--local']],
    ['down', ['down', '--local']],
    ['human-down', ['human-down', '--local']],
  ])('off still runs %s with a velocity-human container present', (_verb, args) => {
    const repo = makeRepo({ human: false });
    expect(run(repo, { env: OFF, rows: FIVE_ROWS, args }).status).toBe(0);
  });

  it('off runs plan when no velocity-human container exists (the other project rows are not refused)', () => {
    const repo = makeRepo({ human: false });
    expect(run(repo, { env: OFF, rows: NO_HUMAN_ROWS, args: ['plan', '--local'] }).status).toBe(0);
  });

  it('off runs plan with an exited velocity-human-init row (the orphan guard counts only service velocity-human)', () => {
    const repo = makeRepo({ human: false });
    const rows = [...NO_HUMAN_ROWS.split('\n'), INIT_ROW].join('\n');
    const res = run(repo, { env: OFF, rows, args: ['plan', '--local'] });
    expect(res.status).toBe(0);
    expect(res.stderr).not.toContain('velocity-human container exists');
  });

  it('on passes the port gate with the exited init row present: the init row is not a listener or a velocity-human row', () => {
    const repo = makeRepo();
    const res = run(repo, {
      live: LISTEN_LIVE,
      human: LISTEN_HUMAN,
      rows: [FIVE_ROWS, INIT_ROW].join('\n'),
    });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('all gates passed');
  });

  it('plan with the lane on says the first on-run recreates nats, eventsink and neoforge, and that off is refused', () => {
    const repo = makeRepo();
    const res = run(repo, { args: ['plan', '--local'] });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('recreates nats, eventsink and neoforge');
    expect(res.stdout).toContain('An off-run is refused while velocity-human exists');
  });

  it('refuses NF_HUMAN=on when the deployed nats-auth.conf has no human user, before any compose call', () => {
    const repo = makeRepo();
    writeFileSync(join(repo, 'compose', 'secrets-nf', 'nats-auth.conf'), 'user: "velocity"\n');
    const res = run(repo, { args: ['plan', '--local'] });
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain('has no human user');
    expect(calls(repo).filter((l) => l.startsWith('docker compose -p'))).toEqual([]);
  });

  it('reports velocity-human could not be stopped when its stop fails too', () => {
    const repo = makeRepo();
    const failing = [
      '#!/bin/sh',
      'echo "docker $*" >>"$STUB_LOG"',
      'case "$*" in *"up -d --wait velocity-human"*|*"stop velocity-human"*) exit 1 ;; esac',
      STUB_SCRIPTS.docker.split('\n').slice(2).join('\n'),
    ].join('\n');
    writeFileSync(join(repo, 'stubs', 'docker'), `${failing}\n`);
    const r = run(repo, { args: ['up', '--local'] });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('could not be stopped');
  });

  it('accepts logs velocity-human with NF_HUMAN unset, through the human overlay', () => {
    const repo = makeRepo({ human: false });
    const r = run(repo, {
      env: { NF_HUMAN: undefined },
      args: ['logs', 'velocity-human', '--local'],
    });
    expect(r.status).toBe(0);
    const compose = calls(repo).filter((l) => l.includes(' compose -p '));
    expect(compose.at(-1)).toMatch(
      /-f \S*compose\/nf-live-human\.yml .*logs --tail 200 velocity-human$/,
    );
  });

  // G: a compose/.env entry must not reach docker. The script exports the validated port, so the child env carries it.
  it('passes the validated NF_HUMAN_PORT in the docker env, not the compose/.env value', () => {
    const repo = makeRepo();
    writeFileSync(join(repo, 'compose', '.env'), 'NF_HUMAN_PORT=47000\n');
    const logged = [
      '#!/bin/sh',
      'echo "docker $* PORT=$NF_HUMAN_PORT" >>"$STUB_LOG"',
      STUB_SCRIPTS.docker.split('\n').slice(2).join('\n'),
    ].join('\n');
    writeFileSync(join(repo, 'stubs', 'docker'), `${logged}\n`);
    const r = run(repo, { env: { NF_HUMAN_PORT: undefined }, args: ['up', '--local'] });
    expect(r.status).toBe(0);
    const compose = calls(repo).filter((l) => l.startsWith('docker compose -p'));
    expect(compose.length).toBeGreaterThan(0);
    for (const line of compose) expect(line).toMatch(/PORT=46566$/);
  });
});
