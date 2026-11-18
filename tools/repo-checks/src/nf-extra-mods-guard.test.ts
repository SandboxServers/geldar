import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { skipWithoutSh, slash } from './scratch-harness.js';

// check_extra_mods_drop (deploy/nf-extra-mods-lib.sh) and its call sites in deploy/nf-deploy.sh. The driver is the one of
// nf-extra-mods-deploy.test.ts: the check_host_file helper is extracted from deploy/nf-deploy.sh, the lib is sourced, and a stub
// docker on PATH answers ps and inspect from environment variables and logs every call.

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const DEPLOY_SH = readFileSync(`${ROOT}deploy/nf-deploy.sh`, 'utf8');
const HUMAN_SH = readFileSync(`${ROOT}deploy/nf-human-lib.sh`, 'utf8');
const LIB = `${ROOT}deploy/nf-extra-mods-lib.sh`;
const JAR_BODY = 'fixture extra mod jar';
const JAR_PIN = createHash('sha256').update(JAR_BODY).digest('hex');
const PROJECT = 'geldar-fixture';
const NEOFORGE_ROW = `abc123|${PROJECT}|neoforge`;
const MOUNTS_BOTH =
  '/geldar/extra-mods/chunky.jar\n/geldar/extra-mods/bluemap.jar\n/geldar/extra-mods/bluemap-config\n/data\n';
const MOUNTS_NONE = '/data\n/geldar/extra-mods/bluemap-config\n';
/** The inspect output of a container with the BlueMap jar and its config bundle mounted (no chunky). */
const MOUNTS_BLUEMAP = '/data\n/geldar/extra-mods/bluemap.jar\n/geldar/extra-mods/bluemap-config\n';
const REFUSAL = (names: string) =>
  `the running neoforge container has extra mods mounted (${names}) but NF_EXTRA_MODS is unset: it would be recreated WITHOUT them; source the ops env file that sets NF_EXTRA_MODS (a sourced shell file in the ops user's home on the node), or set NF_EXTRA_MODS=none to remove them on purpose`;

const STUB = [
  '#!/bin/sh',
  'echo "docker $*" >>"$STUB_LOG"',
  'case "$1" in',
  '  ps) [ -n "$PS_FAIL" ] && exit 1',
  '    case "$*" in *com.docker.compose.service=neoforge*) printf "%s\\n" "$PS_ROWS" ;; esac; exit 0 ;;',
  '  inspect) [ -n "$INSPECT_FAIL" ] && exit 1; printf "%s" "$INSPECT_OUT"; exit 0 ;;',
  'esac',
  'exit 0',
].join('\n');

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

interface Fixture {
  ps?: string;
  psFail?: boolean;
  inspectOut?: string;
  inspectFail?: boolean;
}

/** Runs check_extra_mods then check_extra_mods_drop under sh. Both jars exist and match the pins, so only the drop guard can refuse. */
function drive(env: Record<string, string>, fx: Fixture = {}) {
  const base = mkdtempSync(join(tmpdir(), 'nf-extra-guard-'));
  dirs.push(base);
  const bin = join(base, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'docker'), STUB, { mode: 0o755 });
  const log = join(base, 'docker.log');
  const chunky = join(base, 'chunky.jar');
  const bluemap = join(base, 'bluemap.jar');
  writeFileSync(chunky, JAR_BODY);
  writeFileSync(bluemap, JAR_BODY);
  const pins = join(base, 'pins');
  writeFileSync(
    pins,
    `chunky ${JAR_PIN} Chunky-fixture.jar 0.0.0\nbluemap ${JAR_PIN} BlueMap-fixture.jar 0.0.0\n`,
  );
  const start = DEPLOY_SH.indexOf('check_host_file() {');
  const checkHostFile = DEPLOY_SH.slice(start, DEPLOY_SH.indexOf('\n}\n', start) + 3);
  const driver = join(base, 'driver.sh');
  writeFileSync(
    driver,
    [
      'set -eu',
      'ROOT=/unused',
      'die() { echo "nf-deploy: error: $*" >&2; exit 1; }',
      'say() { echo "nf-deploy: $*"; }',
      'need() { command -v "$1" >/dev/null 2>&1 || die "missing command: $1"; }',
      checkHostFile,
      `. "${slash(LIB)}"`,
      // The committed bundle, so the BlueMap check passes; the real directory is the one the lib names.
      `BLUEMAP_BUNDLE="${slash(join(LIB, '..', '..', 'plugins', 'bluemap', 'neoforge'))}"`,
      `PROJECT="${PROJECT}"`,
      `EXTRA_PINS="${slash(pins)}"`,
      'check_extra_mods',
      'check_extra_mods_drop',
      'echo "ENABLED=[$EXTRA_ENABLED]"',
      '',
    ].join('\n'),
  );
  const { PATH: _path, NF_EXTRA_MODS: _mods, ...rest } = process.env;
  const r = spawnSync('sh', [slash(driver)], {
    encoding: 'utf8',
    env: {
      ...rest,
      PATH: `${bin}${delimiter}${process.env.PATH ?? ''}`,
      STUB_LOG: slash(log),
      PS_ROWS: fx.ps ?? '',
      PS_FAIL: fx.psFail ? '1' : '',
      INSPECT_OUT: fx.inspectOut ?? '',
      INSPECT_FAIL: fx.inspectFail ? '1' : '',
      NF_EXTRA_CHUNKY_JAR_HOST: slash(chunky),
      NF_EXTRA_BLUEMAP_JAR_HOST: slash(bluemap),
      ...env,
    },
  });
  const docker = (() => {
    try {
      return readFileSync(log, 'utf8');
    } catch {
      return '';
    }
  })();
  return { status: r.status, out: r.stdout, err: r.stderr, docker };
}

/** The text of one shell function in deploy/nf-deploy.sh (from its header to its closing brace). */
function body(name: string): string {
  // cmd_human_down lives in deploy/nf-human-lib.sh (sourced by nf-deploy.sh), so both files are searched.
  const text = `${DEPLOY_SH}\n${HUMAN_SH}`;
  const start = text.indexOf(`${name}() {`);
  expect(start, name).toBeGreaterThan(-1);
  return text.slice(start, text.indexOf('\n}\n', start));
}

describe('extra mods: where the drop guard is called (static)', () => {
  it('gates() runs check_extra_mods_drop last, after check_config, so every earlier refusal stays free of docker calls', () => {
    expect(body('gates')).toMatch(/check_config\n\s+check_extra_mods_drop$/);
  });

  it('plan, up and refresh-secrets reach it through gates(); probe calls it directly', () => {
    expect(body('cmd_plan')).toContain('gates');
    expect(body('cmd_up')).toContain('gates');
    expect(body('cmd_refresh_secrets')).toContain('gates');
    expect(body('cmd_probe')).toContain('check_extra_mods_drop');
  });

  it('status, logs, down and human-down never call it', () => {
    for (const name of ['cmd_status', 'cmd_logs', 'cmd_down', 'cmd_human_down']) {
      expect(body(name), name).not.toContain('check_extra_mods_drop');
    }
  });
});

describe.skipIf(skipWithoutSh())(
  'extra mods: the drop guard (sh, stub docker)',
  { timeout: 60_000 },
  () => {
    it('unset, with chunky and bluemap mounted in a running neoforge: refuses, names them, and gives the exact text', () => {
      const r = drive({}, { ps: NEOFORGE_ROW, inspectOut: MOUNTS_BOTH });
      expect(r.status).toBe(1);
      expect(r.err).toContain(REFUSAL('chunky,bluemap'));
      expect(r.docker).toContain('docker inspect');
    });

    it('an empty NF_EXTRA_MODS counts as unset and refuses the same way', () => {
      const r = drive({ NF_EXTRA_MODS: '' }, { ps: NEOFORGE_ROW, inspectOut: MOUNTS_BOTH });
      expect(r.status).toBe(1);
      expect(r.err).toContain(REFUSAL('chunky,bluemap'));
    });

    it('the same list set (NF_EXTRA_MODS=chunky,bluemap) allows, and the guard makes no docker call', () => {
      const r = drive(
        { NF_EXTRA_MODS: 'chunky,bluemap' },
        { ps: NEOFORGE_ROW, inspectOut: MOUNTS_BOTH },
      );
      expect(r.status, r.err).toBe(0);
      expect(r.out).toContain('ENABLED=[chunky bluemap]');
      expect(r.docker).toBe('');
    });

    it('NF_EXTRA_MODS=none allows with the same mounts, enables nothing, and makes no docker call', () => {
      const r = drive({ NF_EXTRA_MODS: 'none' }, { ps: NEOFORGE_ROW, inspectOut: MOUNTS_BOTH });
      expect(r.status, r.err).toBe(0);
      expect(r.out).toContain('ENABLED=[]');
      expect(r.err).not.toContain('extra mods mounted');
      expect(r.docker).toBe('');
    });

    it('no neoforge container: allows (ps answers no row, inspect is never called)', () => {
      const r = drive({});
      expect(r.status, r.err).toBe(0);
      expect(r.out).toContain('ENABLED=[]');
      expect(r.docker).toContain('docker ps');
      expect(r.docker).not.toContain('docker inspect');
    });

    it('a neoforge container with no extra-mod mount (bluemap-config is not a mod): allows', () => {
      const r = drive({}, { ps: NEOFORGE_ROW, inspectOut: MOUNTS_NONE });
      expect(r.status, r.err).toBe(0);
      expect(r.docker).toContain('docker inspect');
    });

    it('bluemap.jar and bluemap-config mounted, NF_EXTRA_MODS unset: names bluemap only, never bluemap-config', () => {
      const r = drive({}, { ps: NEOFORGE_ROW, inspectOut: MOUNTS_BLUEMAP });
      expect(r.status).toBe(1);
      expect(r.err).toContain(REFUSAL('bluemap'));
      expect(r.err).not.toContain('bluemap-config');
    });

    it('docker ps failing: refuses in one line, with the project name and no compose call', () => {
      const r = drive({}, { psFail: true });
      expect(r.status).toBe(1);
      expect(r.err).toContain(
        'cannot list the geldar-fixture containers (extra mods check); refusing',
      );
    });

    it('docker inspect failing: refuses in one line', () => {
      const r = drive({}, { ps: NEOFORGE_ROW, inspectFail: true });
      expect(r.status).toBe(1);
      expect(r.err).toContain('cannot inspect the neoforge container (extra mods check); refusing');
    });

    it.each(['none,chunky', 'chunky,none'])(
      'NF_EXTRA_MODS=%s refuses: none is not combined with names',
      (raw) => {
        const r = drive({ NF_EXTRA_MODS: raw });
        expect(r.status).toBe(1);
        expect(r.err).toContain('NF_EXTRA_MODS=none cannot be combined with other names');
      },
    );
  },
);
