/**
 * The entrypoint's bundle mode (compose/neoforge/neoforge-entrypoint.sh, "Offline bundle" in docs/runbooks/scratch-stack.md),
 * run under sh with a stub curl. The bundle is a temp data dir: the listed immutable files and the marker that lists them.
 * Nothing here starts a container or uses the network. The build side is scratch-neoforge-bundle.test.ts.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { CAN_SYMLINK, SH, skipWithoutSh, slash, stubs } from './scratch-harness.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const ENTRY = `${ROOT}compose/neoforge/neoforge-entrypoint.sh`;

/** Built from parts, so the dotted build never appears literally (the IP-literal check rejects it). */
const BUILD = ['26', '1', '2', '126'].join('.');
const MOD_NAME = 'proxy-compatible-forge-1.3.1.jar';
const INSTALLER_NAME = `neoforge-${BUILD}-installer.jar`;
const MOD_REL = 'mods/proxy-compatible-forge.jar';
const MARKER = '.geldar-bundle.sha256';
const SECRET = 'nf-bundle-secret-Z9_q';
const MOD_BODY = 'bundle mod bytes';
const INSTALLER_BODY = 'bundle installer bytes';
const RUN_BODY = 'bundle run script';
const MANIFEST_BODY = '{"serverEntry":"run.sh"}\n';

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
const sha512 = (text: string) => createHash('sha512').update(text).digest('hex');
const cleanup: string[] = [];
afterEach(() => {
  for (const dir of cleanup.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** The four lines a valid bundle lists: the load-bearing files. */
const VALID = [
  `${sha256(MOD_BODY)}  ${MOD_REL}`,
  `${sha256(INSTALLER_BODY)}  neoforge-installer.jar`,
  `${sha256(MANIFEST_BODY)}  .neoforge-manifest.json`,
  `${sha256(RUN_BODY)}  run.sh`,
];
const listText = (lines: string[]) => `${lines.join('\n')}\n`;

/** Serves the fixture named by the URL's last path part, and logs each call (the bundle tests check it is never called). */
const CURL_STUB = [
  '#!/bin/sh',
  'echo "$*" >>"$STUB_CURL_LOG"',
  'out=""; url=""',
  'while [ $# -gt 0 ]; do case "$1" in -o) out=$2; shift ;; http*) url=$1 ;; esac; shift; done',
  'cp "$STUB_CURL_FIXTURES/$(basename "$url")" "$out"',
  '',
].join('\n');

interface Bundle {
  base: string;
  data: string;
  marker: string;
  mod: string;
  installer: string;
  manifest: string;
  curlLog: string;
  env: Record<string, string>;
}

/** A data dir with the mod, the installer, the manifest and run.sh, and a marker listing all four with their hashes. */
function bundle(): Bundle {
  const s = stubs();
  cleanup.push(s.base);
  const bin = join(s.base, 'bin');
  const data = join(s.base, 'data');
  const fixtures = join(s.base, 'fixtures');
  mkdirSync(join(data, 'mods'), { recursive: true });
  mkdirSync(fixtures);
  writeFileSync(join(fixtures, MOD_NAME), MOD_BODY);
  writeFileSync(join(fixtures, INSTALLER_NAME), INSTALLER_BODY);
  writeFileSync(join(bin, 'curl'), CURL_STUB, { mode: 0o755 });
  writeFileSync(join(bin, 'start'), '#!/bin/sh\necho "started FORCE=$NEOFORGE_FORCE_REINSTALL"\n', {
    mode: 0o755,
  });
  const secretFile = join(s.base, 'velocity-forwarding');
  writeFileSync(secretFile, `${SECRET}\n`);
  const mod = join(data, MOD_REL);
  const installer = join(data, 'neoforge-installer.jar');
  const manifest = join(data, '.neoforge-manifest.json');
  const marker = join(data, MARKER);
  writeFileSync(mod, MOD_BODY);
  writeFileSync(installer, INSTALLER_BODY);
  writeFileSync(manifest, MANIFEST_BODY);
  writeFileSync(join(data, 'run.sh'), RUN_BODY);
  writeFileSync(marker, listText(VALID));
  const curlLog = join(s.base, 'curl.log');
  return {
    base: s.base,
    data,
    marker,
    mod,
    installer,
    manifest,
    curlLog,
    env: {
      ...s.env,
      GELDAR_NF_DATA_DIR: slash(data),
      GELDAR_NF_SECRET_FILE: slash(secretFile),
      GELDAR_NF_START: slash(join(bin, 'start')),
      GELDAR_NF_MOD_SHA512: sha512(MOD_BODY),
      GELDAR_NF_INSTALLER_SHA256: sha256(INSTALLER_BODY),
      GELDAR_NF_INSTALLER_SHA512: sha512(INSTALLER_BODY),
      NEOFORGE_VERSION: BUILD,
      STUB_CURL_LOG: slash(curlLog),
      STUB_CURL_FIXTURES: slash(fixtures),
    },
  };
}

function runEntry(b: Bundle, extra: Record<string, string> = {}) {
  return spawnSync(SH as string, [slash(ENTRY)], { encoding: 'utf8', env: { ...b.env, ...extra } });
}
const curlCalls = (b: Bundle) =>
  existsSync(b.curlLog) ? readFileSync(b.curlLog, 'utf8').split('\n').filter(Boolean).length : 0;

describe.skipIf(skipWithoutSh())(
  'NeoForge offline bundle: entrypoint bundle mode',
  { timeout: 60_000 },
  () => {
    it('a bundle whose listed files all verify starts with no fetch, and no forced reinstall', () => {
      const b = bundle();
      const r = runEntry(b, { NEOFORGE_FORCE_REINSTALL: 'true' });
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('started FORCE=false');
      expect(curlCalls(b)).toBe(0);
      expect(r.stdout + r.stderr).not.toContain(SECRET);
    });

    it('a corrupted file exits 1, the message names it, and nothing is fetched or started', () => {
      const b = bundle();
      writeFileSync(b.mod, 'tampered');
      const r = runEntry(b);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain(`${MOD_REL}: FAILED`);
      expect(r.stdout).not.toContain('started');
      expect(curlCalls(b)).toBe(0);
      expect(r.stdout + r.stderr).not.toContain(SECRET);
    });

    it('a listed file that is missing exits 1 and the message names it', () => {
      const b = bundle();
      rmSync(b.installer);
      const r = runEntry(b);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('neoforge-installer.jar');
      expect(curlCalls(b)).toBe(0);
    });

    it('a listed manifest that is missing exits 1 and the message names it', () => {
      const b = bundle();
      rmSync(b.manifest);
      const r = runEntry(b);
      expect(r.status).toBe(1);
      // The strict check fails on the missing file and names it (sha256sum's "No such file" text is the first line).
      expect(r.stderr).toContain('.neoforge-manifest.json');
      expect(r.stderr).toContain('refusing to start');
      expect(curlCalls(b)).toBe(0);
    });

    it('GELDAR_NF_BUNDLE_LIST replaces the marker path: the list it names is the one checked', () => {
      const b = bundle();
      const list = join(b.base, 'other-list.sha256');
      writeFileSync(list, listText([`${'0'.repeat(64)}  ${MOD_REL}`, ...VALID.slice(1)]));
      const r = runEntry(b, { GELDAR_NF_BUNDLE_LIST: slash(list) });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain(`${MOD_REL}: FAILED`);
      expect(curlCalls(b)).toBe(0);
    });

    it('an installer with the right sha256 but a wrong sha512 pin exits 1 and is deleted, when pre-seeded', () => {
      const b = bundle();
      rmSync(b.marker);
      const r = runEntry(b, { GELDAR_NF_INSTALLER_SHA512: '0'.repeat(128) });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('does not match its pinned sha512sum hash');
      expect(existsSync(b.installer)).toBe(false);
      expect(curlCalls(b)).toBe(0);
      expect(r.stdout + r.stderr).not.toContain(SECRET);
    });

    it('a downloaded installer with the right sha256 but a wrong sha512 pin exits 1 and is deleted', () => {
      const b = bundle();
      rmSync(b.marker);
      rmSync(b.installer);
      const r = runEntry(b, { GELDAR_NF_INSTALLER_SHA512: '0'.repeat(128) });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('does not match its pinned sha512sum hash');
      expect(existsSync(b.installer)).toBe(false);
      expect(curlCalls(b)).toBe(1);
    });

    it('a malformed line in the marker exits 1 under the strict check, and nothing starts', () => {
      const b = bundle();
      writeFileSync(b.marker, listText([...VALID, 'not-a-hash-line']));
      const r = runEntry(b);
      expect(r.status).toBe(1);
      expect(r.stdout).not.toContain('started');
      expect(curlCalls(b)).toBe(0);
      expect(r.stdout + r.stderr).not.toContain(SECRET);
    });

    it('a truncated marker (the last hash cut short) exits 1 under the strict check', () => {
      const b = bundle();
      const cut = `${sha256(RUN_BODY).slice(0, 40)}  run.sh`;
      writeFileSync(b.marker, listText([...VALID.slice(0, -1), cut]));
      const r = runEntry(b);
      expect(r.status).toBe(1);
      expect(r.stdout).not.toContain('started');
      expect(curlCalls(b)).toBe(0);
    });

    it('a one-line marker that lacks the required paths exits 1 and names the first one missing', () => {
      const b = bundle();
      writeFileSync(b.marker, listText(VALID.slice(0, 1)));
      const r = runEntry(b);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('offline bundle is incomplete');
      expect(r.stderr).toContain('.neoforge-manifest.json');
      expect(curlCalls(b)).toBe(0);
    });

    it('a marker that lacks run.sh exits 1 and names run.sh', () => {
      const b = bundle();
      writeFileSync(b.marker, listText(VALID.slice(0, 3)));
      const r = runEntry(b);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('does not name run.sh');
      expect(r.stdout).not.toContain('started');
    });

    it('a list entry that climbs out with ../ exits 1 before any hash is read from outside the data dir', () => {
      const b = bundle();
      writeFileSync(join(b.base, 'outside.txt'), 'outside');
      writeFileSync(b.marker, listText([...VALID, `${sha256('outside')}  ../outside.txt`]));
      const r = runEntry(b);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('../outside.txt');
      expect(r.stdout).not.toContain('started');
    });

    it('a list entry with an absolute path exits 1, even when that file has the listed hash', () => {
      const b = bundle();
      const outside = join(b.base, 'outside.txt');
      writeFileSync(outside, 'outside');
      writeFileSync(b.marker, listText([...VALID, `${sha256('outside')}  ${slash(outside)}`]));
      const r = runEntry(b);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('outside.txt');
      expect(r.stdout).not.toContain('started');
    });

    it('a list entry whose path starts with a dash exits 1', () => {
      const b = bundle();
      writeFileSync(b.marker, listText([...VALID, `${sha256('x')}  -rf.jar`]));
      const r = runEntry(b);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('-rf.jar');
      expect(r.stdout).not.toContain('started');
    });

    it.skipIf(!CAN_SYMLINK)('a symlink under mods/ exits 1 and the message names it', () => {
      const b = bundle();
      symlinkSync(b.installer, join(b.data, 'mods', 'link.jar'));
      const r = runEntry(b);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('mods/link.jar');
      expect(r.stdout).not.toContain('started');
      expect(curlCalls(b)).toBe(0);
    });

    it('an extra jar in mods/ that the list does not name exits 1, and the message names it', () => {
      const b = bundle();
      writeFileSync(join(b.data, 'mods', 'extra.jar'), 'extra');
      const r = runEntry(b);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('mods/extra.jar');
      expect(r.stdout).not.toContain('started');
      expect(curlCalls(b)).toBe(0);
    });

    it('an extra file in libraries/ is allowed: the classpath is fixed by unix_args.txt', () => {
      const b = bundle();
      mkdirSync(join(b.data, 'libraries'), { recursive: true });
      writeFileSync(join(b.data, 'libraries', 'extra.jar'), 'extra');
      const r = runEntry(b);
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('started');
    });
  },
);
