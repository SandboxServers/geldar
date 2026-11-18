/**
 * The NeoForge entrypoint (compose/neoforge/neoforge-entrypoint.sh) against a proxy-compatible-forge.toml shaped like the one the
 * mod leaves behind on the node: about 1.5 KB, comments, other tables, and a [forwarding] table with enabled, mode, secret and
 * approvedProxyHosts. Variants: LF, CRLF, trailing spaces and trailing comments on the header and key lines, and a different
 * secret. Every case must end with enabled = true, mode = "MODERN" and the current secret once in [forwarding], with
 * approvedProxyHosts and the other tables kept. The stub harness is the one in scratch-neoforge-restart.test.ts; no Docker.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { skipWithoutSh, slash } from './scratch-harness.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const ENTRY = `${ROOT}compose/neoforge/neoforge-entrypoint.sh`;
const BUILD = ['26', '1', '2', '126'].join('.');
const MOD_NAME = 'proxy-compatible-forge-1.3.1.jar';
const INSTALLER_NAME = `neoforge-${BUILD}-installer.jar`;
const SECRET = 'nf-shape-secret-T4_m';
const OLD_SECRET = 'nf-shape-old-secret-W8';
const PCF_BODY = 'fixture proxy compatible forge bytes';
const GEO_BODY = 'fixture geldar mod bytes';
const INSTALLER_BODY = 'fixture installer bytes';

const CURL_STUB = [
  '#!/bin/sh',
  'out=""; url=""',
  'while [ $# -gt 0 ]; do',
  '  case "$1" in',
  '    -o) out=$2; shift ;;',
  '    http*) url=$1 ;;',
  '  esac',
  '  shift',
  'done',
  'cp "$STUB_CURL_FIXTURES/$(basename "$url")" "$out"',
  '',
].join('\n');

const sha512 = (text: string) => createHash('sha512').update(text).digest('hex');
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

interface Case {
  data: string;
  config: string;
  env: Record<string, string>;
}

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function setup(): Case {
  const base = mkdtempSync(join(tmpdir(), 'nf-shape-'));
  dirs.push(base);
  const bin = join(base, 'bin');
  const fixtures = join(base, 'fixtures');
  const data = join(base, 'data');
  const mount = join(base, 'mount');
  for (const dir of [bin, fixtures, data, mount]) mkdirSync(dir);
  writeFileSync(join(fixtures, MOD_NAME), PCF_BODY);
  writeFileSync(join(fixtures, INSTALLER_NAME), INSTALLER_BODY);
  writeFileSync(join(bin, 'curl'), CURL_STUB, { mode: 0o755 });
  writeFileSync(join(bin, 'start'), '#!/bin/sh\necho "started $*"\n', { mode: 0o755 });
  const mountedMod = join(mount, 'geldar-neoforge.jar');
  writeFileSync(mountedMod, GEO_BODY);
  const secretFile = join(base, 'velocity-forwarding');
  writeFileSync(secretFile, `${SECRET}\n`);
  return {
    data,
    config: join(data, 'config', 'proxy-compatible-forge.toml'),
    env: {
      PATH_BIN: slash(bin),
      GELDAR_NF_DATA_DIR: slash(data),
      GELDAR_NF_SECRET_FILE: slash(secretFile),
      GELDAR_NF_START: slash(join(bin, 'start')),
      GELDAR_NF_MOD_SHA512: sha512(PCF_BODY),
      GELDAR_NF_INSTALLER_SHA256: sha256(INSTALLER_BODY),
      GELDAR_NF_INSTALLER_SHA512: sha512(INSTALLER_BODY),
      GELDAR_NF_MOD_JAR: slash(mountedMod),
      GELDAR_NF_MOD_SHA256: sha256(GEO_BODY),
      GELDAR_NF_LEDGER_JAR: slash(join(base, 'absent-ledger.jar')),
      NEOFORGE_VERSION: BUILD,
      STUB_CURL_FIXTURES: slash(fixtures),
    },
  };
}

function run(c: Case) {
  return spawnSync('sh', [slash(ENTRY)], {
    encoding: 'utf8',
    env: {
      PATH: `${c.env.PATH_BIN}${delimiter}${process.env.PATH ?? ''}`,
      SYSTEMROOT: process.env.SYSTEMROOT ?? '',
      ...c.env,
      STUB_CURL_LOG: slash(join(c.data, '..', 'curl.log')),
    },
  });
}

/**
 * The file the mod leaves behind: about 1.5 KB, with comments, other tables and the four [forwarding] lines. Trailing text
 * (spaces, a comment) and the line ending are parameters, so the same shape is tested in LF, CRLF and trailing-text forms.
 */
function leftBehind(secret: string, eol: string, trail: string): string {
  const padding = Array.from(
    { length: 24 },
    (_, i) =>
      `# documentation line ${String(i + 1).padStart(2, '0')}: the mod writes this block on every save`,
  );
  const lines = [
    '# Proxy Compatible Forge 1.3.1 configuration',
    ...padding,
    '[general]',
    '  debugLogging = false',
    '  checkForUpdates = true',
    `[forwarding]${trail}`,
    `enabled = true${trail}`,
    `mode = "MODERN"${trail}`,
    `secret = "${secret}"${trail}`,
    `approvedProxyHosts = []${trail}`,
    '',
    '[crossStitch]',
    'enabled = true',
    '',
    '[advanced]',
    'modernForwardingVersion = "NO_OVERRIDE"',
    '',
  ];
  return lines.join(eol);
}

/** The text of the [forwarding] table only: from its header to the next table header (or the end). */
function forwardingTable(text: string): string {
  const after = text.split(/^\[forwarding\][^\n]*$/m)[1] ?? '';
  return after.split(/^\[[^\]]*\]/m)[0] ?? '';
}

function expectShape(text: string) {
  const table = forwardingTable(text);
  expect(table).toMatch(/^\s*enabled\s*=\s*true/m);
  expect(table).toMatch(/^\s*mode\s*=\s*"MODERN"/m);
  expect(table.split(SECRET).length - 1).toBe(1);
  expect(text.split(SECRET).length - 1).toBe(1);
  expect(table).toContain('approvedProxyHosts = []');
  expect(text).toContain('[general]');
  expect(text).toContain('[crossStitch]');
  expect(text).toContain('modernForwardingVersion = "NO_OVERRIDE"');
  expect(text).not.toContain(OLD_SECRET);
}

const VARIANTS: Array<[string, string, string]> = [
  ['LF, no trailing text', '\n', ''],
  ['CRLF, trailing spaces on every line', '\r\n', '   '],
  ['LF, trailing comments on the header and key lines', '\n', '  # set by the server'],
  ['CRLF, trailing text and comments', '\r\n', ' # server  '],
];

describe.skipIf(skipWithoutSh())('the server-left-behind toml shape', { timeout: 30_000 }, () => {
  for (const [label, eol, trail] of VARIANTS) {
    it(`${label}: starts, and [forwarding] ends with the current secret once and approvedProxyHosts kept`, () => {
      const c = setup();
      mkdirSync(join(c.data, 'config'), { recursive: true });
      writeFileSync(c.config, leftBehind(SECRET, eol, trail));
      const r = run(c);
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('started');
      expect(r.stdout + r.stderr).not.toContain(SECRET);
      expectShape(readFileSync(c.config, 'utf8'));
    });

    it(`${label}: a different secret is replaced, and the old file is kept as .bak`, () => {
      const c = setup();
      mkdirSync(join(c.data, 'config'), { recursive: true });
      writeFileSync(c.config, leftBehind(OLD_SECRET, eol, trail));
      const r = run(c);
      expect(r.status).toBe(0);
      expect(r.stdout + r.stderr).not.toContain(SECRET);
      expect(r.stdout + r.stderr).not.toContain(OLD_SECRET);
      expectShape(readFileSync(c.config, 'utf8'));
      expect(readFileSync(`${c.config}.bak`, 'utf8')).toContain(OLD_SECRET);
    });
  }

  it('the first-restart sequence on the left-behind shape: first start, the server leaves this file, then two more starts', () => {
    const c = setup();
    expect(run(c).status).toBe(0);
    mkdirSync(join(c.data, 'config'), { recursive: true });
    writeFileSync(c.config, leftBehind(SECRET, '\r\n', '   '));
    expect(run(c).status).toBe(0);
    const afterSecond = readFileSync(c.config, 'utf8');
    expectShape(afterSecond);
    const third = run(c);
    expect(third.status).toBe(0);
    expect(third.stdout).toContain('started');
    expect(readFileSync(c.config, 'utf8')).toBe(afterSecond);
    expect(existsSync(`${c.config}.part`)).toBe(false);
  });
});
