import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { skipWithoutSh, slash } from './scratch-harness.js';

// compose/neoforge/neoforge-entrypoint.sh with BlueMap enabled (its jar mounted and pinned): the bundle mount is verified against its
// manifest and installed into config/bluemap, the marker is written, the java process runs in the data dir. Each case runs the real
// entrypoint under sh with a stub start; the bundle is a copy of the committed one (plugins/bluemap/neoforge).
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const ENTRY = `${ROOT}compose/neoforge/neoforge-entrypoint.sh`;
const BUNDLE = `${ROOT}plugins/bluemap/neoforge`;
// The loader the entrypoint sources (mounted beside the bundle). Its pin is the overlays' GELDAR_NF_EXTRA_BLUEMAP_LOADER_SHA256.
const LOADER = `${ROOT}compose/neoforge/extra-mods-bluemap-config.sh`;
const BUILD = ['26', '1', '2', '126'].join('.');
const MOD_BODY = 'fixture mod bytes';
const INSTALLER_BODY = 'fixture installer bytes';
const JAR_BODY = 'fixture bluemap jar bytes';
const SECRET = 'nf-bm-secret-Q7_w';
const ABSENT = '/nonexistent/geldar-fixture-absent.jar';
const sha512 = (text: string) => createHash('sha512').update(text).digest('hex');
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
const sha256File = (path: string) => sha256(readFileSync(path, 'utf8'));

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

interface Case {
  base: string;
  data: string;
  mount: string;
  env: Record<string, string>;
}

/** A data dir with the pinned mod, installer and bundle list; a start stub that prints its cwd; a mount dir with the bluemap jar. */
function setup(withJar = true): Case {
  const base = mkdtempSync(join(tmpdir(), 'nf-bm-entry-'));
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
  const files: Record<string, string> = {
    '.neoforge-manifest.json': '{}\n',
    'neoforge-installer.jar': INSTALLER_BODY,
    'mods/proxy-compatible-forge.jar': MOD_BODY,
    'run.sh': '#!/bin/sh\n',
  };
  const lines = Object.entries(files).map(([path, body]) => {
    writeFileSync(join(data, path), body);
    return `${sha256(body)}  ${path}`;
  });
  writeFileSync(join(data, '.geldar-bundle.sha256'), `${lines.join('\n')}\n`);
  const start = join(bin, 'start');
  writeFileSync(start, '#!/bin/sh\nprintf "cwd=%s\\n" "$PWD"\n', { mode: 0o755 });
  const secretFile = join(base, 'velocity-forwarding');
  writeFileSync(secretFile, `${SECRET}\n`);
  if (withJar) {
    writeFileSync(join(mount, 'bluemap.jar'), JAR_BODY);
    copyFileSync(LOADER, join(mount, 'bluemap-config.sh'));
  }
  return {
    base,
    data,
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

/** The committed bundle copied to the mount (the default case), or nothing when withBundle is false. */
function mountBundle(c: Case, from = BUNDLE) {
  cpSync(from, join(c.mount, 'bluemap-config'), { recursive: true });
}

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

const ON = (): Record<string, string> => ({
  GELDAR_NF_EXTRA_BLUEMAP_SHA256: sha256(JAR_BODY),
  GELDAR_NF_EXTRA_BLUEMAP_LOADER_SHA256: sha256File(LOADER),
});
const cfgDir = (c: Case) => join(c.data, 'config', 'bluemap');
const installed = (c: Case, rel: string) => join(cfgDir(c), rel);

// Two cases start the entrypoint three times; the 180 s budget is for a loaded machine (the first run timed out at 60 s), not a weaker check.
describe.skipIf(skipWithoutSh())(
  'BlueMap config bundle: the entrypoint (sh, no docker)',
  { timeout: 180_000 },
  () => {
    it('enabled with the loader missing from the mount: refuses before anything is installed or started', () => {
      const c = setup();
      mountBundle(c);
      rmSync(join(c.mount, 'bluemap-config.sh'));
      const r = run(c, ON());
      expect(r.status).not.toBe(0);
      expect(r.stderr).toMatch(/BlueMap loader is missing/);
      expect(existsSync(cfgDir(c))).toBe(false);
      expect(r.stdout).not.toContain('cwd=');
    });

    it('enabled with a loader that does not match its pin (one byte changed): refuses before it is sourced', () => {
      const c = setup();
      mountBundle(c);
      writeFileSync(
        join(c.mount, 'bluemap-config.sh'),
        `${readFileSync(LOADER, 'utf8')}# changed\n`,
      );
      const r = run(c, ON());
      expect(r.status).not.toBe(0);
      expect(r.stderr).toMatch(/does not match its pin/);
      expect(existsSync(cfgDir(c))).toBe(false);
      expect(r.stdout).not.toContain('cwd=');
    });

    it('enabled with the good bundle: installs exactly the manifest files, the marker, and the java cwd is the data dir', () => {
      const c = setup();
      mountBundle(c);
      const r = run(c, ON());
      expect(r.status, r.stderr).toBe(0);
      const manifest = readFileSync(join(BUNDLE, 'MANIFEST.sha256'), 'utf8');
      for (const line of manifest.trim().split('\n')) {
        const [want, rel] = line.split(/ {2}/);
        expect(sha256File(installed(c, rel ?? ''))).toBe(want);
      }
      expect(readdirSync(join(cfgDir(c), 'maps')).sort()).toEqual([
        'end.conf',
        'nether.conf',
        'overworld.conf',
      ]);
      expect(readFileSync(join(cfgDir(c), '.geldar-config.sha256'), 'utf8').trim()).toBe(
        sha256File(join(BUNDLE, 'MANIFEST.sha256')),
      );
      expect(r.stdout).toMatch(/cwd=.*data\s*$/);
    });

    it('enabled but the bundle mount is missing: refuses before anything is installed', () => {
      const c = setup();
      const r = run(c, ON());
      expect(r.status).not.toBe(0);
      expect(r.stderr).toMatch(/BlueMap config bundle .* is missing/);
      expect(existsSync(join(c.data, 'config', 'bluemap'))).toBe(false);
    });

    it('enabled with a changed byte: refuses and installs nothing', () => {
      const c = setup();
      mountBundle(c);
      writeFileSync(join(c.mount, 'bluemap-config', 'plugin.conf'), 'live-player-markers: true\n');
      const r = run(c, ON());
      expect(r.status).not.toBe(0);
      expect(r.stderr).toMatch(/plugin\.conf does not match MANIFEST/);
      expect(existsSync(join(c.data, 'config', 'bluemap'))).toBe(false);
    });

    it('a stray maps/foo.conf is moved to foo.conf.operator-bak and is not left as a .conf', () => {
      const c = setup();
      mountBundle(c);
      expect(run(c, ON()).status).toBe(0);
      writeFileSync(join(cfgDir(c), 'maps', 'foo.conf'), 'stray\n');
      const r = run(c, ON());
      expect(r.status, r.stderr).toBe(0);
      expect(existsSync(installed(c, 'maps/foo.conf'))).toBe(false);
      expect(readFileSync(installed(c, 'maps/foo.conf.operator-bak'), 'utf8')).toBe('stray\n');
    });

    it('a differing core.conf is replaced, one .operator-bak keeps the old one, and a second start changes nothing', () => {
      const c = setup();
      mountBundle(c);
      mkdirSync(cfgDir(c), { recursive: true });
      writeFileSync(installed(c, 'core.conf'), 'operator edit\n');
      expect(run(c, ON()).status).toBe(0);
      expect(readFileSync(installed(c, 'core.conf.operator-bak'), 'utf8')).toBe('operator edit\n');
      expect(sha256File(installed(c, 'core.conf'))).toBe(sha256File(join(BUNDLE, 'core.conf')));
      const before = readdirSync(cfgDir(c)).sort();
      expect(run(c, ON()).status).toBe(0);
      expect(readdirSync(cfgDir(c)).sort()).toEqual(before);
      expect(readFileSync(installed(c, 'core.conf.operator-bak'), 'utf8')).toBe('operator edit\n');
    });

    it('a second, differing operator copy is kept as .operator-bak.<8 hex of its sha256>; the first backup is not overwritten', () => {
      const c = setup();
      mountBundle(c);
      mkdirSync(cfgDir(c), { recursive: true });
      writeFileSync(installed(c, 'core.conf'), 'operator edit\n');
      expect(run(c, ON()).status).toBe(0);
      writeFileSync(installed(c, 'core.conf'), 'second edit\n');
      const alt = `core.conf.operator-bak.${sha256File(installed(c, 'core.conf')).slice(0, 8)}`;
      const r = run(c, ON());
      expect(r.status, r.stderr).toBe(0);
      expect(readFileSync(installed(c, 'core.conf.operator-bak'), 'utf8')).toBe('operator edit\n');
      expect(readFileSync(installed(c, alt), 'utf8')).toBe('second edit\n');
      expect(sha256File(installed(c, 'core.conf'))).toBe(sha256File(join(BUNDLE, 'core.conf')));
    });

    it('a displaced copy identical to the existing .operator-bak makes no new backup', () => {
      const c = setup();
      mountBundle(c);
      mkdirSync(cfgDir(c), { recursive: true });
      writeFileSync(installed(c, 'core.conf'), 'operator edit\n');
      expect(run(c, ON()).status).toBe(0);
      writeFileSync(installed(c, 'core.conf'), 'operator edit\n');
      expect(run(c, ON()).status).toBe(0);
      expect(readdirSync(cfgDir(c)).filter((n) => n.startsWith('core.conf.operator-bak'))).toEqual([
        'core.conf.operator-bak',
      ]);
    });

    it('a same-named sha backup with other content refuses and is not overwritten', () => {
      const c = setup();
      mountBundle(c);
      mkdirSync(cfgDir(c), { recursive: true });
      writeFileSync(installed(c, 'core.conf'), 'operator edit\n');
      expect(run(c, ON()).status).toBe(0);
      writeFileSync(installed(c, 'core.conf'), 'second edit\n');
      const alt = `core.conf.operator-bak.${sha256File(installed(c, 'core.conf')).slice(0, 8)}`;
      writeFileSync(installed(c, alt), 'someone else\n');
      const r = run(c, ON());
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('exists with other content');
      expect(readFileSync(installed(c, alt), 'utf8')).toBe('someone else\n');
      expect(readFileSync(installed(c, 'core.conf.operator-bak'), 'utf8')).toBe('operator edit\n');
    });

    it('packs/ is left alone', () => {
      const c = setup();
      mountBundle(c);
      mkdirSync(join(cfgDir(c), 'packs'), { recursive: true });
      writeFileSync(join(cfgDir(c), 'packs', 'pack.zip'), 'operator pack\n');
      expect(run(c, ON()).status).toBe(0);
      expect(readFileSync(join(cfgDir(c), 'packs', 'pack.zip'), 'utf8')).toBe('operator pack\n');
    });

    it('BlueMap not enabled (no jar mounted): the config dir is not touched and the cwd is not changed', () => {
      const c = setup(false);
      const r = run(c);
      expect(r.status, r.stderr).toBe(0);
      expect(existsSync(join(c.data, 'config', 'bluemap'))).toBe(false);
    });
  },
);
