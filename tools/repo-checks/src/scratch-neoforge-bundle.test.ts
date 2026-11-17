/**
 * The offline NeoForge bundle, build side (docs/runbooks/scratch-stack.md, "Offline bundle"). deploy/scratch/build-neoforge-bundle.sh
 * runs under sh with a stub docker that leaves what a real SETUP_ONLY install leaves in the mounted /data, plus the files a real
 * /data holds that must NOT be packed. The entrypoint's bundle mode is in scratch-neoforge-bundle-check.test.ts. Nothing here
 * starts a container or uses the network.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { type Env, SH, skipWithoutSh, slash, stubs } from './scratch-harness.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const BUILD_SCRIPT = `${ROOT}deploy/scratch/build-neoforge-bundle.sh`;
const BUILD_TEXT = readFileSync(BUILD_SCRIPT, 'utf8');
const OVERLAY_TEXT = readFileSync(`${ROOT}compose/opt-in/scratch-neoforge.yml`, 'utf8');
const PHASE0_TEXT = readFileSync(`${ROOT}compose/phase0.yml`, 'utf8');
const ENTRY_TEXT = readFileSync(`${ROOT}compose/neoforge/neoforge-entrypoint.sh`, 'utf8');

/** Built from parts, so the dotted build never appears literally (the IP-literal check rejects it). */
const BUILD = ['26', '1', '2', '126'].join('.');
const MC = ['26', '1', '2'].join('.');
const MARKER = '.geldar-bundle.sha256';
/** The rcon password the stub writes into server.properties: it must never reach a packed file. */
const RCON = 'stub-rcon-Vq3mZ8';

const cleanup: string[] = [];
afterEach(() => {
  for (const dir of cleanup.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** The stub docker: records each call and, for the install run, writes what a SETUP_ONLY install leaves in /data, and the
 * files a real /data also holds (server.properties with an rcon password, user_jvm_args.txt, ops, world, logs). */
const DOCKER_STUB = [
  '#!/bin/sh',
  'echo "$*" >>"$STUB_DOCKER_LOG"',
  'case " $* " in *" chown -R "*) exit 0 ;; esac',
  'data=""; secret=""',
  'for a in "$@"; do',
  '  case "$a" in',
  '    *:/data) data=$(printf "%s" "$a" | sed "s|:/data$||") ;;',
  '    *:/run/secrets/velocity-forwarding:ro) secret=$(cat "$(printf "%s" "$a" | sed "s|:/run/secrets/velocity-forwarding:ro$||")") ;;',
  '  esac',
  'done',
  '[ -z "$STUB_DOCKER_FAIL" ] || exit 3',
  '[ -z "$STUB_SECRET_OUT" ] || printf "%s" "$secret" >"$STUB_SECRET_OUT"',
  'mkdir -p "$data/config" "$data/mods" "$data/libraries" "$data/world" "$data/logs" "$data/crash-reports"',
  'echo installer >"$data/neoforge-installer.jar"',
  'echo mod >"$data/mods/proxy-compatible-forge.jar"',
  '[ -n "$STUB_SERVER_ENTRY" ] || STUB_SERVER_ENTRY=run.sh',
  'printf \'{"serverEntry":"%s"}\\n\' "$STUB_SERVER_ENTRY" >"$data/.neoforge-manifest.json"',
  'echo run >"$data/run.sh"',
  'echo bat >"$data/run.bat"',
  'echo lib >"$data/libraries/a.jar"',
  'echo "eula=true" >"$data/eula.txt"',
  'echo level >"$data/world/level.dat"',
  'echo log >"$data/logs/latest.log"',
  'echo crash >"$data/crash-reports/c.txt"',
  'echo usercache >"$data/usercache.json"',
  'echo "-Xmx1G" >"$data/user_jvm_args.txt"',
  'echo "x=1" >"$data/.run-neoforge.env"',
  'echo "[]" >"$data/ops.json"',
  'echo rcon >"$data/.rcon-cli.env"',
  'printf "enable-rcon=true\\nrcon.password=%s\\nrcon.port=25575\\n" "$STUB_RCON" >"$data/server.properties"',
  'printf \'secret = "%s"\\n\' "$secret" >"$data/config/proxy-compatible-forge.toml"',
  '[ -z "$STUB_LEAK" ] || printf "%s\\n" "$secret" >"$data/logs/leak.log"',
  '[ -z "$STUB_RCON_LEAK" ] || printf "%s\\n" "$STUB_RCON" >"$data/libraries/leak.jar"',
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
    STUB_RCON: RCON,
    ...extra(s.base),
  };
  const r = spawnSync(SH as string, [slash(BUILD_SCRIPT), slash(out)], { encoding: 'utf8', env });
  return {
    status: r.status,
    stdout: r.stdout,
    stderr: r.stderr,
    out,
    base: s.base,
    docker: dockerCalls(s.base),
  };
}

const dockerCalls = (base: string) => {
  const log = join(base, 'docker.log');
  return existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean) : [];
};
/** The -v values of one docker call line. */
const mounts = (line: string) => line.split(' ').filter((_, i, a) => a[i - 1] === '-v');

const PHASE0_IMAGE =
  /^\s*image: (\S*itzg\/minecraft-server\S*@sha256:[0-9a-f]{64})/m.exec(PHASE0_TEXT)?.[1] ?? '';
const OVERLAY_BUILD = /SCRATCH_NEOFORGE_BUILD:-(\d+)\}/.exec(OVERLAY_TEXT)?.[1] ?? '';
const tarball = (out: string) => join(out, `neoforge-${MC}-build${OVERLAY_BUILD}-bundle.tar.gz`);
/** tar runs in the archive's dir with its bare name: GNU tar reads a drive letter in a path as a host name. */
const members = (tgz: string) =>
  spawnSync('tar', ['-tzf', basename(tgz)], { encoding: 'utf8', cwd: dirname(tgz) })
    .stdout.split('\n')
    .filter(Boolean);
/** Every packed file's text, concatenated (tar -O). */
const packedText = (tgz: string) =>
  spawnSync('tar', ['-xzOf', basename(tgz)], { encoding: 'utf8', cwd: dirname(tgz) }).stdout;

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

    it('a leftover .work.* dir in the output dir is refused, and the message says why', () => {
      const r = build((base) => {
        mkdirSync(join(base, 'out', '.work.abc123'), { recursive: true });
        return {};
      });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('.work.*');
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

    it('the default build is the overlay default; an other build is refused unless a test allows it', () => {
      expect(OVERLAY_BUILD).toBe('126');
      const dflt = build();
      expect(dflt.docker.find((c) => c.startsWith('run '))).toContain(
        `-e NEOFORGE_VERSION=${BUILD}`,
      );
      const refused = build(() => ({ SCRATCH_NEOFORGE_BUILD: '7' }));
      expect(refused.status).toBe(1);
      expect(refused.stderr).toContain('is not the default build');
      expect(refused.docker).toHaveLength(0);
      const allowed = build(() => ({
        SCRATCH_NEOFORGE_BUILD: '7',
        GELDAR_NF_ALLOW_OTHER_BUILD: '1',
      }));
      expect(allowed.docker.find((c) => c.startsWith('run '))).toContain(
        `-e NEOFORGE_VERSION=${MC}.7`,
      );
    });

    it('a relative output dir is made absolute before docker mounts it', () => {
      const s = stubs();
      cleanup.push(s.base);
      writeFileSync(join(s.base, 'bin', 'docker'), DOCKER_STUB, { mode: 0o755 });
      const env: Env = {
        ...s.env,
        STUB_DOCKER_LOG: slash(join(s.base, 'docker.log')),
        STUB_SECRET_OUT: slash(join(s.base, 'secret.txt')),
        STUB_RCON: RCON,
      };
      const r = spawnSync(SH as string, [slash(BUILD_SCRIPT), 'rel-out'], {
        encoding: 'utf8',
        env,
        cwd: s.base,
      });
      expect(r.status).toBe(0);
      const run = dockerCalls(s.base).find((c) => c.startsWith('run ')) ?? '';
      const data = mounts(run).find((m) => m.endsWith(':/data')) ?? '';
      expect(data).toMatch(/^(\/|[A-Za-z]:\/)/);
      expect(
        existsSync(join(s.base, 'rel-out', `neoforge-${MC}-build${OVERLAY_BUILD}-bundle.tar.gz`)),
      ).toBe(true);
    });

    it('the install run has exactly three mounts (data dir, entrypoint, secret), the two files read-only, no socket', () => {
      const r = build();
      const run = r.docker.find((c) => c.startsWith('run ')) ?? '';
      const vs = mounts(run);
      expect(vs).toHaveLength(3);
      expect(vs.filter((v) => v.endsWith(':/data'))).toHaveLength(1);
      expect(vs.filter((v) => v.endsWith(':/geldar/neoforge-entrypoint.sh:ro'))).toHaveLength(1);
      expect(vs.filter((v) => v.endsWith(':/run/secrets/velocity-forwarding:ro'))).toHaveLength(1);
      expect(run).not.toMatch(/docker\.sock/);
    });

    it('packs only the allow-listed install files: no server.properties, config, world, logs, ops or rcon files', () => {
      const r = build();
      expect(r.status).toBe(0);
      const tgz = tarball(r.out);
      const all = members(tgz);
      const packed = all.filter((m) => m !== MARKER).sort();
      expect(packed).toEqual([
        '.neoforge-manifest.json',
        'libraries/a.jar',
        'mods/proxy-compatible-forge.jar',
        'neoforge-installer.jar',
        'run.bat',
        'run.sh',
      ]);
      for (const m of all)
        expect(m).not.toMatch(
          /^(config|world|logs|crash-reports)\/|server\.properties|user_jvm_args|\.run-neoforge\.env|eula\.txt|usercache|ops\.json|\.rcon-cli/,
        );

      const markerText = spawnSync('tar', ['-xzOf', basename(tgz), MARKER], {
        encoding: 'utf8',
        cwd: dirname(tgz),
      }).stdout;
      const listed = markerText
        .trim()
        .split('\n')
        .map((l) => l.split('  ')[1]);
      expect(listed.slice().sort()).toEqual(packed);
      expect(existsSync(join(r.out, 'bundle-files.sha256'))).toBe(false);
      const bundleHash = createHash('sha256').update(readFileSync(tgz)).digest('hex');
      expect(readFileSync(join(r.out, 'bundle.sha256'), 'utf8')).toContain(bundleHash);
      expect(r.stdout).toContain(`size: ${statSync(tgz).size} bytes`);
      expect(r.stdout).toContain(`files: ${packed.length}`);
      expect(readdirSync(r.out).some((n) => n.startsWith('.work.'))).toBe(false);
    });

    it('the rcon password is in no packed file, and never printed', () => {
      const r = build();
      expect(r.status).toBe(0);
      expect(packedText(tarball(r.out))).not.toContain(RCON);
      expect(r.stdout + r.stderr).not.toContain(RCON);
    });

    it('a rcon password that leaks into a packed file aborts the build, names the file, and does not print the value', () => {
      const r = build(() => ({ STUB_RCON_LEAK: '1' }));
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('rcon password appears in these packed files');
      expect(r.stderr).toContain('libraries/leak.jar');
      expect(existsSync(tarball(r.out))).toBe(false);
      expect(r.stdout + r.stderr).not.toContain(RCON);
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

    it('on Linux, a failed install still runs the chown container after the install, before the work dir goes', () => {
      const r = build(() => ({ STUB_DOCKER_FAIL: '1', STUB_UNAME: 'Linux' }));
      expect(r.status).not.toBe(0);
      const install = r.docker.findIndex((c) => c.startsWith('run ') && !c.includes('--user 0'));
      const chown = r.docker.findIndex((c) => /--user 0 .*chown -R/.test(c));
      expect(install).toBeGreaterThanOrEqual(0);
      expect(chown).toBeGreaterThan(install);
      expect(readdirSync(r.out).some((n) => n.startsWith('.work.'))).toBe(false);
    });

    it.each(['../run.sh', '/bin/sh'])(
      'a manifest serverEntry of %s is refused before anything is bundled',
      (entry) => {
        const r = build(() => ({ STUB_SERVER_ENTRY: entry }));
        expect(r.status).toBe(1);
        expect(r.stderr).toContain('no usable serverEntry');
        expect(existsSync(tarball(r.out))).toBe(false);
      },
    );

    it('turns tracing off for itself, and its header says it must not run under sh -x', () => {
      expect(BUILD_TEXT).toMatch(/^set \+x$/m);
      expect(BUILD_TEXT).toContain('sh -x');
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
