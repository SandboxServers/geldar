import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { skipWithoutSh, slash } from './scratch-harness.js';

// deploy/nf-extra-mods-lib.sh, with BlueMap enabled: the committed config bundle must match its manifest before any docker call.
// The driver defines the two helpers the lib uses (die, check_host_file) and points the pins and the bundle at fixtures.
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const LIB = `${ROOT}deploy/nf-extra-mods-lib.sh`;
const REAL_BUNDLE = `${ROOT}plugins/bluemap/neoforge`;
const JAR_BODY = 'fixture bluemap jar';
const sha256 = (text: string | Buffer) => createHash('sha256').update(text).digest('hex');

const CAN_LINK = (() => {
  const dir = mkdtempSync(join(tmpdir(), 'nf-bm-host-link-'));
  try {
    symlinkSync(dir, join(dir, 'probe'));
    return true;
  } catch {
    return false;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
})();

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A bundle fixture: the files, and a manifest of them (sha256sum format, sorted, LF). */
function fixtureBundle(base: string, files: Record<string, string>): string {
  const bundle = join(base, 'bundle');
  for (const [rel, body] of Object.entries(files)) {
    const path = join(bundle, rel);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, body);
  }
  const lines = Object.keys(files)
    .sort()
    .map((rel) => `${sha256(files[rel] ?? '')}  ${rel}`);
  writeFileSync(join(bundle, 'MANIFEST.sha256'), `${lines.join('\n')}\n`);
  return bundle;
}

const OK_FILES = { 'core.conf': 'accept-download: true\n', 'maps/end.conf': 'marker-sets: {\n}\n' };

/** Runs the driver: enabled bluemap with the given bundle; the docker stub logs any call (there must be none). */
function drive(base: string, bundle: string, mods = 'bluemap') {
  const bin = join(base, 'bin');
  mkdirSync(bin, { recursive: true });
  const log = join(base, 'docker.log');
  writeFileSync(join(bin, 'docker'), `#!/bin/sh\necho "$*" >> "${slash(log)}"\nexit 0\n`, {
    mode: 0o755,
  });
  const jar = join(base, 'bluemap.jar');
  writeFileSync(jar, JAR_BODY);
  const pins = join(base, 'extra-mods.pins');
  writeFileSync(pins, `bluemap ${sha256(JAR_BODY)} bluemap-fixture.jar 5.29\n`);
  const script = join(base, 'driver.sh');
  writeFileSync(
    script,
    [
      'die() { echo "$*" >&2; exit 1; }',
      'need() { :; }',
      'say() { :; }',
      'check_host_file() { [ -f "$2" ] || die "$1 is not a regular file"; }',
      `ROOT='${slash(ROOT).replace(/\/$/, '')}'`,
      `. '${slash(LIB)}'`,
      `EXTRA_PINS='${slash(pins)}'`,
      `BLUEMAP_BUNDLE='${slash(bundle)}'`,
      `NF_EXTRA_MODS='${mods}'`,
      `NF_EXTRA_BLUEMAP_JAR_HOST='${slash(jar)}'`,
      'check_extra_mods',
      'echo "checked: $EXTRA_ENABLED"',
      '',
    ].join('\n'),
  );
  return spawnSync('sh', [slash(script)], {
    encoding: 'utf8',
    env: {
      PATH: `${slash(bin)}${delimiter}${process.env.PATH ?? ''}`,
      SYSTEMROOT: process.env.SYSTEMROOT ?? '',
    },
  });
}

function refused(base: string, r: ReturnType<typeof drive>, named: RegExp) {
  expect(r.status).not.toBe(0);
  expect(r.stderr).toMatch(named);
  expect(existsSync2(join(base, 'docker.log'))).toBe(false);
}

const existsSync2 = (path: string) => {
  try {
    readFileSync(path);
    return true;
  } catch {
    return false;
  }
};

describe.skipIf(skipWithoutSh())('BlueMap bundle: the host check (sh, no docker)', { timeout: 60_000 }, () => {
  it('the committed bundle passes, and the check names BlueMap as enabled', () => {
    const base = mkdtempSync(join(tmpdir(), 'nf-bm-host-'));
    dirs.push(base);
    const r = drive(base, REAL_BUNDLE);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('checked: bluemap');
    expect(existsSync2(join(base, 'docker.log'))).toBe(false);
  });

  it('a fixture bundle that matches passes', () => {
    const base = mkdtempSync(join(tmpdir(), 'nf-bm-host-'));
    dirs.push(base);
    const r = drive(base, fixtureBundle(base, OK_FILES));
    expect(r.status, r.stderr).toBe(0);
  });

  it('BlueMap not enabled: the bundle is not checked at all (a missing bundle is fine)', () => {
    const base = mkdtempSync(join(tmpdir(), 'nf-bm-host-'));
    dirs.push(base);
    const r = drive(base, join(base, 'no-such-bundle'), '');
    expect(r.status, r.stderr).toBe(0);
  });

  it('a missing MANIFEST.sha256 refuses, and no docker call is made', () => {
    const base = mkdtempSync(join(tmpdir(), 'nf-bm-host-'));
    dirs.push(base);
    const bundle = fixtureBundle(base, OK_FILES);
    rmSync(join(bundle, 'MANIFEST.sha256'));
    refused(base, drive(base, bundle), /MANIFEST\.sha256 is missing/);
  });

  it('a changed byte refuses and names the file', () => {
    const base = mkdtempSync(join(tmpdir(), 'nf-bm-host-'));
    dirs.push(base);
    const bundle = fixtureBundle(base, OK_FILES);
    writeFileSync(join(bundle, 'core.conf'), 'accept-download: false\n');
    refused(base, drive(base, bundle), /core\.conf does not match MANIFEST/);
  });

  it('an extra file (a stray default) refuses', () => {
    const base = mkdtempSync(join(tmpdir(), 'nf-bm-host-'));
    dirs.push(base);
    const bundle = fixtureBundle(base, OK_FILES);
    writeFileSync(join(bundle, 'maps', 'foo.conf'), 'x\n');
    refused(base, drive(base, bundle), /holds maps\/foo\.conf, which MANIFEST/);
  });

  it('a file the manifest lists but the directory lacks refuses', () => {
    const base = mkdtempSync(join(tmpdir(), 'nf-bm-host-'));
    dirs.push(base);
    const bundle = fixtureBundle(base, OK_FILES);
    rmSync(join(bundle, 'maps', 'end.conf'));
    refused(base, drive(base, bundle), /lacks the regular file maps\/end\.conf/);
  });

  it.skipIf(!CAN_LINK)('a symlink in the bundle refuses (skipped where symlinks are not allowed)', () => {
    const base = mkdtempSync(join(tmpdir(), 'nf-bm-host-'));
    dirs.push(base);
    const bundle = fixtureBundle(base, OK_FILES);
    symlinkSync(join(bundle, 'core.conf'), join(bundle, 'link.conf'));
    refused(base, drive(base, bundle), /holds a symlink/);
  });
});
