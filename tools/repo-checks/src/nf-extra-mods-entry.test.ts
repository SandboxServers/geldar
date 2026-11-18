import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { skipWithoutSh, slash } from './scratch-harness.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const ENTRY = `${ROOT}compose/neoforge/neoforge-entrypoint.sh`;
const BUILD = ['26', '1', '2', '126'].join('.');
const MOD_BODY = 'fixture mod bytes';
const INSTALLER_BODY = 'fixture installer bytes';
const CHUNKY_BODY = 'fixture chunky jar bytes';
const SECRET = 'nf-extra-secret-Z3_q';
const ABSENT = '/nonexistent/geldar-fixture-absent.jar';

const sha512 = (text: string) => createHash('sha512').update(text).digest('hex');
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
const CHUNKY_PIN = sha256(CHUNKY_BODY);

const CAN_LINK = (() => {
  const dir = mkdtempSync(join(tmpdir(), 'nf-extra-link-'));
  try {
    symlinkSync(dir, join(dir, 'probe'));
    return true;
  } catch {
    return false;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
})();

interface Case {
  base: string;
  data: string;
  mods: string;
  mount: string;
  env: Record<string, string>;
}

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A data dir with the pinned geldar mod and installer, a start stub, and a mount dir holding the chunky jar. */
function setup(): Case {
  const base = mkdtempSync(join(tmpdir(), 'nf-extra-'));
  dirs.push(base);
  const bin = join(base, 'bin');
  const data = join(base, 'data');
  const mount = join(base, 'mount');
  const mods = join(data, 'mods');
  for (const dir of [bin, data, mount, mods]) mkdirSync(dir);
  writeFileSync(join(bin, 'curl'), '#!/bin/sh\necho "curl was reached" >&2\nexit 9\n', {
    mode: 0o755,
  });
  writeFileSync(join(mods, 'proxy-compatible-forge.jar'), MOD_BODY);
  writeFileSync(join(data, 'neoforge-installer.jar'), INSTALLER_BODY);
  const start = join(bin, 'start');
  writeFileSync(start, '#!/bin/sh\nprintf "started\\n"\n', { mode: 0o755 });
  const secretFile = join(base, 'velocity-forwarding');
  writeFileSync(secretFile, `${SECRET}\n`);
  writeFileSync(join(mount, 'chunky.jar'), CHUNKY_BODY);
  return {
    base,
    data,
    mods,
    mount,
    env: {
      PATH_BIN: bin,
      NEOFORGE_VERSION: BUILD,
      GELDAR_NF_DATA_DIR: slash(data),
      GELDAR_NF_SECRET_FILE: slash(secretFile),
      GELDAR_NF_START: slash(start),
      GELDAR_NF_MOD_SHA512: sha512(MOD_BODY),
      GELDAR_NF_INSTALLER_SHA256: sha256(INSTALLER_BODY),
      GELDAR_NF_INSTALLER_SHA512: sha512(INSTALLER_BODY),
      GELDAR_NF_LEDGER_JAR: ABSENT,
      GELDAR_NF_OTEL_JAR: ABSENT,
      GELDAR_NF_OTEL_PROPS: ABSENT,
      GELDAR_NF_LEDGER_PROPS: ABSENT,
      GELDAR_NF_EXTRA_DIR: slash(mount),
    },
  };
}

/** Runs the entrypoint under sh with exactly the case env plus extra (PATH and SYSTEMROOT are the only inherited values). */
function run(c: Case, extra: Record<string, string> = {}) {
  const { PATH_BIN, ...env } = c.env;
  return spawnSync('sh', [slash(ENTRY)], {
    encoding: 'utf8',
    env: {
      PATH: `${PATH_BIN}${delimiter}${process.env.PATH ?? ''}`,
      SYSTEMROOT: process.env.SYSTEMROOT ?? '',
      ...env,
      ...extra,
    },
  });
}

/** The pin on: the chunky pin. Without a mounted jar the mount dir is replaced by an empty dir in the case. */
const ON = (): Record<string, string> => ({ GELDAR_NF_EXTRA_CHUNKY_SHA256: CHUNKY_PIN });
const copyOf = (c: Case) => join(c.mods, 'chunky.jar');
const emptyMount = (c: Case) => {
  const dir = join(c.base, 'empty-mount');
  mkdirSync(dir, { recursive: true });
  return slash(dir);
};

/** The bundle list for the files the bundle names, as in the ledger entrypoint test. */
function writeBundle(c: Case) {
  const files: Record<string, string> = {
    '.neoforge-manifest.json': '{}\n',
    'neoforge-installer.jar': INSTALLER_BODY,
    'mods/proxy-compatible-forge.jar': MOD_BODY,
    'run.sh': '#!/bin/sh\n',
  };
  const lines = Object.entries(files).map(([path, body]) => {
    writeFileSync(join(c.data, path), body);
    return `${sha256(body)}  ${path}`;
  });
  writeFileSync(join(c.data, '.geldar-bundle.sha256'), `${lines.join('\n')}\n`);
}

// Each case runs the entrypoint under sh (several processes); the 60 s budget is for a loaded machine, not a weaker assertion.
describe.skipIf(skipWithoutSh())(
  'extra mods: the entrypoint (sh, no docker)',
  { timeout: 60_000 },
  () => {
    it('enabled: copies the mounted chunky jar to mods/chunky.jar with its pin and mode 644', () => {
      const c = setup();
      const r = run(c, ON());
      expect(r.status, r.stderr).toBe(0);
      expect(sha256(readFileSync(copyOf(c), 'utf8'))).toBe(CHUNKY_PIN);
      if (process.platform !== 'win32') expect(statSync(copyOf(c)).mode & 0o777).toBe(0o644);
      expect(existsSync(`${copyOf(c)}.part`)).toBe(false);
    });

    it('a pin that does not match the mounted jar refuses, and neither the final file nor a .part is left', () => {
      const c = setup();
      const r = run(c, { GELDAR_NF_EXTRA_CHUNKY_SHA256: 'b'.repeat(64) });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('does not match');
      expect(existsSync(copyOf(c))).toBe(false);
      expect(existsSync(`${copyOf(c)}.part`)).toBe(false);
    });

    it('not enabled: a stale copy is removed, and nothing is copied', () => {
      const c = setup();
      writeFileSync(copyOf(c), CHUNKY_BODY);
      const r = run(c, { GELDAR_NF_EXTRA_DIR: emptyMount(c) });
      expect(r.status, r.stderr).toBe(0);
      expect(existsSync(copyOf(c))).toBe(false);
    });

    it('disabling after enabling removes the copy on the next start', () => {
      const c = setup();
      expect(run(c, ON()).status).toBe(0);
      expect(existsSync(copyOf(c))).toBe(true);
      const r = run(c, { GELDAR_NF_EXTRA_DIR: emptyMount(c) });
      expect(r.status, r.stderr).toBe(0);
      expect(existsSync(copyOf(c))).toBe(false);
    });

    it('a mounted jar with no pin refuses, and names the variable', () => {
      const c = setup();
      const r = run(c);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('GELDAR_NF_EXTRA_CHUNKY_SHA256 is unset');
      expect(existsSync(copyOf(c))).toBe(false);
    });

    it('a pin with no mounted jar refuses', () => {
      const c = setup();
      const r = run(c, { ...ON(), GELDAR_NF_EXTRA_DIR: emptyMount(c) });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('no chunky jar is mounted');
    });

    it('a pin that is not 64 lowercase hex refuses before any copy', () => {
      const c = setup();
      const r = run(c, { GELDAR_NF_EXTRA_CHUNKY_SHA256: CHUNKY_PIN.toUpperCase() });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('not 64 lowercase hex digits');
      expect(existsSync(copyOf(c))).toBe(false);
    });

    it.skipIf(!CAN_LINK)('a symlink at the copy path refuses, and its target is untouched', () => {
      const c = setup();
      const target = join(c.base, 'target.txt');
      writeFileSync(target, 'keep me');
      symlinkSync(target, copyOf(c));
      const r = run(c, ON());
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('symlink or a directory');
      expect(readFileSync(target, 'utf8')).toBe('keep me');
    });

    it('a directory at the copy path refuses, and the directory stays', () => {
      const c = setup();
      mkdirSync(copyOf(c));
      const r = run(c, ON());
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('symlink or a directory');
      expect(statSync(copyOf(c)).isDirectory()).toBe(true);
    });

    it('bundle mode passes with the extra jar mounted: it is copied after the bundle check', () => {
      const c = setup();
      writeBundle(c);
      const r = run(c, ON());
      expect(r.status, r.stderr).toBe(0);
      expect(sha256(readFileSync(copyOf(c), 'utf8'))).toBe(CHUNKY_PIN);
    });

    it('a second start with the same jar is idempotent', () => {
      const c = setup();
      expect(run(c, ON()).status).toBe(0);
      const r = run(c, ON());
      expect(r.status, r.stderr).toBe(0);
      expect(sha256(readFileSync(copyOf(c), 'utf8'))).toBe(CHUNKY_PIN);
    });

    it('the geldar mod copy is unchanged by an extra mod start', () => {
      const c = setup();
      expect(run(c, ON()).status).toBe(0);
      expect(readFileSync(join(c.mods, 'proxy-compatible-forge.jar'), 'utf8')).toBe(MOD_BODY);
    });
  },
);
