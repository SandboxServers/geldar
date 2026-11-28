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

const LIVE_ROW = 'geldar-nf|velocity|127.0.0.1:46565->25565/tcp';

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

// The fixture tree: the script, the rangers lib, the real overlay, the secrets (the four ranger files and nats-auth.conf with both
// rangers users), the shard file and the stubs. opts.shard false omits shards/nf-mind.yaml.
function makeRepo(opts: { shard?: boolean } = {}): string {
  const repo = mkdtempSync(join(tmpdir(), 'nf-rangers-'));
  made.push(repo);
  for (const dir of ['deploy', 'compose/secrets-nf', 'compose/neoforge', 'shards', 'stubs']) {
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
  for (const f of SECRET_FILES) {
    const body = f === 'nats-auth.conf' ? RANGER_CONF : `${f}\n`;
    writeFileSync(join(repo, 'compose', 'secrets-nf', f), body);
  }
  writeFileSync(join(repo, 'compose', 'neoforge', 'neoforge-entrypoint.sh'), '#!/bin/sh\n');
  if (opts.shard ?? true) writeFileSync(join(repo, 'shards', 'nf-mind.yaml'), 'rangers: fixture\n');
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

  it('on adds the rangers overlay to the rendered file set', () => {
    const repo = makeRepo();
    const res = run(repo);
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/rangers lane on/);
    const compose = calls(repo).filter((l) => l.startsWith('docker compose -p'));
    expect(compose.length).toBeGreaterThan(0);
    for (const line of compose) expect(line).toMatch(RANGERS_CALL);
  });
});
