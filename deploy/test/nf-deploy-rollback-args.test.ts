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

// The compose arguments deploy/nf-deploy.sh records for each NF_TELEMETRY mode: the base file always, then the one overlay the
// mode adds (off: compose/nf-live-telemetry-off.yml; on: compose/nf-live-telemetry.yml; unset: none). The stub docker logs every
// call, so these cases read the arguments compose would receive. The fixture harness mirrors deploy/test/nf-deploy-telemetry.test.ts.
vi.setConfig({ testTimeout: 120000 });

const DEPLOY = fileURLToPath(new URL('..', import.meta.url));
const ROOT = resolve(DEPLOY, '..');
const SCRIPT_SRC = resolve(DEPLOY, 'nf-deploy.sh');
const HUMAN_LIB_SRC = resolve(DEPLOY, 'nf-human-lib.sh');
const SCRIPT_TEXT = readFileSync(SCRIPT_SRC, 'utf8');
const NF_COMPOSE_TEXT = readFileSync(resolve(ROOT, 'compose', 'nf-live.yml'), 'utf8');
const NF_OVERLAY_TEXT = readFileSync(resolve(ROOT, 'compose', 'nf-live-telemetry.yml'), 'utf8');
const NF_OFF_TEXT = readFileSync(resolve(ROOT, 'compose', 'nf-live-telemetry-off.yml'), 'utf8');
const SECRET_FILES = /^SECRET_FILES="([^"]+)"$/m.exec(SCRIPT_TEXT)?.[1].split(' ') ?? [];
const JAR_BYTES = 'geldar neoforge mod fixture\n';
const TARBALL_BYTES = 'bundle tarball fixture\n';
const LEDGER_BYTES = 'ledger jar fixture\n';
const AGENT_BYTES = 'agent jar fixture\n';
const PROPS_BYTES = 'properties fixture\n';
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const MOD_SHA = sha(JAR_BYTES);
const TARBALL_SHA = sha(TARBALL_BYTES);

const STUB_SCRIPTS: Record<string, string> = {
  docker: [
    '#!/bin/sh',
    'echo "docker $*" >>"$STUB_LOG"',
    'case "$1" in',
    '  ps) printf "%s\\n" "$DOCKER_LABELS"; exit 0 ;;',
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
  tar: ['#!/bin/sh', 'echo "tar $*" >>"$STUB_LOG"', 'exit 0'].join('\n'),
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

// A fixture tree: the script, the compose files, the entrypoint string that on requires, the eight secret files and the mod jar.
function makeRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), 'nf-rollback-args-'));
  made.push(repo);
  mkdirSync(join(repo, 'deploy'), { recursive: true });
  mkdirSync(join(repo, 'compose', 'secrets-nf'), { recursive: true });
  mkdirSync(join(repo, 'compose', 'neoforge'), { recursive: true });
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
  writeFileSync(join(repo, 'compose', 'nf-live-telemetry-off.yml'), NF_OFF_TEXT);
  writeFileSync(
    join(repo, 'compose', 'neoforge', 'neoforge-entrypoint.sh'),
    '#!/bin/sh\n# fixture: reads GELDAR_NF_TELEMETRY\n',
  );
  for (const f of SECRET_FILES)
    writeFileSync(join(repo, 'compose', 'secrets-nf', f), `${f} fixture\n`);
  writeFileSync(join(repo, 'mod.jar'), JAR_BYTES);
  writeFileSync(join(repo, 'bundle-tarball.tar.gz'), TARBALL_BYTES);
  for (const [name, body] of Object.entries(STUB_SCRIPTS)) {
    const path = join(repo, 'stubs', name);
    writeFileSync(path, `${body}\n`);
    chmodSync(path, 0o755);
  }
  writeFileSync(join(repo, 'calls.log'), '');
  return repo;
}

// The script takes absolute paths: on Windows the fixture paths go in with forward slashes.
const fwd = (p: string): string => p.replace(/\\/g, '/');

function telemetryInputs(repo: string): Record<string, string> {
  writeFileSync(join(repo, 'ledger.jar'), LEDGER_BYTES);
  writeFileSync(join(repo, 'agent.jar'), AGENT_BYTES);
  writeFileSync(join(repo, 'otel-agent.properties'), PROPS_BYTES);
  writeFileSync(join(repo, 'ledger.properties'), PROPS_BYTES);
  const overlay = join(repo, 'compose', 'nf-live-telemetry.yml');
  writeFileSync(
    overlay,
    readFileSync(overlay, 'utf8').replace(/e43a270d[0-9a-f]{56}/, sha(AGENT_BYTES)),
  );
  return {
    NF_TELEMETRY: 'on',
    NF_LEDGER_JAR_HOST: fwd(join(repo, 'ledger.jar')),
    NF_LEDGER_SHA256: sha(LEDGER_BYTES),
    NF_OTEL_AGENT_HOST: fwd(join(repo, 'agent.jar')),
    NF_OTEL_AGENT_PROPS_HOST: fwd(join(repo, 'otel-agent.properties')),
    NF_LEDGER_PROPS_HOST: fwd(join(repo, 'ledger.properties')),
  };
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
    VOLUME_MISSING: '0',
    VOLUME_CONTENT: '',
    MARKER_STATUS: '0',
    FREE_KB: '40000000',
    DISK_KB: '200000000',
    STAT_MODE: '600',
    STAT_UID: '1000',
    DOCKER_LABELS: '',
    SS_BUSY: '0',
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

// The compose calls only (the docker ps, volume and network reads are not compose).
function composeCalls(repo: string): string[] {
  return readFileSync(join(repo, 'calls.log'), 'utf8')
    .split('\n')
    .filter((c) => c.startsWith('docker compose -p '));
}

afterEach(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
  made = [];
});

// The base file, then the overlay, as adjacent -f arguments (paths may use either slash on Windows).
const BASE_THEN_OFF = /-f \S*compose[\\/]nf-live\.yml -f \S*compose[\\/]nf-live-telemetry-off\.yml/;
const BASE_THEN_ON = /-f \S*compose[\\/]nf-live\.yml -f \S*compose[\\/]nf-live-telemetry\.yml/;
const ANY_OVERLAY = /nf-live-telemetry/;
const OFF_OVERLAY = /nf-live-telemetry-off\.yml/;

describe('nf-deploy.sh compose arguments by NF_TELEMETRY mode', () => {
  it.each(['plan', 'up'])(
    'NF_TELEMETRY=off %s records the base file, then the off overlay',
    (verb) => {
      const repo = makeRepo();
      expect(run(repo, [verb], { NF_TELEMETRY: 'off' }).status).toBe(0);
      const all = composeCalls(repo);
      expect(all.length).toBeGreaterThan(0);
      for (const c of all) {
        expect(c).toMatch(BASE_THEN_OFF);
        expect(c).not.toMatch(/nf-live-telemetry\.yml/);
      }
    },
  );

  it.each(['plan', 'up'])('unset NF_TELEMETRY %s records the base file only', (verb) => {
    const repo = makeRepo();
    expect(run(repo, [verb]).status).toBe(0);
    const all = composeCalls(repo);
    expect(all.length).toBeGreaterThan(0);
    for (const c of all) expect(c).not.toMatch(ANY_OVERLAY);
  });

  it('NF_TELEMETRY=on records the telemetry overlay after the base file and never the off overlay', () => {
    const repo = makeRepo();
    expect(run(repo, ['plan'], telemetryInputs(repo)).status).toBe(0);
    const all = composeCalls(repo);
    expect(all.length).toBeGreaterThan(0);
    for (const c of all) {
      expect(c).toMatch(BASE_THEN_ON);
      expect(c).not.toMatch(OFF_OVERLAY);
    }
  });

  it.each(['yes', 'OFF', 'none'])(
    'an invalid NF_TELEMETRY=%s is refused with no compose call recorded',
    (value) => {
      const repo = makeRepo();
      const r = run(repo, ['plan'], { NF_TELEMETRY: value });
      expect(r.status).toBe(1);
      expect(r.out).toContain('NF_TELEMETRY must be on or off');
      expect(composeCalls(repo)).toEqual([]);
    },
  );
});
