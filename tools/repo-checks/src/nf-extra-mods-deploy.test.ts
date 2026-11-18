import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { skipWithoutSh, slash } from './scratch-harness.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const DEPLOY = `${ROOT}deploy/nf-deploy.sh`;
const LIB = `${ROOT}deploy/nf-extra-mods-lib.sh`;
const JAR_BODY = 'fixture extra mod jar';
const JAR_PIN = createHash('sha256').update(JAR_BODY).digest('hex');

const CAN_LINK = (() => {
  const dir = mkdtempSync(join(tmpdir(), 'nf-extra-dlink-'));
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

/**
 * A driver that defines die, need, say and check_host_file (extracted from deploy/nf-deploy.sh, one copy), sources the lib, points
 * EXTRA_PINS at a fixture pins file, and calls check_extra_mods. A fake docker on PATH records any call (there must be none).
 */
function drive(env: Record<string, string>, pins = `chunky ${JAR_PIN} Chunky-fixture.jar 0.0.0\n`) {
  const base = mkdtempSync(join(tmpdir(), 'nf-extra-deploy-'));
  dirs.push(base);
  const bin = join(base, 'bin');
  mkdirSync(bin);
  const log = join(base, 'docker.log');
  writeFileSync(join(bin, 'docker'), `#!/bin/sh\necho "$*" >> "${slash(log)}"\nexit 0\n`, {
    mode: 0o755,
  });
  const pinsFile = join(base, 'pins');
  writeFileSync(pinsFile, pins);
  const driver = join(base, 'driver.sh');
  const deployText = readFileSync(DEPLOY, 'utf8');
  const checkHostFile = deployText.slice(
    deployText.indexOf('check_host_file() {'),
    deployText.indexOf('\n}\n', deployText.indexOf('check_host_file() {')) + 3,
  );
  writeFileSync(
    driver,
    [
      'ROOT=/unused',
      'die() { echo "nf-deploy: error: $*" >&2; exit 1; }',
      'say() { echo "nf-deploy: $*"; }',
      'need() { command -v "$1" >/dev/null 2>&1 || die "missing command: $1"; }',
      checkHostFile,
      `. "${slash(LIB)}"`,
      `EXTRA_PINS="${slash(pinsFile)}"`,
      'check_extra_mods',
      'echo "ENABLED=[$EXTRA_ENABLED]"',
      '',
    ].join('\n'),
  );
  const { PATH: _p, ...rest } = process.env;
  const r = spawnSync('sh', [slash(driver)], {
    encoding: 'utf8',
    env: { ...rest, PATH: `${bin}${delimiter}${process.env.PATH ?? ''}`, ...env },
  });
  const docker = (() => {
    try {
      return readFileSync(log, 'utf8');
    } catch {
      return '';
    }
  })();
  return { status: r.status, out: r.stdout, err: r.stderr, docker, base };
}

const goodJar = (base: string) => {
  const p = join(base, 'chunky.jar');
  return p;
};

describe.skipIf(skipWithoutSh())(
  'extra mods: the deploy helper (sh, no docker)',
  { timeout: 60_000 },
  () => {
    it('unset NF_EXTRA_MODS enables nothing and does not look at any jar', () => {
      const r = drive({});
      expect(r.status, r.err).toBe(0);
      expect(r.out).toContain('ENABLED=[]');
      expect(r.docker).toBe('');
    });

    it('a name that is not in the allowlist refuses, with no docker call', () => {
      const r = drive({ NF_EXTRA_MODS: 'unknownmod' });
      expect(r.status).toBe(1);
      expect(r.err).toContain('not in compose/neoforge/extra-mods.pins');
      expect(r.docker).toBe('');
    });

    it('a name given twice refuses', () => {
      const r = drive({ NF_EXTRA_MODS: 'chunky,chunky', NF_EXTRA_CHUNKY_JAR_HOST: '/x' });
      expect(r.status).toBe(1);
      expect(r.err).toContain('more than once');
    });

    it.each(['chunky,,bluemap', ',chunky', 'chunky,', 'chunky, ,bluemap'])(
      'an empty entry in %j refuses',
      (raw) => {
        const r = drive({ NF_EXTRA_MODS: raw });
        expect(r.status).toBe(1);
        expect(r.err).toContain('empty entry');
      },
    );

    it.each(['chunky;rm', 'chunky$(x)', 'chunky"', 'chunky`x`'])(
      'a shell metacharacter in %j refuses',
      (raw) => {
        const r = drive({ NF_EXTRA_MODS: raw });
        expect(r.status).toBe(1);
        expect(r.err).toContain('outside letters, digits');
      },
    );

    it('an enabled name with no host path refuses, and names the variable', () => {
      const r = drive({ NF_EXTRA_MODS: 'chunky' });
      expect(r.status).toBe(1);
      expect(r.err).toContain('NF_EXTRA_CHUNKY_JAR_HOST is not set');
    });

    it('a relative host path refuses', () => {
      const r = drive({ NF_EXTRA_MODS: 'chunky', NF_EXTRA_CHUNKY_JAR_HOST: 'chunky.jar' });
      expect(r.status).toBe(1);
      expect(r.err).toContain('must be an absolute path');
    });

    it('an empty jar refuses on its hash, not as accepted', () => {
      const base = mkdtempSync(join(tmpdir(), 'nf-extra-empty-'));
      dirs.push(base);
      writeFileSync(goodJar(base), '');
      const r = drive({ NF_EXTRA_MODS: 'chunky', NF_EXTRA_CHUNKY_JAR_HOST: slash(goodJar(base)) });
      expect(r.status).toBe(1);
      expect(r.err).toContain('does not match its pin');
      expect(r.docker).toBe('');
    });

    it('a jar whose hash does not match its pin refuses, with no docker call', () => {
      const base = mkdtempSync(join(tmpdir(), 'nf-extra-wrong-'));
      dirs.push(base);
      writeFileSync(goodJar(base), 'some other bytes');
      const r = drive({ NF_EXTRA_MODS: 'chunky', NF_EXTRA_CHUNKY_JAR_HOST: slash(goodJar(base)) });
      expect(r.status).toBe(1);
      expect(r.err).toContain('does not match its pin');
      expect(r.docker).toBe('');
    });

    it.skipIf(!CAN_LINK)('a symlink to the right jar refuses', () => {
      const base = mkdtempSync(join(tmpdir(), 'nf-extra-link-'));
      dirs.push(base);
      const real = join(base, 'real.jar');
      writeFileSync(real, JAR_BODY);
      symlinkSync(real, goodJar(base));
      const r = drive({ NF_EXTRA_MODS: 'chunky', NF_EXTRA_CHUNKY_JAR_HOST: slash(goodJar(base)) });
      expect(r.status).toBe(1);
      expect(r.err).toContain('is a symlink');
    });

    it('the right jar is accepted, with no docker call (the helper never calls docker)', () => {
      const base = mkdtempSync(join(tmpdir(), 'nf-extra-ok-'));
      dirs.push(base);
      writeFileSync(goodJar(base), JAR_BODY);
      const r = drive({ NF_EXTRA_MODS: 'chunky', NF_EXTRA_CHUNKY_JAR_HOST: slash(goodJar(base)) });
      expect(r.status, r.err).toBe(0);
      expect(r.out, r.err).toContain('ENABLED=[chunky]');
      expect(r.docker).toBe('');
    });

    it('the real pins file lists chunky and bluemap, so both names pass the allowlist', () => {
      const real = readFileSync(`${ROOT}compose/neoforge/extra-mods.pins`, 'utf8');
      const r = drive({ NF_EXTRA_MODS: 'chunky bluemap' }, real);
      expect(r.err).not.toContain('not in compose/neoforge/extra-mods.pins');
      expect(r.err).toContain('NF_EXTRA_CHUNKY_JAR_HOST is not set');
    });
  },
);
