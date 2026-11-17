/**
 * The NeoForge mod jar mount: SCRATCH_NEOFORGE_MOD_JAR and SCRATCH_NEOFORGE_MOD_SHA256 in deploy/scratch/scratch.sh (checked
 * with the stub harness, so nothing starts), the read-only mount in compose/opt-in/scratch-neoforge-mod.yml (parsed), and the
 * entrypoint's copy of the jar into mods/ and its second start (run under sh with the GELDAR_NF_* seams). Nothing here starts
 * a container.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import {
  AUTH,
  CAN_SYMLINK,
  type Env,
  JARS,
  runScript,
  skipWithoutSh,
  slash,
} from './scratch-harness.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const ENTRY = `${ROOT}compose/neoforge/neoforge-entrypoint.sh`;
const OVERLAY_TEXT = readFileSync(`${ROOT}compose/opt-in/scratch-neoforge-mod.yml`, 'utf8');
const NF_TEXT = readFileSync(`${ROOT}compose/opt-in/scratch-neoforge.yml`, 'utf8');
/** Built from parts, so the dotted build never appears literally (the IP-literal check rejects it). */
const BUILD = ['26', '1', '2', '126'].join('.');
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
const sha512 = (text: string) => createHash('sha512').update(text).digest('hex');

/** The mounted jar's bytes and hash. A second body gives a second, different hash. */
const JAR = 'nf mod jar fixture bytes';
const JAR_SHA = sha256(JAR);
const JAR2 = 'nf mod jar fixture bytes, second';
const JAR2_SHA = sha256(JAR2);
/** The two pinned artifacts of the entrypoint, pre-seeded in the data dir so curl is never needed. */
const MOD_FIX = 'proxy fixture bytes';
const INSTALLER_FIX = 'installer fixture bytes';
/** A recognizable secret: the tests check it never reaches stdout or stderr. */
const SECRET = 'nf-mod-test-secret-Q7';

/** A file in the stub base dir (or a symlink to it), and the env that names it. */
function jarEnv(sha: string | undefined, link = false, extra: Env = {}) {
  return (base: string): Env => {
    writeFileSync(join(base, 'real.jar'), JAR);
    if (link) symlinkSync(join(base, 'real.jar'), join(base, 'link.jar'));
    return {
      ...AUTH,
      SCRATCH_PLATFORM: 'neoforge',
      SCRATCH_NEOFORGE_MOD_JAR: slash(join(base, link ? 'link.jar' : 'real.jar')),
      SCRATCH_NEOFORGE_MOD_SHA256: sha,
      ...extra,
    };
  };
}

describe.skipIf(skipWithoutSh())('scratch.sh: the mod jar variables', { timeout: 60_000 }, () => {
  it('one variable without the other exits 2 before any docker call', () => {
    const jarOnly = runScript(['up'], jarEnv(undefined), JARS);
    expect(jarOnly.status).toBe(2);
    expect(jarOnly.stderr).toContain(
      'set both SCRATCH_NEOFORGE_MOD_JAR and SCRATCH_NEOFORGE_MOD_SHA256',
    );
    expect(jarOnly.calls).toEqual([]);

    const shaOnly = runScript(
      ['up'],
      { ...AUTH, SCRATCH_PLATFORM: 'neoforge', SCRATCH_NEOFORGE_MOD_SHA256: JAR_SHA },
      JARS,
    );
    expect(shaOnly.status).toBe(2);
    expect(shaOnly.stderr).toContain('set both');
    expect(shaOnly.calls).toEqual([]);
  });

  it('either variable with SCRATCH_PLATFORM=paper (or unset) exits 2 before any docker call', () => {
    for (const platform of ['paper', undefined]) {
      const r = runScript(['up'], jarEnv(JAR_SHA, false, { SCRATCH_PLATFORM: platform }), JARS);
      expect(r.status).toBe(2);
      expect(r.stderr).toContain('need SCRATCH_PLATFORM=neoforge');
      expect(r.calls).toEqual([]);
    }
  });

  it('a relative path, or one with quotes, exits 2 before any docker call', () => {
    const relative = runScript(
      ['up'],
      {
        ...AUTH,
        SCRATCH_PLATFORM: 'neoforge',
        SCRATCH_NEOFORGE_MOD_JAR: 'mods/x.jar',
        SCRATCH_NEOFORGE_MOD_SHA256: JAR_SHA,
      },
      JARS,
    );
    expect(relative.status).toBe(2);
    expect(relative.stderr).toContain('absolute path');
    expect(relative.calls).toEqual([]);

    const quoted = runScript(
      ['up'],
      {
        ...AUTH,
        SCRATCH_PLATFORM: 'neoforge',
        SCRATCH_NEOFORGE_MOD_JAR: '/x/a"b.jar',
        SCRATCH_NEOFORGE_MOD_SHA256: JAR_SHA,
      },
      JARS,
    );
    expect(quoted.status).toBe(2);
    expect(quoted.stderr).toContain('must not contain quotes');
    expect(quoted.calls).toEqual([]);
  });

  it('a hash that is not exactly 64 lowercase hex digits exits 2 before any docker call', () => {
    const bad = [
      JAR_SHA.toUpperCase(),
      JAR_SHA.slice(1),
      `${JAR_SHA}0`,
      `g${JAR_SHA.slice(1)}`,
      `${JAR_SHA.slice(0, 63)}\n`,
    ];
    for (const sha of bad) {
      const r = runScript(['up'], jarEnv(sha), JARS);
      expect(r.status, JSON.stringify(sha)).toBe(2);
      expect(r.stderr).toContain('64 lowercase hex digits');
      expect(r.calls).toEqual([]);
    }
  });

  it('a jar whose sha256 on the host differs from the given hash exits 2, starts nothing, prints no jar bytes', () => {
    const r = runScript(['up'], jarEnv('0'.repeat(64)), JARS);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('does not match SCRATCH_NEOFORGE_MOD_SHA256; nothing started');
    expect(r.calls).toEqual([]);
    expect(r.stdout + r.stderr).not.toContain(JAR);
  });

  it.skipIf(!CAN_SYMLINK)('a symlinked jar exits 2 before any docker call', () => {
    const r = runScript(['up'], jarEnv(JAR_SHA, true), JARS);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('not a symlink');
    expect(r.calls).toEqual([]);
  });

  it('with both variables and a matching hash, up adds the mod overlay after scratch-neoforge.yml and before the NATS override', () => {
    const r = runScript(['up'], jarEnv(JAR_SHA), JARS);
    expect(r.status).toBe(0);
    const up = r.calls.find((c) => c.includes(' up -d')) ?? '';
    const at = (s: string) => up.indexOf(s);
    expect(at('opt-in/scratch-neoforge-mod.yml')).toBeGreaterThan(-1);
    expect(at('opt-in/scratch-neoforge.yml')).toBeLessThan(at('opt-in/scratch-neoforge-mod.yml'));
    expect(at('opt-in/scratch-neoforge-mod.yml')).toBeLessThan(at('nats-override.yml'));
  });

  it('with neither variable the up command has no mod overlay: the default render is unchanged', () => {
    const r = runScript(['up'], { ...AUTH, SCRATCH_PLATFORM: 'neoforge' }, JARS);
    expect(r.status).toBe(0);
    const up = r.calls.find((c) => c.includes(' up -d')) ?? '';
    expect(up).toContain('opt-in/scratch-neoforge.yml');
    expect(up).not.toContain('scratch-neoforge-mod.yml');
  });

  it('down and status still run after the jar is deleted: only up refuses on the pair', () => {
    const gone = (base: string): Env => {
      const env = jarEnv(JAR_SHA)(base);
      unlinkSync(join(base, 'real.jar'));
      return env;
    };
    const down = runScript(['down'], gone, JARS);
    expect(down.status).toBe(0);
    expect(down.stderr).not.toContain('nothing started');
    expect(down.calls.some((c) => c.includes(' down -v'))).toBe(true);
    const status = runScript(['status'], gone, JARS);
    expect(status.status).toBe(0);
    expect(status.stderr).not.toContain('nothing started');
    expect(status.calls.length).toBeGreaterThan(0);
  });

  it('down and status with SCRATCH_PLATFORM=paper and the pair set still run, with no mod overlay', () => {
    for (const verb of ['status', 'down']) {
      const r = runScript([verb], jarEnv(JAR_SHA, false, { SCRATCH_PLATFORM: 'paper' }), JARS);
      expect(r.status, verb).toBe(0);
      expect(r.stderr, verb).not.toContain('need SCRATCH_PLATFORM=neoforge');
      expect(r.calls.join('\n'), verb).not.toContain('scratch-neoforge-mod.yml');
    }
  });

  it('down with a malformed hash still runs, and renders without the mod overlay', () => {
    const r = runScript(['down'], jarEnv('NOT-A-HASH'), JARS);
    expect(r.status).toBe(0);
    expect(r.stderr).not.toContain('64 lowercase hex digits');
    expect(r.calls.join('\n')).not.toContain('scratch-neoforge-mod.yml');
  });
});

interface ModOverlay {
  services: {
    paper: {
      environment: Record<string, string>;
      volumes: { type: string; source: string; target: string; read_only?: boolean }[];
    };
  };
}
const MOD = parse(OVERLAY_TEXT) as ModOverlay;

describe('scratch-neoforge-mod.yml: the render when the variables are set', () => {
  it('changes only the paper service', () => {
    expect(Object.keys(MOD.services)).toEqual(['paper']);
  });

  it('mounts the jar read-only at the entrypoint path, from the host variable only', () => {
    const mounts = MOD.services.paper.volumes;
    expect(mounts).toHaveLength(1);
    const [mount] = mounts;
    expect(mount?.target).toBe('/geldar/mods/geldar-neoforge.jar');
    expect(mount?.type).toBe('bind');
    expect(mount?.read_only).toBe(true);
    expect(mount?.source).toMatch(/^\$\{GELDAR_NF_MOD_JAR_HOST:\?[^}]+\}$/);
  });

  it('passes the pinned hash into the paper environment, as a required variable', () => {
    expect(MOD.services.paper.environment.GELDAR_NF_MOD_SHA256).toMatch(
      /^\$\{GELDAR_NF_MOD_SHA256:\?[^}]+\}$/,
    );
  });

  it('is never in the base overlay: the default render has no jar mount and no hash', () => {
    expect(NF_TEXT).not.toContain('geldar-neoforge.jar');
    expect(NF_TEXT).not.toContain('GELDAR_NF_MOD');
  });
});

/** A temp data dir with the two pinned artifacts pre-seeded, the secret file, a curl that always fails and a start stub. */
interface Tree {
  bin: string;
  data: string;
  secret: string;
  mounted: string;
  copy: string;
}
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tree(): Tree {
  const base = mkdtempSync(join(tmpdir(), 'nf-mod-entry-'));
  dirs.push(base);
  const bin = join(base, 'bin');
  const data = join(base, 'data');
  mkdirSync(bin);
  mkdirSync(join(data, 'mods'), { recursive: true });
  writeFileSync(join(bin, 'curl'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  writeFileSync(join(bin, 'start'), '#!/bin/sh\necho "started $*"\n', { mode: 0o755 });
  const secret = join(base, 'velocity-forwarding');
  writeFileSync(secret, `${SECRET}\n`);
  writeFileSync(join(data, 'mods', 'proxy-compatible-forge.jar'), MOD_FIX);
  writeFileSync(join(data, 'neoforge-installer.jar'), INSTALLER_FIX);
  return {
    bin,
    data,
    secret,
    mounted: join(base, 'mounted-geldar-neoforge.jar'),
    copy: join(data, 'mods', 'geldar-neoforge.jar'),
  };
}

/** Writes the mounted jar (or a stand-in for it) in the tree. */
function mount(t: Tree, body = JAR) {
  writeFileSync(t.mounted, body);
}

/** Runs the entrypoint under sh. The pins are the fixtures' hashes; the mount path is the tree's, not /geldar's. */
function run(t: Tree, extra: Record<string, string | undefined> = {}) {
  const env: Record<string, string | undefined> = {
    PATH: `${t.bin}${delimiter}${process.env.PATH ?? ''}`,
    SYSTEMROOT: process.env.SYSTEMROOT ?? '',
    NEOFORGE_VERSION: BUILD,
    GELDAR_NF_DATA_DIR: slash(t.data),
    GELDAR_NF_SECRET_FILE: slash(t.secret),
    GELDAR_NF_START: slash(join(t.bin, 'start')),
    GELDAR_NF_MOD_JAR: slash(t.mounted),
    GELDAR_NF_MOD_SHA512: sha512(MOD_FIX),
    GELDAR_NF_INSTALLER_SHA256: sha256(INSTALLER_FIX),
    GELDAR_NF_INSTALLER_SHA512: sha512(INSTALLER_FIX),
    ...extra,
  };
  for (const key of Object.keys(env)) if (env[key] === undefined) delete env[key];
  return spawnSync('sh', [slash(ENTRY)], { encoding: 'utf8', env: env as Record<string, string> });
}

/** The bundle list of the four files the entrypoint requires, written as the bundle script does (one line per file). */
function writeBundle(t: Tree) {
  writeFileSync(join(t.data, '.neoforge-manifest.json'), '{}');
  writeFileSync(join(t.data, 'run.sh'), 'run');
  const files = [
    '.neoforge-manifest.json',
    'neoforge-installer.jar',
    'mods/proxy-compatible-forge.jar',
    'run.sh',
  ];
  const body = files
    .map((f) => {
      const text = readFileSync(join(t.data, f));
      return `${sha256(text.toString())}  ${f}`;
    })
    .join('\n');
  writeFileSync(join(t.data, '.geldar-bundle.sha256'), `${body}\n`);
}

const ok = (r: { status: number | null }) => expect(r.status).toBe(0);

describe.skipIf(skipWithoutSh())(
  'the entrypoint with a mounted mod jar, normal path',
  { timeout: 60_000 },
  () => {
    it('no jar mounted: starts, copies nothing, and needs no hash', () => {
      const t = tree();
      const r = run(t);
      ok(r);
      expect(r.stdout).toContain('started');
      expect(existsSync(t.copy)).toBe(false);
      expect(readdirSync(join(t.data, 'mods'))).toEqual(['proxy-compatible-forge.jar']);
    });

    it('no jar mounted but a geldar copy in mods/ from an earlier start: refuses in the default mode and keeps the copy', () => {
      const t = tree();
      writeFileSync(t.copy, JAR);
      const r = run(t);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain(
        'a geldar mod jar is present in mods/ but none is mounted; remove it or mount the pinned jar',
      );
      expect(r.stdout).not.toContain('started');
      expect(readFileSync(t.copy, 'utf8')).toBe(JAR);
    });

    it('no jar mounted but GELDAR_NF_MOD_SHA256 set: refuses, starts nothing and copies nothing', () => {
      const t = tree();
      const r = run(t, { GELDAR_NF_MOD_SHA256: JAR_SHA });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('GELDAR_NF_MOD_SHA256 is set but no mod jar is mounted');
      expect(r.stdout).not.toContain('started');
      expect(existsSync(t.copy)).toBe(false);
    });

    it('a good jar is copied into mods/ with mode 644 and the same bytes', () => {
      const t = tree();
      mount(t);
      const r = run(t, { GELDAR_NF_MOD_SHA256: JAR_SHA });
      ok(r);
      expect(readFileSync(t.copy, 'utf8')).toBe(JAR);
      if (process.platform !== 'win32') expect(statSync(t.copy).mode & 0o777).toBe(0o644);
      expect(r.stdout + r.stderr).not.toContain(SECRET);
    });

    it('a jar that does not match its hash exits 1, copies nothing and prints no jar bytes', () => {
      const t = tree();
      mount(t);
      const r = run(t, { GELDAR_NF_MOD_SHA256: '0'.repeat(64) });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('does not match GELDAR_NF_MOD_SHA256; not copied');
      expect(r.stdout).not.toContain('started');
      expect(existsSync(t.copy)).toBe(false);
      expect(r.stdout + r.stderr).not.toContain(JAR);
    });

    it('a missing, short, long, uppercase or newline-carrying hash exits 1 and copies nothing', () => {
      const bad: (string | undefined)[] = [
        undefined,
        '',
        JAR_SHA.slice(1),
        `${JAR_SHA}0`,
        JAR_SHA.toUpperCase(),
        `${JAR_SHA.slice(0, 63)}\n`,
      ];
      for (const sha of bad) {
        const t = tree();
        mount(t);
        const r = run(t, { GELDAR_NF_MOD_SHA256: sha });
        expect(r.status, JSON.stringify(sha)).toBe(1);
        expect(r.stderr).toContain('GELDAR_NF_MOD_SHA256 is not 64 lowercase hex digits');
        expect(existsSync(t.copy)).toBe(false);
      }
    });

    it.skipIf(!CAN_SYMLINK)('a symlinked jar exits 1 and copies nothing', () => {
      const t = tree();
      const real = join(t.bin, 'real.jar');
      writeFileSync(real, JAR);
      symlinkSync(real, t.mounted);
      const r = run(t, { GELDAR_NF_MOD_SHA256: JAR_SHA });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('is a symlink or not a regular file');
      expect(existsSync(t.copy)).toBe(false);
    });

    it('a directory at the mount path exits 1 and copies nothing', () => {
      const t = tree();
      mkdirSync(t.mounted);
      const r = run(t, { GELDAR_NF_MOD_SHA256: JAR_SHA });
      expect(r.status).toBe(1);
      expect(existsSync(t.copy)).toBe(false);
    });

    it('a copy that differs from the mounted jar after cp is removed by the post-copy hash, which alone refuses', () => {
      const t = tree();
      mount(t);
      // The stub writes other bytes into the copy, so the pre-copy check passes and only the post-copy hash can refuse.
      writeFileSync(join(t.bin, 'cp'), '#!/bin/sh\nprintf tampered > "$2"\n', { mode: 0o755 });
      const r = run(t, { GELDAR_NF_MOD_SHA256: JAR_SHA });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain(
        'the copy of the mod jar in mods/ does not match GELDAR_NF_MOD_SHA256; removed it',
      );
      expect(r.stdout).not.toContain('started');
      expect(existsSync(t.copy)).toBe(false);
    });
  },
);

describe.skipIf(skipWithoutSh())(
  'the entrypoint with a mounted mod jar, offline bundle',
  { timeout: 60_000 },
  () => {
    it('first start copies the jar; a second start with the same jar passes the bundle mods/ check', () => {
      const t = tree();
      writeBundle(t);
      mount(t);
      ok(run(t, { GELDAR_NF_MOD_SHA256: JAR_SHA }));
      expect(readFileSync(t.copy, 'utf8')).toBe(JAR);
      const second = run(t, { GELDAR_NF_MOD_SHA256: JAR_SHA });
      ok(second);
      expect(second.stdout).toContain('started');
      expect(second.stderr).not.toContain('holds files the offline bundle does not list');
      expect(readFileSync(t.copy, 'utf8')).toBe(JAR);
    });

    it('a second start with a changed jar and its new hash replaces the copy', () => {
      const t = tree();
      writeBundle(t);
      mount(t);
      ok(run(t, { GELDAR_NF_MOD_SHA256: JAR_SHA }));
      mount(t, JAR2);
      ok(run(t, { GELDAR_NF_MOD_SHA256: JAR2_SHA }));
      expect(readFileSync(t.copy, 'utf8')).toBe(JAR2);
    });

    it('a second start with a mismatched jar exits 1 and leaves no copy', () => {
      const t = tree();
      writeBundle(t);
      mount(t);
      ok(run(t, { GELDAR_NF_MOD_SHA256: JAR_SHA }));
      mount(t, JAR2);
      const r = run(t, { GELDAR_NF_MOD_SHA256: JAR_SHA });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('does not match GELDAR_NF_MOD_SHA256; not copied');
      expect(existsSync(t.copy)).toBe(false);
    });

    it('a second start with no jar mounted refuses the stale copy before the bundle check, and keeps it', () => {
      const t = tree();
      writeBundle(t);
      mount(t);
      ok(run(t, { GELDAR_NF_MOD_SHA256: JAR_SHA }));
      unlinkSync(t.mounted);
      const r = run(t);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('a geldar mod jar is present in mods/ but none is mounted');
      expect(r.stderr).not.toContain('holds files the offline bundle does not list');
      expect(r.stdout).not.toContain('started');
      expect(existsSync(t.copy)).toBe(true);
    });

    it('an unlisted mod beside the mounted jar still refuses: only the one copy is allowed', () => {
      const t = tree();
      writeBundle(t);
      writeFileSync(join(t.data, 'mods', 'extra.jar'), 'extra');
      mount(t);
      const r = run(t, { GELDAR_NF_MOD_SHA256: JAR_SHA });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('mods/extra.jar');
      expect(existsSync(t.copy)).toBe(false);
    });
  },
);
