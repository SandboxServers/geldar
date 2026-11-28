import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The NF_TELEMETRY=on cases of deploy/nf-deploy.sh. The fixture helpers mirror deploy/test/nf-deploy.test.ts (the same stubs,
// the same fixture tree); the base cases stay in that file.
vi.setConfig({ testTimeout: 120000 });

const DEPLOY = fileURLToPath(new URL('..', import.meta.url));
const ROOT = resolve(DEPLOY, '..');
const SCRIPT_SRC = resolve(DEPLOY, 'nf-deploy.sh');
const HUMAN_LIB_SRC = resolve(DEPLOY, 'nf-human-lib.sh');
const SCRIPT_TEXT = readFileSync(SCRIPT_SRC, 'utf8');
const NF_COMPOSE_TEXT = readFileSync(resolve(ROOT, 'compose', 'nf-live.yml'), 'utf8');
const NF_OVERLAY_TEXT = readFileSync(resolve(ROOT, 'compose', 'nf-live-telemetry.yml'), 'utf8');
const SECRET_FILES = /^SECRET_FILES="([^"]+)"$/m.exec(SCRIPT_TEXT)?.[1].split(' ') ?? [];
const JAR_BYTES = 'geldar neoforge mod fixture\n';
const LIST_BYTES = 'bundle list fixture\n';
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const MOD_SHA = sha(JAR_BYTES);
const TARBALL_BYTES = 'bundle tarball fixture\n';
const TARBALL_SHA = sha(TARBALL_BYTES);
const GOOD_NAMES = ['mods/', 'mods/geldar.jar', '.geldar-bundle.sha256'];
const GOOD_VERBOSE = [
  'drwxr-xr-x 0/0 0 2026-11-01 10:00 mods/',
  '-rw-r--r-- 0/0 12 2026-11-01 10:00 mods/geldar.jar',
  '-rw-r--r-- 0/0 30 2026-11-01 10:00 .geldar-bundle.sha256',
];
const STUB_SCRIPTS: Record<string, string> = {
  // Logs the call. info, ps and config answer from the environment; everything else succeeds.
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
  // The archive listings come from fixture files (names, and names with types), so no test depends on the host tar.
  tar: [
    '#!/bin/sh',
    'echo "tar $*" >>"$STUB_LOG"',
    'case "$*" in',
    '  *-tzvf*) cat "$TAR_VERBOSE" ;;',
    '  *-tzf*) cat "$TAR_NAMES" ;;',
    '  *) exit 0 ;;',
    'esac',
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

// Creating a symlink needs Developer Mode or elevation on Windows: the probe makes the symlink case skip there, not fail.
const canSymlink = (() => {
  const dir = mkdtempSync(join(tmpdir(), 'nf-link-probe-'));
  try {
    symlinkSync(join(dir, 'target'), join(dir, 'link'));
    return true;
  } catch {
    return false;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
})();

let made: string[] = [];

// A fixture tree: the script, compose/nf-live.yml and the overlay, the eight secret files, the mod jar and the bundle list.
function makeRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), 'nf-deploy-'));
  made.push(repo);
  mkdirSync(join(repo, 'deploy'), { recursive: true });
  mkdirSync(join(repo, 'compose', 'secrets-nf'), { recursive: true });
  mkdirSync(join(repo, 'compose', 'neoforge'), { recursive: true });
  mkdirSync(join(repo, 'stubs'));
  mkdirSync(join(repo, 'bundle'));
  copyFileSync(SCRIPT_SRC, join(repo, 'deploy', 'nf-deploy.sh'));
  copyFileSync(HUMAN_LIB_SRC, join(repo, 'deploy', 'nf-human-lib.sh'));
  copyFileSync(resolve(DEPLOY, 'nf-rangers-lib.sh'), join(repo, 'deploy', 'nf-rangers-lib.sh'));
  copyFileSync(
    resolve(DEPLOY, 'nf-extra-mods-lib.sh'),
    join(repo, 'deploy', 'nf-extra-mods-lib.sh'),
  );
  writeFileSync(join(repo, 'compose', 'nf-live.yml'), NF_COMPOSE_TEXT);
  writeFileSync(join(repo, 'compose', 'nf-live-telemetry.yml'), NF_OVERLAY_TEXT);
  // The fixture entrypoint carries the GELDAR_NF_TELEMETRY string that on requires (the real one lands with PR #701).
  writeFileSync(
    join(repo, 'compose', 'neoforge', 'neoforge-entrypoint.sh'),
    '#!/bin/sh\n# fixture: reads GELDAR_NF_TELEMETRY\n',
  );
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
  writeFileSync(join(repo, 'bundle-tarball.tar.gz'), TARBALL_BYTES);
  writeListing(repo, GOOD_NAMES, GOOD_VERBOSE);
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
    NF_BUNDLE_TARBALL: join(repo, 'bundle-tarball.tar.gz'),
    NF_BUNDLE_TARBALL_SHA256: TARBALL_SHA,
    TAR_NAMES: join(repo, 'archive-names.txt'),
    TAR_VERBOSE: join(repo, 'archive-verbose.txt'),
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

// The archive listing the tar stub prints: names (tar -tzf) and names with entry types (tar -tzvf).
function writeListing(repo: string, names: string[], verbose: string[]): void {
  writeFileSync(join(repo, 'archive-names.txt'), `${names.join('\n')}\n`);
  writeFileSync(join(repo, 'archive-verbose.txt'), `${verbose.join('\n')}\n`);
}

afterEach(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
  made = [];
});

// Telemetry (NF_TELEMETRY=on). The real agent jar cannot be a fixture, so the fixture's own copy of the overlay gets the fixture
// agent's sha256 as its pin. The real 2.33.1 constant is asserted by tools/repo-checks/src/nf-live-telemetry.test.ts.
const LEDGER_BYTES = 'ledger jar fixture\n';
const AGENT_BYTES = 'agent jar fixture\n';
const PROPS_BYTES = 'properties fixture\n';

// The script takes absolute paths: on Windows the fixture paths are drive-letter paths, so they go in with forward slashes.
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

// The inputs with one variable unset: the script reads an unset variable as empty.
function without(env: Record<string, string>, key: string): Record<string, string> {
  return Object.fromEntries(Object.entries(env).filter(([k]) => k !== key));
}

describe('nf-deploy.sh telemetry (NF_TELEMETRY)', () => {
  it('off (unset) adds no overlay and makes no network call', () => {
    const repo = makeRepo();
    expect(run(repo, ['up']).status).toBe(0);
    expect(composeCalls(repo).length).toBeGreaterThan(0);
    expect(composeCalls(repo).some((c) => c.includes('nf-live-telemetry'))).toBe(false);
    expect(calls(repo).some((c) => c.startsWith('docker network'))).toBe(false);
  });

  it('on adds the overlay after the base file to every compose call', () => {
    const repo = makeRepo();
    expect(run(repo, ['up'], telemetryInputs(repo)).status).toBe(0);
    const all = composeCalls(repo);
    expect(all.length).toBeGreaterThan(0);
    for (const c of all) expect(c).toMatch(/ -f \S*nf-live\.yml -f \S*nf-live-telemetry\.yml /);
    expect(calls(repo)).toContain('docker network inspect geldar-telemetry');
  });

  // Each refusal names its message and runs before any docker call: calls.log stays empty, so nothing starts.
  const refusals: [string, (repo: string) => Record<string, string>, string][] = [
    ['NF_TELEMETRY=yes', () => ({ NF_TELEMETRY: 'yes' }), 'NF_TELEMETRY must be on or off'],
    [
      'a ledger sha256 not 64 lowercase hex',
      (r) => ({ ...telemetryInputs(r), NF_LEDGER_SHA256: 'ABC' }),
      'NF_LEDGER_SHA256 must be 64',
    ],
    [
      'a relative host path',
      (r) => ({ ...telemetryInputs(r), NF_OTEL_AGENT_PROPS_HOST: 'otel.properties' }),
      'must be an absolute path',
    ],
    [
      'a host path with whitespace',
      (r) => {
        const env = telemetryInputs(r);
        copyFileSync(join(r, 'ledger.jar'), join(r, 'my ledger.jar'));
        return { ...env, NF_LEDGER_JAR_HOST: fwd(join(r, 'my ledger.jar')) };
      },
      'has whitespace',
    ],
    [
      'an OTel agent jar that is not the pinned agent',
      (r) => {
        const env = telemetryInputs(r);
        writeFileSync(join(r, 'agent.jar'), 'a different agent jar\n');
        return env;
      },
      'not the pinned agent',
    ],
    ['NF_TELEMETRY is empty', () => ({ NF_TELEMETRY: '' }), 'NF_TELEMETRY must be on or off'],
    [
      'a ledger jar path with a dollar',
      (r) => ({ ...telemetryInputs(r), NF_LEDGER_JAR_HOST: '/no/such/dir$x/ledger.jar' }),
      'has whitespace, a quote, a backslash or a dollar',
    ],
    [
      'a ledger jar path with a single quote',
      (r) => ({ ...telemetryInputs(r), NF_LEDGER_JAR_HOST: "/no/such/it's/ledger.jar" }),
      'has whitespace, a quote, a backslash or a dollar',
    ],
    [
      'a ledger jar path with a double quote',
      (r) => ({ ...telemetryInputs(r), NF_LEDGER_JAR_HOST: '/no/such/dir"x/ledger.jar' }),
      'has whitespace, a quote, a backslash or a dollar',
    ],
    [
      'a ledger jar path with a backslash',
      (r) => ({ ...telemetryInputs(r), NF_LEDGER_JAR_HOST: '/no/such\\dir/ledger.jar' }),
      'has whitespace, a quote, a backslash or a dollar',
    ],
    [
      'an agent jar path that is a directory',
      (r) => ({ ...telemetryInputs(r), NF_OTEL_AGENT_HOST: fwd(r) }),
      'NF_OTEL_AGENT_HOST is not a regular file',
    ],
    [
      'a ledger jar path that does not exist',
      (r) => ({ ...telemetryInputs(r), NF_LEDGER_JAR_HOST: fwd(join(r, 'missing.jar')) }),
      'NF_LEDGER_JAR_HOST is not a regular file',
    ],
    [
      'an unset agent properties variable',
      (r) => without(telemetryInputs(r), 'NF_OTEL_AGENT_PROPS_HOST'),
      'NF_OTEL_AGENT_PROPS_HOST is not set',
    ],
    [
      'an unset NF_LEDGER_SHA256',
      (r) => without(telemetryInputs(r), 'NF_LEDGER_SHA256'),
      'NF_LEDGER_SHA256 must be 64',
    ],
    [
      'an entrypoint without GELDAR_NF_TELEMETRY',
      (r) => {
        writeFileSync(join(r, 'compose', 'neoforge', 'neoforge-entrypoint.sh'), '#!/bin/sh\n');
        return telemetryInputs(r);
      },
      'has no GELDAR_NF_TELEMETRY',
    ],
  ];
  it.each(refusals)('refuses %s, before any docker call', (_label, inputs, message) => {
    const repo = makeRepo();
    const r = run(repo, ['up'], inputs(repo));
    expect(r.status).not.toBe(0);
    expect(r.out).toContain(message);
    expect(calls(repo)).toEqual([]);
  });

  // The jar is written after the helper: the helper writes the matching jar, so a mismatch set before it would be erased.
  it('refuses a ledger jar whose sha256 is not NF_LEDGER_SHA256, names the ledger jar, and starts nothing', () => {
    const repo = makeRepo();
    const env = telemetryInputs(repo);
    writeFileSync(join(repo, 'ledger.jar'), 'a different ledger jar\n');
    const r = run(repo, ['up'], env);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain('the sha256 of the ledger jar does not match NF_LEDGER_SHA256');
    expect(calls(repo)).toEqual([]);
  });

  it.runIf(canSymlink)('refuses a symlink host file, before any docker call', () => {
    const repo = makeRepo();
    const env = telemetryInputs(repo);
    symlinkSync(join(repo, 'ledger.jar'), join(repo, 'link.jar'));
    const r = run(repo, ['up'], { ...env, NF_LEDGER_JAR_HOST: fwd(join(repo, 'link.jar')) });
    expect(r.status).not.toBe(0);
    expect(r.out).toContain('is a symlink');
    expect(calls(repo)).toEqual([]);
  });

  // Runs on Linux CI (the symlink probe above skips it on Windows): a symlinked parent hides the file that was hashed.
  it.runIf(canSymlink)(
    'refuses a host file under a symlinked directory, before any docker call',
    () => {
      const repo = makeRepo();
      const env = telemetryInputs(repo);
      mkdirSync(join(repo, 'real'));
      copyFileSync(join(repo, 'ledger.jar'), join(repo, 'real', 'ledger.jar'));
      symlinkSync(join(repo, 'real'), join(repo, 'linked'));
      const host = fwd(join(repo, 'linked', 'ledger.jar'));
      const r = run(repo, ['up'], { ...env, NF_LEDGER_JAR_HOST: host });
      expect(r.status).not.toBe(0);
      expect(r.out).toContain('is under a symlinked directory');
      expect(calls(repo)).toEqual([]);
    },
  );

  it('plan with telemetry on checks the network, prints the overlay line, and changes no state', () => {
    const repo = makeRepo();
    const r = run(repo, ['plan'], telemetryInputs(repo));
    expect(r.status).toBe(0);
    expect(r.out).toContain('telemetry on: overlay');
    expect(calls(repo)).toContain('docker network inspect geldar-telemetry');
    expect(
      calls(repo).filter((c) => / (up|down|run|start|stop|rm|create|exec)( |$)/.test(c)),
    ).toEqual([]);
  });

  it('plan refuses when the network is missing, and runs no compose call', () => {
    const repo = makeRepo();
    const r = run(repo, ['plan'], { ...telemetryInputs(repo), NETWORK_MISSING: '1' });
    expect(r.status).not.toBe(0);
    expect(r.out).toContain('docker network geldar-telemetry does not exist');
    expect(composeCalls(repo)).toEqual([]);
  });

  it('refuses when the geldar-telemetry network is missing, and starts nothing', () => {
    const repo = makeRepo();
    const r = run(repo, ['up'], { ...telemetryInputs(repo), NETWORK_MISSING: '1' });
    expect(r.status).not.toBe(0);
    expect(r.out).toContain('docker network geldar-telemetry does not exist');
    expect(composeCalls(repo)).toEqual([]);
  });

  it('down and status never read the telemetry inputs, never add the overlay, and never remove the network', () => {
    const repo = makeRepo();
    expect(run(repo, ['down'], { NF_TELEMETRY: 'on' }).status).toBe(0);
    expect(run(repo, ['status'], { NF_TELEMETRY: 'on' }).status).toBe(0);
    const all = composeCalls(repo);
    expect(all.some((c) => c.endsWith(' down'))).toBe(true);
    expect(all.some((c) => c.includes('nf-live-telemetry'))).toBe(false);
    expect(all.some((c) => c.includes('--volumes'))).toBe(false);
    expect(
      calls(repo).some((c) => /docker network (rm|prune|create|connect|disconnect)/.test(c)),
    ).toBe(false);
    expect(SCRIPT_TEXT).not.toMatch(/network\s+(rm|prune|create)|volume\s+(rm|prune)|system prune/);
  });
});
