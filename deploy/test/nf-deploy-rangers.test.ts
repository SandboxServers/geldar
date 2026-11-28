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

// The NF_RANGERS cases of deploy/nf-deploy.sh: the overlay (compose/nf-live-rangers.yml), the refusals of the lane's inputs, and
// the byte-identical calls when the lane is off. The fixture tree and stubs follow nf-deploy-human.test.ts (the same stub contract).
vi.setConfig({ testTimeout: 120000 });

const DEPLOY = fileURLToPath(new URL('..', import.meta.url));
const ROOT = resolve(DEPLOY, '..');
const SCRIPT_SRC = resolve(DEPLOY, 'nf-deploy.sh');
const RANGERS_LIB_SRC = resolve(DEPLOY, 'nf-rangers-lib.sh');
const SCRIPT_TEXT = readFileSync(SCRIPT_SRC, 'utf8');
const SECRET_FILES = /^SECRET_FILES="([^"]+)"$/m.exec(SCRIPT_TEXT)?.[1].split(' ') ?? [];
// The four ranger files: required only with NF_RANGERS=on, so they are read from the lib, not from SECRET_FILES.
const RANGER_SECRETS =
  /^RANGER_SECRETS="([^"]+)"$/m.exec(readFileSync(RANGERS_LIB_SRC, 'utf8'))?.[1].split(' ') ?? [];
const JAR_BYTES = 'geldar neoforge mod fixture\n';
const MOD_SHA = createHash('sha256').update(JAR_BYTES).digest('hex');
const RANGER_CONF =
  'user: "ranger", permissions: { publish: { allow: ["ranger.>"] } }\n' +
  'user: "mcp", permissions: { publish: { allow: ["mcp.>"] } }\n';

const STUB_SCRIPTS: Record<string, string> = {
  // Logs every call. ps answers the fixture rows for the service-label format and nothing for the labels format.
  docker: [
    '#!/bin/sh',
    'echo "docker $*" >>"$STUB_LOG"',
    'case "$1" in',
    '  ps) case "$*" in *compose.service*) printf "%s\\n" "$DOCKER_PS_ROWS" ;; esac; exit 0 ;;',
    '  compose) case "$*" in *" ps "*) printf "%s\\n" "$COMPOSE_PS" ;; esac; exit 0 ;;',
    '  volume) exit 0 ;;',
    '  run) exit 0 ;;',
    'esac',
    'exit 0',
  ].join('\n'),
  // The listener of each host port: 46565 is the live velocity port, 46566 the human port, 46788 the rangers' geldar-mcp.
  ss: [
    '#!/bin/sh',
    'case "$*" in',
    '  *46565*) [ -n "$SS_LIVE" ] && printf "%s\\n" "$SS_LIVE" ;;',
    '  *46566*) [ -n "$SS_HUMAN" ] && printf "%s\\n" "$SS_HUMAN" ;;',
    '  *46788*) [ -n "$SS_RANGERS" ] && printf "%s\\n" "$SS_RANGERS" ;;',
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

const LIVE_ROW = 'geldar-nf|velocity|127.0.0.1:46565->25565/tcp';
// geldar-mcp's own mapping (container port 8788), the listener the rangers port check reads, and a healthy project for refresh.
const MCP_ROW = 'geldar-nf|geldar-mcp|127.0.0.1:46788->8788/tcp';
const RANGERS_SS = 'LISTEN 0 4096 127.0.0.1:46788 0.0.0.0:*';
const UP_PS = [
  'nats running healthy',
  'postgres running healthy',
  'velocity running healthy',
  'eventsink running ',
  'neoforge running healthy',
  'identity-seed exited 0',
].join('\n');

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

// The fixture tree: the script, the rangers lib, the real overlay, the secrets (the four ranger files and nats-auth.conf with both
// rangers users), the shard file and the stubs. opts.shard false omits shards/nf-mind.yaml.
function makeRepo(opts: { shard?: boolean; golemConfig?: string } = {}): string {
  const repo = mkdtempSync(join(tmpdir(), 'nf-rangers-'));
  made.push(repo);
  for (const dir of [
    'deploy',
    'compose/secrets-nf',
    'compose/neoforge',
    'shards',
    'stubs',
    'golem/src',
  ]) {
    mkdirSync(join(repo, dir), { recursive: true });
  }
  copyFileSync(
    join(ROOT, 'compose', 'neoforge', 'extra-mods.pins'),
    join(repo, 'compose', 'neoforge', 'extra-mods.pins'),
  );
  copyFileSync(SCRIPT_SRC, join(repo, 'deploy', 'nf-deploy.sh'));
  copyFileSync(RANGERS_LIB_SRC, join(repo, 'deploy', 'nf-rangers-lib.sh'));
  copyFileSync(resolve(DEPLOY, 'nf-human-lib.sh'), join(repo, 'deploy', 'nf-human-lib.sh'));
  copyFileSync(
    resolve(DEPLOY, 'nf-extra-mods-lib.sh'),
    join(repo, 'deploy', 'nf-extra-mods-lib.sh'),
  );
  for (const f of ['nf-live.yml', 'nf-live-rangers.yml']) {
    copyFileSync(join(ROOT, 'compose', f), join(repo, 'compose', f));
  }
  for (const f of [...SECRET_FILES, ...RANGER_SECRETS]) {
    const body = f === 'nats-auth.conf' ? RANGER_CONF : `${f}\n`;
    writeFileSync(join(repo, 'compose', 'secrets-nf', f), body);
  }
  writeFileSync(join(repo, 'compose', 'neoforge', 'neoforge-entrypoint.sh'), '#!/bin/sh\n');
  if (opts.shard ?? true) writeFileSync(join(repo, 'shards', 'nf-mind.yaml'), 'rangers: fixture\n');
  // The P1 prerequisite the rangers check reads: golem/src/config.ts must carry the string neoforge.
  writeFileSync(
    join(repo, 'golem', 'src', 'config.ts'),
    opts.golemConfig ?? "export const runtime = 'neoforge';\n",
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

interface Opts {
  env?: Record<string, string | undefined>;
  rows?: string;
  args?: string[];
}

// Runs the script in the fixture with the stubs first on PATH. A key set to undefined is removed from the environment.
function run(repo: string, opts: Opts = {}) {
  const env: Record<string, string> = {
    PATH: `${join(repo, 'stubs')}${delimiter}${process.env.PATH ?? ''}`,
    STUB_LOG: join(repo, 'calls.log'),
    DOCKER_PS_ROWS: opts.rows ?? LIVE_ROW,
    SS_LIVE: '',
    SS_HUMAN: '',
    SS_RANGERS: '',
    COMPOSE_PS: UP_PS,
    FREE_KB: '100000000',
    DISK_KB: '100000000',
    STAT_MODE: '600',
    STAT_UID: '1000',
    NF_MOD_JAR_HOST: join(repo, 'mod.jar'),
    NF_MOD_SHA256: MOD_SHA,
    NF_SECRETS_DIR: join(repo, 'compose', 'secrets-nf'),
    NF_RANGERS: 'on',
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
const RANGERS_CALL = /-f \S*compose\/nf-live-rangers\.yml/;

describe('nf-deploy.sh rangers lane (NF_RANGERS)', () => {
  it('off (unset) adds no rangers overlay: compose is called with the base file only', () => {
    const repo = makeRepo();
    const res = run(repo, { env: { NF_RANGERS: undefined } });
    expect(res.status).toBe(0);
    const compose = calls(repo).filter((l) => l.startsWith('docker compose -p'));
    expect(compose).toHaveLength(1);
    expect(compose[0]).toMatch(
      /^docker compose -p geldar-nf -f \S*compose\/nf-live\.yml config --quiet$/,
    );
  });

  it('off (explicit) is the same as unset', () => {
    const repo = makeRepo();
    const res = run(repo, { env: { NF_RANGERS: 'off' } });
    expect(res.status).toBe(0);
    expect(calls(repo).some((l) => RANGERS_CALL.test(l))).toBe(false);
  });

  it('off refuses while a ranger or geldar-mcp container exists (no compose call)', () => {
    const repo = makeRepo();
    const res = run(repo, { env: { NF_RANGERS: undefined }, rows: `${LIVE_ROW}\nranger-red` });
    expect(res.status).not.toBe(0);
    expect(res.stderr).toMatch(/a rangers container exists/);
    // check_operator runs `docker compose version` (not project-scoped); no project compose call (dc) may run.
    expect(calls(repo).some((l) => l.startsWith('docker compose -p'))).toBe(false);
  });

  it('an unknown value is refused', () => {
    const repo = makeRepo();
    const res = run(repo, { env: { NF_RANGERS: 'maybe' } });
    expect(res.status).not.toBe(0);
    expect(res.stderr).toMatch(/NF_RANGERS must be on or off/);
  });

  it('a missing ranger secret is refused', () => {
    const repo = makeRepo();
    rmSync(join(repo, 'compose', 'secrets-nf', 'mcp-token-pepper.txt'));
    const res = run(repo);
    expect(res.status).not.toBe(0);
    expect(res.stderr).toMatch(/mcp-token-pepper\.txt is missing or empty/);
  });

  it('a ranger secret with mode 0644 is refused', () => {
    const repo = makeRepo();
    const res = run(repo, { env: { STAT_MODE: '644' } });
    expect(res.status).not.toBe(0);
    expect(res.stderr).toMatch(/must be mode 0600 \(it is 644\)/);
  });

  it('a deployed nats-auth.conf without the ranger user is refused', () => {
    const repo = makeRepo();
    writeFileSync(
      join(repo, 'compose', 'secrets-nf', 'nats-auth.conf'),
      'user: "mcp", permissions: { publish: { allow: ["mcp.>"] } }\n',
    );
    const res = run(repo);
    expect(res.status).not.toBe(0);
    expect(res.stderr).toMatch(/no single ranger user/);
  });

  it('a missing shards/nf-mind.yaml is refused', () => {
    const repo = makeRepo({ shard: false });
    const res = run(repo);
    expect(res.status).not.toBe(0);
    expect(res.stderr).toMatch(/shards\/nf-mind\.yaml is missing/);
  });

  it('a golem/src/config.ts without the string neoforge is refused (P1 prerequisite)', () => {
    const repo = makeRepo({ golemConfig: "export const runtime = 'paper';\n" });
    const res = run(repo);
    expect(res.status).not.toBe(0);
    expect(res.stderr).toMatch(/golem\/src\/config\.ts .* does not contain 'neoforge'/);
    expect(calls(repo).some((l) => l.startsWith('docker compose -p'))).toBe(false);
  });

  it('a missing golem/src/config.ts is refused (P1 prerequisite)', () => {
    const repo = makeRepo();
    rmSync(join(repo, 'golem', 'src', 'config.ts'));
    const res = run(repo);
    expect(res.status).not.toBe(0);
    expect(res.stderr).toMatch(/golem\/src\/config\.ts .* does not contain 'neoforge'/);
  });

  it('a golem/src/config.ts with the string neoforge passes the check', () => {
    const repo = makeRepo({ golemConfig: "export const runtime = 'neoforge';\n" });
    const res = run(repo);
    expect(res.status).toBe(0);
    expect(res.stderr).not.toMatch(/does not contain 'neoforge'/);
  });

  it('probe refuses while a ranger exists, says rangers-down comes first, and runs no compose call', () => {
    const repo = makeRepo();
    const res = run(repo, { rows: `${LIVE_ROW}\nranger-red`, args: ['probe', '--local'] });
    expect(res.status).not.toBe(0);
    expect(res.stderr).toMatch(/the probe needs rangers-down first/);
    expect(res.stderr).not.toMatch(/keeps them/);
    expect(calls(repo).some((l) => l.startsWith('docker compose -p'))).toBe(false);
  });

  it('probe with NF_RANGERS=banana is refused by the switch, not silently run without the rangers list', () => {
    const repo = makeRepo();
    const res = run(repo, { env: { NF_RANGERS: 'banana' }, args: ['probe', '--local'] });
    expect(res.status).not.toBe(0);
    // The refusal is the whole output: a subshell-only die would let the probe run on to a later refusal.
    expect(res.stderr.trim()).toMatch(/^[^\n]*NF_RANGERS must be on or off[^\n]*$/);
    expect(calls(repo).some((l) => l.startsWith('docker compose -p'))).toBe(false);
  });

  it('on adds the rangers overlay to the rendered file set', () => {
    const repo = makeRepo();
    const res = run(repo);
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/rangers lane on/);
    const compose = calls(repo).filter((l) => l.startsWith('docker compose -p'));
    expect(compose.length).toBeGreaterThan(0);
    for (const line of compose) expect(line).toMatch(RANGERS_CALL);
  });

  // probe and refresh-secrets run the same off-refusal as up: a ranger container left in the project must stop them before any
  // project compose call (an off-run would leave the Bodies running with no overlay).
  it.each(['probe', 'refresh-secrets'])(
    'off refuses %s while a ranger container exists (no project compose call)',
    (verb) => {
      const repo = makeRepo();
      const res = run(repo, {
        env: { NF_RANGERS: undefined },
        rows: `${LIVE_ROW}\nranger-red`,
        args: [verb],
      });
      expect(res.status).not.toBe(0);
      expect(res.stderr).toMatch(/a rangers container exists/);
      expect(calls(repo).some((l) => l.startsWith('docker compose -p'))).toBe(false);
    },
  );

  it('the port check accepts geldar-mcp on 127.0.0.1:46788 with its mapping 8788/tcp', () => {
    const repo = makeRepo();
    const res = run(repo, { env: { SS_RANGERS: RANGERS_SS }, rows: `${LIVE_ROW}\n${MCP_ROW}` });
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/all gates passed/);
  });

  it('the port check refuses a 46788 listener whose mapping is not 127.0.0.1:46788->8788/tcp', () => {
    const repo = makeRepo();
    const res = run(repo, {
      env: { SS_RANGERS: RANGERS_SS },
      rows: `${LIVE_ROW}\ngeldar-nf|geldar-mcp|127.0.0.1:46788->25565/tcp`,
    });
    expect(res.status).not.toBe(0);
    expect(res.stderr).toMatch(/published mapping is not exactly 127\.0\.0\.1:46788->8788\/tcp/);
  });

  it('the ranger secret files are required only with NF_RANGERS=on', () => {
    const repo = makeRepo();
    for (const f of RANGER_SECRETS) rmSync(join(repo, 'compose', 'secrets-nf', f));
    const off = run(repo, { env: { NF_RANGERS: undefined } });
    expect(off.status).toBe(0);
    const on = run(repo);
    expect(on.status).not.toBe(0);
    expect(on.stderr).toMatch(/is missing or empty in the NF secrets directory/);
  });

  it('the memory gate adds the rangers caps (2816 MiB) only with NF_RANGERS=on', () => {
    // Off needs 16640 + 8192 = 24832 MiB; on needs 24832 + 2816 = 27648 MiB.
    const repo = makeRepo();
    const env = { FREE_KB: String(26000 * 1024) };
    const on = run(repo, { env });
    expect(on.status).not.toBe(0);
    expect(on.stderr).toMatch(/free RAM 26000 MiB is below 27648 MiB/);
    const off = run(repo, { env: { ...env, NF_RANGERS: undefined } });
    expect(off.status).toBe(0);
  });

  it('plan prints the rangers step with NF_RANGERS=on and no longer says players-host is never started', () => {
    const repo = makeRepo();
    const on = run(repo);
    expect(on.status).toBe(0);
    expect(on.stdout).toMatch(
      /rangers \(NF_RANGERS=on.*up -d --wait --no-deps geldar-mcp and the five/,
    );
    expect(on.stdout).not.toMatch(/players-host[^\n]*never started/);
    const off = run(repo, { env: { NF_RANGERS: undefined } });
    expect(off.stdout).not.toMatch(/geldar-mcp/);
  });

  it('up with NF_RANGERS=on runs geldar-mcp and the five Bodies with --no-deps and names no other service', () => {
    const repo = makeRepo();
    const res = run(repo, { args: ['up', '--local'] });
    expect(res.status).toBe(0);
    const lines = calls(repo).filter((l) => / up -d --wait --no-deps geldar-mcp /.test(l));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(
      / up -d --wait --no-deps geldar-mcp ranger-yellow ranger-green ranger-blue ranger-red ranger-pink$/,
    );
  });

  it('rangers-down removes geldar-mcp and the five Bodies with rm -sf and never runs down', () => {
    const repo = makeRepo();
    const res = run(repo, { env: { NF_RANGERS: undefined }, args: ['rangers-down', '--local'] });
    expect(res.status).toBe(0);
    const compose = calls(repo).filter((l) => l.startsWith('docker compose -p'));
    expect(compose).toHaveLength(1);
    expect(compose[0]).toMatch(
      / rm -sf ranger-yellow ranger-green ranger-blue ranger-red ranger-pink geldar-mcp$/,
    );
    expect(compose.some((l) => / down( |$)/.test(l))).toBe(false);
  });

  it('down with NF_RANGERS off refuses while a ranger container exists (no down call)', () => {
    const repo = makeRepo();
    const res = run(repo, {
      env: { NF_RANGERS: undefined },
      rows: `${LIVE_ROW}\nranger-red`,
      args: ['down', '--local'],
    });
    expect(res.status).not.toBe(0);
    expect(res.stderr).toMatch(/a rangers container exists/);
    expect(calls(repo).some((l) => / down( |$)/.test(l))).toBe(false);
  });

  it('refresh-secrets with NF_RANGERS=on force-recreates geldar-mcp and the five Bodies after neoforge', () => {
    const repo = makeRepo();
    const res = run(repo, { args: ['refresh-secrets', '--local'] });
    expect(res.status).toBe(0);
    const compose = calls(repo).filter((l) => l.startsWith('docker compose -p'));
    const mcp = compose.findIndex((l) =>
      / up -d --wait --force-recreate --no-deps geldar-mcp ranger-yellow ranger-green ranger-blue ranger-red ranger-pink$/.test(
        l,
      ),
    );
    const neoforge = compose.findIndex((l) =>
      / up -d --wait --force-recreate --no-deps neoforge$/.test(l),
    );
    expect(mcp).toBeGreaterThan(-1);
    expect(mcp).toBeGreaterThan(neoforge);
  });

  it('refresh-secrets with NF_RANGERS off recreates no ranger service', () => {
    const repo = makeRepo();
    const res = run(repo, { env: { NF_RANGERS: undefined }, args: ['refresh-secrets', '--local'] });
    expect(res.status).toBe(0);
    expect(calls(repo).some((l) => /geldar-mcp|ranger-yellow/.test(l))).toBe(false);
  });
});
