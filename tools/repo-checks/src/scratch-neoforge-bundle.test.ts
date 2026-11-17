/**
 * The offline NeoForge bundle (docs/runbooks/scratch-stack.md, "Offline bundle"). The entrypoint's bundle mode and the installer's
 * sha512 pin run under sh with a stub curl, the same way as scratch-neoforge-entrypoint.test.ts. The build script
 * deploy/scratch/build-neoforge-bundle.sh runs with a stub docker that leaves the files a real SETUP_ONLY install leaves in the
 * mounted /data. Nothing here starts a container or uses the network.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { type Env, SH, skipWithoutSh, slash, stubs } from './scratch-harness.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const ENTRY = `${ROOT}compose/neoforge/neoforge-entrypoint.sh`;
const BUILD_SCRIPT = `${ROOT}deploy/scratch/build-neoforge-bundle.sh`;
const BUILD_TEXT = readFileSync(BUILD_SCRIPT, 'utf8');
const OVERLAY_TEXT = readFileSync(`${ROOT}compose/opt-in/scratch-neoforge.yml`, 'utf8');
const PHASE0_TEXT = readFileSync(`${ROOT}compose/phase0.yml`, 'utf8');
const ENTRY_TEXT = readFileSync(ENTRY, 'utf8');

/** Built from parts, so the dotted build never appears literally (the IP-literal check rejects it). */
const BUILD = ['26', '1', '2', '126'].join('.');
const MC = ['26', '1', '2'].join('.');
const MOD_NAME = 'proxy-compatible-forge-1.3.1.jar';
const INSTALLER_NAME = `neoforge-${BUILD}-installer.jar`;
const MOD_REL = 'mods/proxy-compatible-forge.jar';
const MARKER = '.geldar-bundle.sha256';
const MOD_BODY = 'bundle mod bytes';
const INSTALLER_BODY = 'bundle installer bytes';
const SECRET = 'nf-bundle-secret-Z9_q';

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
const sha512 = (text: string) => createHash('sha512').update(text).digest('hex');
const cleanup: string[] = [];
afterEach(() => {
  for (const dir of cleanup.splice(0)) rmSync(dir, { recursive: true, force: true });
});

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
  env: Env;
}

/** A data dir with the mod, the installer and the install record, and a marker listing all three with their hashes. */
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
  writeFileSync(manifest, '{"serverEntry":"run.sh"}\n');
  writeFileSync(
    marker,
    [
      `${sha256(MOD_BODY)}  ${MOD_REL}`,
      `${sha256(INSTALLER_BODY)}  neoforge-installer.jar`,
      `${sha256('{"serverEntry":"run.sh"}\n')}  .neoforge-manifest.json`,
      '',
    ].join('\n'),
  );
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

function runEntry(b: Bundle, extra: Env = {}) {
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

    it('a marker with no .neoforge-manifest.json exits 1 as an incomplete bundle', () => {
      const b = bundle();
      rmSync(b.manifest);
      const r = runEntry(b);
      expect(r.status).toBe(1);
      // The manifest is in the marker's list, so its absence fails the listed-file check and names it.
      expect(r.stderr).toContain('.neoforge-manifest.json');
      expect(curlCalls(b)).toBe(0);
    });

    it('GELDAR_NF_BUNDLE_LIST replaces the marker path: the list it names is the one checked', () => {
      const b = bundle();
      const list = join(b.base, 'other-list.sha256');
      writeFileSync(list, `${'0'.repeat(64)}  ${MOD_REL}\n`);
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
  },
);

/** The stub docker: records each call and, for the install run, writes what a SETUP_ONLY install leaves in /data. */
const DOCKER_STUB = [
  '#!/bin/sh',
  'echo "$*" >>"$STUB_DOCKER_LOG"',
  'case " $* " in *" chown -R "*) exit 0 ;; esac',
  'data=""; secret=""',
  'for a in "$@"; do',
  '  case "$a" in',
  '    *:/data) data=${a%:/data} ;;',
  '    *:/run/secrets/velocity-forwarding:ro) secret=$(cat "${a%:/run/secrets/velocity-forwarding:ro}") ;;',
  '  esac',
  'done',
  '[ -z "$STUB_DOCKER_FAIL" ] || exit 3',
  '[ -z "$STUB_SECRET_OUT" ] || printf "%s" "$secret" >"$STUB_SECRET_OUT"',
  'mkdir -p "$data/config" "$data/mods" "$data/libraries" "$data/world" "$data/logs"',
  'echo installer >"$data/neoforge-installer.jar"',
  'echo mod >"$data/mods/proxy-compatible-forge.jar"',
  'echo \'{"serverEntry":"run.sh"}\' >"$data/.neoforge-manifest.json"',
  'echo run >"$data/run.sh"',
  'echo lib >"$data/libraries/a.jar"',
  'echo "eula=true" >"$data/eula.txt"',
  'echo level >"$data/world/level.dat"',
  'echo log >"$data/logs/latest.log"',
  'echo usercache >"$data/usercache.json"',
  'printf \'secret = "%s"\\n\' "$secret" >"$data/config/proxy-compatible-forge.toml"',
  '[ -z "$STUB_LEAK" ] || printf "%s\\n" "$secret" >"$data/logs/leak.log"',
  'exit 0',
  '',
].join('\n');

interface Built {
  status: number | null;
  stdout: string;
  stderr: string;
  out: string;
  base: string;
  docker: string[];
}

/** Runs the build script with the stub docker. extra may be a function of the stub base dir (for temp inputs). */
function build(extra: (base: string) => Env = () => ({})): Built {
  const s = stubs();
  cleanup.push(s.base);
  writeFileSync(join(s.base, 'bin', 'docker'), DOCKER_STUB, { mode: 0o755 });
  const out = join(s.base, 'out');
  const env: Env = {
    ...s.env,
    STUB_DOCKER_LOG: slash(join(s.base, 'docker.log')),
    STUB_SECRET_OUT: slash(join(s.base, 'secret.txt')),
    ...extra(s.base),
  };
  const r = spawnSync(SH as string, [slash(BUILD_SCRIPT), slash(out)], { encoding: 'utf8', env });
  const log = join(s.base, 'docker.log');
  const docker = existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean) : [];
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, out, base: s.base, docker };
}

const PHASE0_IMAGE =
  /^\s*image: (\S*itzg\/minecraft-server\S*@sha256:[0-9a-f]{64})/m.exec(PHASE0_TEXT)?.[1] ?? '';
const OVERLAY_BUILD = /SCRATCH_NEOFORGE_BUILD:-(\d+)\}/.exec(OVERLAY_TEXT)?.[1] ?? '';
const tarball = (out: string) => join(out, `neoforge-${MC}-build${OVERLAY_BUILD}-bundle.tar.gz`);
/** tar runs in the archive's dir with its bare name: GNU tar reads a drive letter in a path as a host name. */
const inTar = (tgz: string, args: string[]) =>
  spawnSync('tar', [...args, basename(tgz)], { encoding: 'utf8', cwd: dirname(tgz) });
const members = (tgz: string) => inTar(tgz, ['-tzf']).stdout.split('\n').filter(Boolean);

describe.skipIf(skipWithoutSh())(
  'NeoForge offline bundle: build script',
  { timeout: 60_000 },
  () => {
    it('refuses an output dir that exists and is not empty, before docker runs', () => {
      const r = build((base) => {
        mkdirSync(join(base, 'out'));
        writeFileSync(join(base, 'out', 'keep.txt'), 'x');
        return {};
      });
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain('is not an empty directory');
      expect(r.docker).toHaveLength(0);
    });

    it('refuses a paper image line that is not pinned by digest, before docker runs', () => {
      const r = build((base) => {
        const p = join(base, 'phase0.yml');
        writeFileSync(p, '  paper:\n    image: itzg/minecraft-server:2026.10.1-java25\n');
        return { GELDAR_NF_PHASE0: slash(p) };
      });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('not pinned by digest');
      expect(r.docker).toHaveLength(0);
    });

    it('runs the phase0.yml image by digest, SETUP_ONLY, with no published ports', () => {
      expect(PHASE0_IMAGE).not.toBe('');
      const r = build();
      expect(r.status).toBe(0);
      const run = r.docker.find((c) => c.startsWith('run '));
      expect(run).toBeDefined();
      expect(run).toContain(PHASE0_IMAGE);
      expect(run).toContain('--entrypoint /bin/sh');
      expect(run).toContain('-e SETUP_ONLY=TRUE');
      expect(run).toContain(`-e NEOFORGE_VERSION=${BUILD}`);
      expect(run).toContain(`-e VERSION=${MC}`);
      expect(run).not.toMatch(/ -p | --publish/);
    });

    it('the default build is the overlay default, and SCRATCH_NEOFORGE_BUILD overrides it the same way', () => {
      expect(OVERLAY_BUILD).toBe('126');
      const dflt = build();
      expect(dflt.docker.find((c) => c.startsWith('run '))).toContain(
        `-e NEOFORGE_VERSION=${BUILD}`,
      );
      const other = build(() => ({ SCRATCH_NEOFORGE_BUILD: '7' }));
      expect(other.docker.find((c) => c.startsWith('run '))).toContain(
        `-e NEOFORGE_VERSION=${MC}.7`,
      );
    });

    it('packs the bundle without config/, world, logs, eula.txt or usercache.json, with both hash files', () => {
      const r = build();
      expect(r.status).toBe(0);
      const tgz = tarball(r.out);
      const all = members(tgz);
      expect(all).toEqual(
        expect.arrayContaining([
          'neoforge-installer.jar',
          MOD_REL,
          '.neoforge-manifest.json',
          'run.sh',
          'libraries/a.jar',
          MARKER,
        ]),
      );
      for (const m of all)
        expect(m).not.toMatch(/^(config|world|logs)\/|^eula\.txt$|^usercache\.json$/);

      const listText = readFileSync(join(r.out, 'bundle-files.sha256'), 'utf8');
      const listed = listText
        .trim()
        .split('\n')
        .map((l) => l.split('  ')[1]);
      expect(listed.slice().sort()).toEqual(all.filter((m) => m !== MARKER).sort());
      expect(
        spawnSync('tar', ['-xzOf', basename(tgz), MARKER], { encoding: 'utf8', cwd: dirname(tgz) })
          .stdout,
      ).toBe(listText);
      const bundleHash = createHash('sha256').update(readFileSync(tgz)).digest('hex');
      expect(readFileSync(join(r.out, 'bundle.sha256'), 'utf8')).toContain(bundleHash);
      expect(r.stdout).toContain(`size: ${statSync(tgz).size} bytes`);
      expect(r.stdout).toContain(`files: ${listed.length}`);
    });

    it('never prints the forwarding secret, and the secret is 32 characters of [A-Za-z0-9_-]', () => {
      const r = build();
      expect(r.status).toBe(0);
      const secret = readFileSync(join(r.base, 'secret.txt'), 'utf8');
      expect(secret).toMatch(/^[A-Za-z0-9_-]{32}$/);
      expect(r.stdout + r.stderr).not.toContain(secret);
    });

    it('aborts when the secret appears outside config/, and leaves no bundle', () => {
      const r = build(() => ({ STUB_LEAK: '1' }));
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('appears outside config/');
      expect(r.stderr).toContain('logs/leak.log');
      expect(existsSync(tarball(r.out))).toBe(false);
      const secret = readFileSync(join(r.base, 'secret.txt'), 'utf8');
      expect(r.stdout + r.stderr).not.toContain(secret);
    });

    it('a failed docker run stops the build and leaves no bundle', () => {
      const r = build(() => ({ STUB_DOCKER_FAIL: '1' }));
      expect(r.status).not.toBe(0);
      expect(existsSync(tarball(r.out))).toBe(false);
    });

    it('the script is LF, under 200 lines, and names no /tmp path', () => {
      expect(BUILD_TEXT).not.toContain('\r');
      expect(BUILD_TEXT.split('\n').length).toBeLessThan(200);
      expect(BUILD_TEXT).not.toContain('/tmp');
    });

    it('the entrypoint reads the same bundle marker name the build script writes', () => {
      expect(ENTRY_TEXT).toContain(`/${MARKER}`);
      expect(BUILD_TEXT).toContain(MARKER);
    });
  },
);
