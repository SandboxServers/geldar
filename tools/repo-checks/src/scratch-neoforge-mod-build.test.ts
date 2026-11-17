/**
 * The desktop build script for the NeoForge mod jar (deploy/scratch/build-neoforge-mod.sh, docs/runbooks/scratch-stack.md,
 * "Building the mod jar"). Each test copies the script into a temp tree with a neoforge/ of its own (the real gradle.properties
 * and wrapper properties), and runs it under sh with a stub Gradle (GELDAR_MOD_GRADLE) that copies fixture jars into
 * build/libs. Nothing here runs Gradle or the network. The jar fixtures are zips built in this file.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { type Env, SH, skipWithoutSh, slash } from './scratch-harness.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SCRIPT_TEXT = readFileSync(`${ROOT}deploy/scratch/build-neoforge-mod.sh`, 'utf8');
const WRAPPER_PROPS = readFileSync(
  `${ROOT}neoforge/gradle/wrapper/gradle-wrapper.properties`,
  'utf8',
);
const GRADLE_PROPS = readFileSync(`${ROOT}neoforge/gradle.properties`, 'utf8');

const JAR = 'geldar-neoforge-0.1.0.jar';
const SOURCES = 'geldar-neoforge-0.1.0-sources.jar';
const JAVADOC = 'geldar-neoforge-0.1.0-javadoc.jar';
const MODS = 'META-INF/neoforge.mods.toml';
const MODS_TEXT = 'modLoader = "javafml"\n';

/** The stub Gradle: it records its arguments, fails when STUB_GRADLE_FAIL is set, and copies the named fixtures into build/libs. */
const GRADLE_STUB = [
  '#!/bin/sh',
  'echo "$*" >>"$STUB_GRADLE_LOG"',
  'printf "GRADLE_OPTS=%s\\nJAVA_TOOL_OPTIONS=%s\\nGRADLE_USER_HOME=%s\\n" "$GRADLE_OPTS" "$JAVA_TOOL_OPTIONS" "$GRADLE_USER_HOME" >"$STUB_GRADLE_ENV"',
  '[ -z "$STUB_GRADLE_FAIL" ] || exit 1',
  'mkdir -p build/libs',
  'for j in $STUB_GRADLE_JARS; do cp "$STUB_GRADLE_SRC/$j" build/libs/; done',
  'exit 0',
  '',
].join('\n');

/** The zip CRC-32, bit by bit: the fixtures are a few bytes, so no table is needed. */
function crc32(data: Buffer): number {
  let c = 0xffffffff;
  for (const b of data) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** A zip with stored (uncompressed) entries, written by hand: the jar fixtures need no JDK. */
function storedZip(entries: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(entries)) {
    const nameBuf = Buffer.from(name);
    const data = Buffer.from(text);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const count = Object.keys(entries).length;
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(count, 8);
  eocd.writeUInt16LE(count, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

/** The commit an export is named after: 40 lowercase hex, as the runbook's git rev-parse gives. */
const COMMIT = 'ab'.repeat(20);

const GOOD = { [MODS]: MODS_TEXT, 'com/geldar/Mod.class': 'cafe' };
const WITH_JAVA = { ...GOOD, 'com/geldar/Mod.java': 'class Mod {}' };

const cleanup: string[] = [];
afterEach(() => {
  for (const dir of cleanup.splice(0)) rmSync(dir, { recursive: true, force: true });
});

interface Setup {
  base: string;
  tree: string;
  script: string;
  log: string;
  out: string;
}

/** A temp tree with the script and a neoforge/ of its own. git true also makes it a git repo with one commit. */
function setup(git: boolean): Setup {
  const base = mkdtempSync(join(tmpdir(), 'nf-mod-build-'));
  cleanup.push(base);
  const tree = join(base, 'tree');
  const script = join(tree, 'deploy', 'scratch', 'build-neoforge-mod.sh');
  mkdirSync(join(tree, 'deploy', 'scratch'), { recursive: true });
  writeFileSync(script, SCRIPT_TEXT);
  const nf = join(tree, 'neoforge');
  mkdirSync(join(nf, 'gradle', 'wrapper'), { recursive: true });
  writeFileSync(join(nf, 'gradle.properties'), GRADLE_PROPS);
  writeFileSync(join(nf, 'gradle', 'wrapper', 'gradle-wrapper.properties'), WRAPPER_PROPS);
  writeFileSync(join(base, 'stub-gradle.sh'), GRADLE_STUB, { mode: 0o755 });
  mkdirSync(join(base, 'home'));
  mkdirSync(join(base, 'fixtures'));
  if (git) {
    gitIn(tree, ['init', '-q']);
    gitIn(tree, ['add', '-A']);
    gitIn(tree, [
      '-c',
      'user.name=test',
      '-c',
      'user.email=test@example.invalid',
      'commit',
      '-q',
      '-m',
      'init',
    ]);
  }
  return { base, tree, script, log: join(base, 'gradle.log'), out: join(base, 'out') };
}

function gitIn(dir: string, args: string[]): string {
  const r = spawnSync('git', ['-C', slash(dir), ...args], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH ?? '',
      SYSTEMROOT: process.env.SYSTEMROOT ?? '',
      HOME: slash(dir),
    },
  });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout;
}

/** Writes a fixture jar; the stub copies it into build/libs under its own name. */
function fixture(s: Setup, name: string, entries: Record<string, string>): void {
  writeFileSync(join(s.base, 'fixtures', name), storedZip(entries));
}

/** Runs the script with the stub Gradle. The default fixtures are the good jar only; extra sets the stub's environment. */
function run(s: Setup, args: string[], extra: Env = {}) {
  const env: Env = {
    PATH: process.env.PATH ?? '',
    SYSTEMROOT: process.env.SYSTEMROOT ?? '',
    HOME: slash(join(s.base, 'home')),
    GELDAR_MOD_GRADLE: slash(join(s.base, 'stub-gradle.sh')),
    STUB_GRADLE_LOG: slash(s.log),
    STUB_GRADLE_SRC: slash(join(s.base, 'fixtures')),
    STUB_GRADLE_JARS: JAR,
    STUB_GRADLE_ENV: slash(join(s.base, 'gradle.env')),
    GELDAR_MOD_ALLOW_SEAM: '1',
    GELDAR_MOD_BUILD_COMMIT: COMMIT,
    ...extra,
  };
  for (const key of Object.keys(env)) if (env[key] === undefined) delete env[key];
  const r = spawnSync(SH as string, [slash(s.script), ...args], {
    encoding: 'utf8',
    env: env as Record<string, string>,
  });
  const gradle = existsSync(s.log) ? readFileSync(s.log, 'utf8').split('\n').filter(Boolean) : [];
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, gradle };
}

const sha256 = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
const LISTER =
  spawnSync('jar', ['--version']).error === undefined ||
  spawnSync('unzip', ['-v']).error === undefined;
/** The jar checks read the entries with jar or unzip: without either, the sh tests cannot run (a CI run fails, not skips). */
function skipWithoutLister(): boolean {
  if (LISTER) return false;
  if (process.env.CI)
    throw new Error('neither jar nor unzip is on PATH and CI is set: the jar checks must run');
  return true;
}

describe.skipIf(skipWithoutSh() || skipWithoutLister())(
  'NeoForge mod jar: desktop build script',
  { timeout: 60_000 },
  () => {
    it('refuses a relative output dir before the build runs', () => {
      const s = setup(false);
      const r = run(s, ['out']);
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain('must be an absolute path');
      expect(r.gradle).toHaveLength(0);
    });

    it('refuses an output dir that is not empty, before the build runs', () => {
      const s = setup(false);
      mkdirSync(s.out);
      writeFileSync(join(s.out, 'keep.txt'), 'x');
      fixture(s, JAR, GOOD);
      const r = run(s, [slash(s.out)]);
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain('is not an empty directory');
      expect(r.gradle).toHaveLength(0);
    });

    it('refuses when the build leaves no jar, and writes nothing', () => {
      const s = setup(false);
      const r = run(s, [slash(s.out)], { GELDAR_MOD_BUILD_FROM_EXPORT: '1', STUB_GRADLE_JARS: '' });
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain('no jar in');
      expect(existsSync(s.out)).toBe(false);
    });

    it('refuses when the build leaves two jars, and writes nothing', () => {
      const s = setup(false);
      fixture(s, JAR, GOOD);
      fixture(s, 'geldar-neoforge-0.1.0-dev.jar', GOOD);
      const r = run(s, [slash(s.out)], {
        GELDAR_MOD_BUILD_FROM_EXPORT: '1',
        STUB_GRADLE_JARS: `${JAR} geldar-neoforge-0.1.0-dev.jar`,
      });
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain('jars in');
      expect(r.stderr).toContain('exactly one');
      expect(existsSync(s.out)).toBe(false);
    });

    it('refuses a jar without META-INF/neoforge.mods.toml, and writes nothing', () => {
      const s = setup(false);
      fixture(s, JAR, { 'com/geldar/Mod.class': 'cafe' });
      const r = run(s, [slash(s.out)], { GELDAR_MOD_BUILD_FROM_EXPORT: '1' });
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain('neoforge.mods.toml');
      expect(existsSync(s.out)).toBe(false);
    });

    it('refuses a jar that packs in a .java source, and writes nothing', () => {
      const s = setup(false);
      fixture(s, JAR, WITH_JAVA);
      const r = run(s, [slash(s.out)], { GELDAR_MOD_BUILD_FROM_EXPORT: '1' });
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain('.java source');
      expect(existsSync(s.out)).toBe(false);
    });

    it('a failing build writes nothing and says so', () => {
      const s = setup(false);
      fixture(s, JAR, GOOD);
      const r = run(s, [slash(s.out)], {
        GELDAR_MOD_BUILD_FROM_EXPORT: '1',
        STUB_GRADLE_FAIL: '1',
      });
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain('no jar written');
      expect(existsSync(s.out)).toBe(false);
    });

    it('refuses a wrapper with no distribution checksum, before the build runs', () => {
      const s = setup(false);
      writeFileSync(
        join(s.tree, 'neoforge', 'gradle', 'wrapper', 'gradle-wrapper.properties'),
        WRAPPER_PROPS.replace(/^distributionSha256Sum=.*\n/m, ''),
      );
      fixture(s, JAR, GOOD);
      const r = run(s, [slash(s.out)], { GELDAR_MOD_BUILD_FROM_EXPORT: '1' });
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain('distributionSha256Sum');
      expect(r.gradle).toHaveLength(0);
    });

    it('writes the jar, a sha256 file that sha256sum agrees with, and the build-info; the build gets only the build task', () => {
      const s = setup(false);
      fixture(s, JAR, GOOD);
      fixture(s, SOURCES, WITH_JAVA);
      fixture(s, JAVADOC, { 'index.html': '<html>' });
      const r = run(s, [slash(s.out)], {
        GELDAR_MOD_BUILD_FROM_EXPORT: '1',
        STUB_GRADLE_JARS: `${JAR} ${SOURCES} ${JAVADOC}`,
      });
      expect(r.status, r.stderr).toBe(0);
      expect(r.gradle).toEqual(['build']);
      const jarOut = join(s.out, 'geldar-neoforge.jar');
      expect(readFileSync(jarOut).equals(readFileSync(join(s.base, 'fixtures', JAR)))).toBe(true);
      const hash = sha256(jarOut);
      expect(readFileSync(`${jarOut}.sha256`, 'utf8')).toBe(`${hash}  geldar-neoforge.jar\n`);
      const tool = spawnSync('sha256sum', ['geldar-neoforge.jar'], {
        cwd: slash(s.out),
        encoding: 'utf8',
      });
      expect(tool.stdout.split(' ')[0]).toBe(hash);
      const info = readFileSync(join(s.out, 'geldar-neoforge.build-info'), 'utf8');
      expect(info).toContain(`commit=${COMMIT} (export)\n`);
      expect(info).toMatch(/^built_utc=\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/m);
      expect(info).toMatch(/^gradle_wrapper=9\.8\.2$/m);
      expect(info).toMatch(/^java=.+$/m);
      expect(info).toContain(`jar_sha256=${hash}`);
      expect(r.stdout).toContain(`sha256: ${hash}`);
    });

    it('refuses a dirty git tree before the build runs', () => {
      const s = setup(true);
      fixture(s, JAR, GOOD);
      appendFileSync(join(s.tree, 'neoforge', 'gradle.properties'), 'x=1\n');
      const r = run(s, [slash(s.out)]);
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain('changes or untracked files');
      expect(r.gradle).toHaveLength(0);
      expect(existsSync(s.out)).toBe(false);
    });

    it('builds from a clean git tree and records the commit in the build-info', () => {
      const s = setup(true);
      fixture(s, JAR, GOOD);
      const head = gitIn(s.tree, ['rev-parse', 'HEAD']).trim();
      const r = run(s, [slash(s.out)]);
      expect(r.status, r.stderr).toBe(0);
      expect(r.gradle).toEqual(['build']);
      expect(readFileSync(join(s.out, 'geldar-neoforge.build-info'), 'utf8')).toContain(
        `commit=${head}`,
      );
    });

    it('refuses a tree with no .git unless GELDAR_MOD_BUILD_FROM_EXPORT=1 is set', () => {
      const s = setup(false);
      fixture(s, JAR, GOOD);
      const r = run(s, [slash(s.out)]);
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain('GELDAR_MOD_BUILD_FROM_EXPORT');
      expect(r.gradle).toHaveLength(0);
    });

    it('refuses an export with no GELDAR_MOD_BUILD_COMMIT, before the build runs', () => {
      const s = setup(false);
      fixture(s, JAR, GOOD);
      const r = run(s, [slash(s.out)], {
        GELDAR_MOD_BUILD_FROM_EXPORT: '1',
        GELDAR_MOD_BUILD_COMMIT: undefined,
      });
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain('GELDAR_MOD_BUILD_COMMIT');
      expect(r.gradle).toHaveLength(0);
      expect(existsSync(s.out)).toBe(false);
    });

    it('refuses a commit that is not exactly 40 lowercase hex, before the build runs', () => {
      const s = setup(false);
      fixture(s, JAR, GOOD);
      const bad = [
        'ab'.repeat(19),
        'ab'.repeat(21),
        'AB'.repeat(20),
        `${'ab'.repeat(19)}a\n`,
        'zz'.repeat(20),
        '',
      ];
      for (const value of bad) {
        const r = run(s, [slash(s.out)], {
          GELDAR_MOD_BUILD_FROM_EXPORT: '1',
          GELDAR_MOD_BUILD_COMMIT: value,
        });
        expect(r.status, JSON.stringify(value)).not.toBe(0);
        expect(r.stderr, JSON.stringify(value)).toContain('GELDAR_MOD_BUILD_COMMIT');
        expect(r.gradle).toHaveLength(0);
      }
      expect(existsSync(s.out)).toBe(false);
    });

    it('clears the ambient Gradle and JVM options before the build; GRADLE_USER_HOME is kept', () => {
      const s = setup(false);
      fixture(s, JAR, GOOD);
      const home = slash(join(s.base, 'gradle-home'));
      const r = run(s, [slash(s.out)], {
        GELDAR_MOD_BUILD_FROM_EXPORT: '1',
        GRADLE_OPTS: '-Dorg.gradle.dependency.verification=off',
        JAVA_TOOL_OPTIONS: '-Dorg.gradle.dependency.verification=off',
        GRADLE_USER_HOME: home,
      });
      expect(r.status, r.stderr).toBe(0);
      expect(r.gradle).toEqual(['build']);
      const seen = readFileSync(join(s.base, 'gradle.env'), 'utf8');
      expect(seen).toContain('GRADLE_OPTS=\n');
      expect(seen).toContain('JAVA_TOOL_OPTIONS=\n');
      expect(seen).toContain(`GRADLE_USER_HOME=${home}\n`);
      expect(seen).not.toContain('verification=off');
    });

    it('refuses GELDAR_MOD_GRADLE unless GELDAR_MOD_ALLOW_SEAM=1 is set, before the build runs', () => {
      const s = setup(false);
      fixture(s, JAR, GOOD);
      const r = run(s, [slash(s.out)], {
        GELDAR_MOD_BUILD_FROM_EXPORT: '1',
        GELDAR_MOD_ALLOW_SEAM: undefined,
      });
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain('GELDAR_MOD_ALLOW_SEAM');
      expect(r.gradle).toHaveLength(0);
      expect(existsSync(s.out)).toBe(false);
    });

    it('refuses a git tree with an untracked file under neoforge/, before the build runs', () => {
      const s = setup(true);
      fixture(s, JAR, GOOD);
      writeFileSync(join(s.tree, 'neoforge', 'stray.txt'), 'x');
      const r = run(s, [slash(s.out)]);
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain('changes or untracked files');
      expect(r.gradle).toHaveLength(0);
      expect(existsSync(s.out)).toBe(false);
    });

    it('a failure after the jar is copied leaves no partial output, and removes the dir the script made', () => {
      const s = setup(false);
      fixture(s, JAR, GOOD);
      const bin = join(s.base, 'bin');
      mkdirSync(bin);
      writeFileSync(join(bin, 'sha256sum'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
      const r = run(s, [slash(s.out)], {
        GELDAR_MOD_BUILD_FROM_EXPORT: '1',
        PATH: [slash(bin), process.env.PATH ?? ''].join(delimiter),
      });
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain('sha256sum failed');
      for (const f of [JAR, `${JAR}.sha256`, 'geldar-neoforge.build-info']) {
        expect(existsSync(join(s.out, f))).toBe(false);
      }
      expect(existsSync(s.out)).toBe(false);
    });

    it('the script text never turns dependency verification or the offline checks off', () => {
      expect(SCRIPT_TEXT).not.toMatch(
        /--offline|--no-verify|verification=off|--refresh-dependencies/,
      );
      expect(SCRIPT_TEXT).not.toMatch(/-x\s+verify/);
    });
  },
);
