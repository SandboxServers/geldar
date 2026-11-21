// Tests for deploy/genesis/prune-deploy-work.sh. The script runs under `sh` against a fixture root (GELDAR_DEPLOY_ROOT)
// with a flock stand-in on PATH (flock is absent on Windows): FAKE_FLOCK_RC=1 makes the lock busy. Nothing real is touched.
import { spawn, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  lutimesSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { REAL_BIN, SH } from './colo-deploy-fixture';

const SCRIPT = fileURLToPath(new URL('../genesis/prune-deploy-work.sh', import.meta.url));
const p = (s: string) => s.replaceAll(String.fromCharCode(92), '/');
const sha = (n: number) => n.toString(16).padStart(40, '0');
const dirs: string[] = [];

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const HEAD = '# Release manifest for the Colo node (decision 0084). Commit ';
const manifest = (commit: string) =>
  `${HEAD}${commit}.
GELDAR_BODY_IMAGE=registry.example.invalid/body@sha256:${'1'.repeat(64)}`;

/** A root with `count` checkouts, sha(1) the oldest and sha(count) the newest, and a live commit. */
function fixture(count: number, live: string | null = sha(count), staged: string | null = null) {
  const root = mkdtempSync(join(tmpdir(), 'prune-work-'));
  dirs.push(root);
  mkdirSync(join(root, 'work'));
  mkdirSync(join(root, 'staged'));
  const shim = join(root, 'shim');
  mkdirSync(shim);
  writeFileSync(join(shim, 'flock'), '#!/bin/sh\nexit ${FAKE_FLOCK_RC:-0}\n', { mode: 0o755 });
  for (let i = 1; i <= count; i++) {
    const d = join(root, 'work', sha(i));
    mkdirSync(d);
    writeFileSync(join(d, 'f'), 'x');
    utimesSync(d, 1_700_000_000 + i * 1000, 1_700_000_000 + i * 1000);
  }
  mkdirSync(join(root, 'state'));
  if (live !== null) writeFileSync(join(root, 'state', 'release.commit'), `${live}\n`);
  if (staged !== null)
    writeFileSync(join(root, 'staged', 'release.env'), `${staged}\nSECRET=do-not-print\n`);
  return root;
}

function run(root: string, args: string[] = [], env: Record<string, string> = {}) {
  const r = spawnSync(SH, [p(SCRIPT), ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      GELDAR_DEPLOY_ROOT: p(root),
      GELDAR_STATE_DIR: p(join(root, 'state')),
      PATH: [p(join(root, 'shim')), REAL_BIN, process.env.PATH ?? ''].join(delimiter),
      ...env,
    },
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

const has = (root: string, name: string) => existsSync(join(root, 'work', name));

describe('prune-deploy-work.sh', () => {
  it('dry run lists what would go and deletes nothing', () => {
    const root = fixture(8);
    const r = run(root, ['--keep', '3']);
    expect(r.code).toBe(0);
    for (let i = 1; i <= 5; i++) {
      expect(r.out).toContain(`would remove ${sha(i)}`);
      expect(has(root, sha(i))).toBe(true);
    }
    expect(r.out).not.toContain(sha(6));
  });

  it('the default is a dry run even with no arguments', () => {
    const root = fixture(8);
    expect(run(root).out).toContain('would remove');
    expect(has(root, sha(1))).toBe(true);
  });

  it('--apply removes all but the newest N', () => {
    const root = fixture(8);
    const r = run(root, ['--keep', '3', '--apply']);
    expect(r.code).toBe(0);
    for (let i = 1; i <= 5; i++) expect(has(root, sha(i))).toBe(false);
    for (let i = 6; i <= 8; i++) expect(has(root, sha(i))).toBe(true);
  });

  it('keeps the newest 5 by default', () => {
    const root = fixture(8);
    run(root, ['--apply']);
    expect(has(root, sha(3))).toBe(false);
    expect(has(root, sha(4))).toBe(true);
  });

  it('keeps the live commit even when it is old', () => {
    const root = fixture(8, sha(1));
    run(root, ['--keep', '2', '--apply']);
    expect(has(root, sha(1))).toBe(true);
    expect(has(root, sha(2))).toBe(false);
    expect(has(root, sha(8))).toBe(true);
    expect(has(root, sha(7))).toBe(true);
  });

  it('keeps names that are not exactly 40 lowercase hex', () => {
    const root = fixture(6);
    const odd = ['notasha', 'a'.repeat(39), 'a'.repeat(41), 'A'.repeat(40), `${'a'.repeat(39)}g`];
    for (const n of odd) {
      mkdirSync(join(root, 'work', n));
      utimesSync(join(root, 'work', n), 1_600_000_000, 1_600_000_000);
    }
    run(root, ['--keep', '2', '--apply']);
    for (const n of odd) expect(has(root, n)).toBe(true);
    expect(has(root, sha(1))).toBe(false);
  });

  it('keeps a file and a symlink named like a commit', () => {
    const root = fixture(4);
    const target = mkdtempSync(join(tmpdir(), 'prune-target-'));
    dirs.push(target);
    writeFileSync(join(target, 'precious'), 'keep');
    const link = join(root, 'work', 'b'.repeat(40));
    try {
      symlinkSync(target, link, 'dir');
    } catch {
      return; // no symlink right on this machine; the Linux CI run covers it
    }
    // Both are the oldest entries, so a missing guard would put them in the removed set.
    lutimesSync(link, 1_500_000_000, 1_500_000_000);
    writeFileSync(join(root, 'work', 'c'.repeat(40)), 'a file');
    utimesSync(join(root, 'work', 'c'.repeat(40)), 1_500_000_000, 1_500_000_000);
    run(root, ['--keep', '2', '--apply']);
    expect(has(root, 'b'.repeat(40))).toBe(true);
    expect(has(root, 'c'.repeat(40))).toBe(true);
    expect(existsSync(join(target, 'precious'))).toBe(true);
  });

  it.each([
    ['missing', null],
    ['empty', ''],
    ['a short commit', 'abc123'],
    ['an uppercase commit', sha(8).toUpperCase().replace(/0/g, 'A')],
    ['two words', `${sha(8)} ${sha(7)}`],
  ])('an unreadable live commit (%s) removes nothing and exits 1', (_label, live) => {
    const root = fixture(8, live);
    const r = run(root, ['--keep', '2', '--apply']);
    expect(r.code).toBe(1);
    expect(r.out).not.toContain('removed');
    for (let i = 1; i <= 8; i++) expect(has(root, sha(i))).toBe(true);
  });

  it('tolerates a CRLF release.commit', () => {
    const root = fixture(8, `${sha(1)}${String.fromCharCode(13)}`);
    run(root, ['--keep', '2', '--apply']);
    expect(has(root, sha(1))).toBe(true);
    expect(has(root, sha(2))).toBe(false);
  });

  it('also keeps the commit named by an existing staged manifest', () => {
    const root = fixture(8, sha(8), manifest(sha(1)));
    run(root, ['--keep', '2', '--apply']);
    expect(has(root, sha(1))).toBe(true);
    expect(has(root, sha(2))).toBe(false);
  });

  it('a malformed staged manifest refuses the run (it may name a commit that must be kept)', () => {
    const root = fixture(8, sha(8), 'garbage');
    expect(run(root, ['--keep', '2', '--apply']).code).toBe(1);
    expect(has(root, sha(1))).toBe(true);
  });

  it('a held colo-cd lock directory removes nothing and exits 1', () => {
    const root = fixture(8);
    mkdirSync(join(root, 'state', 'cd.lock'));
    const r = run(root, ['--keep', '2', '--apply']);
    expect(r.code).toBe(1);
    expect(has(root, sha(1))).toBe(true);
    expect(existsSync(join(root, 'state', 'cd.lock'))).toBe(true);
  });

  it('takes the colo-cd lock during the run and releases it after, even when it refuses', () => {
    const root = fixture(8);
    expect(run(root, ['--apply']).code).toBe(0);
    expect(existsSync(join(root, 'state', 'cd.lock'))).toBe(false);
    const bad = fixture(8, null);
    run(bad, ['--apply']);
    expect(existsSync(join(bad, 'state', 'cd.lock'))).toBe(false);
  });

  it('a missing state directory refuses', () => {
    const root = fixture(8);
    rmSync(join(root, 'state'), { recursive: true });
    expect(run(root, ['--apply']).code).toBe(1);
    expect(has(root, sha(1))).toBe(true);
  });

  it('never prints the rest of release.env', () => {
    const root = fixture(8);
    const r = run(root, ['--apply']);
    expect(r.out + r.err).not.toContain('do-not-print');
  });

  it('a busy deploy lock removes nothing and exits 1', () => {
    const root = fixture(8);
    const r = run(root, ['--keep', '2', '--apply'], { FAKE_FLOCK_RC: '1' });
    expect(r.code).toBe(1);
    expect(has(root, sha(1))).toBe(true);
  });

  it('bad arguments exit 1 and remove nothing', () => {
    const root = fixture(8);
    for (const args of [['--keep'], ['--keep', 'x'], ['--keep', '-1'], ['--force']]) {
      expect(run(root, [...args, '--apply']).code).toBe(1);
    }
    expect(has(root, sha(1))).toBe(true);
  });

  it.each(['0', '1', '1001', '99999999999999999999', '00005000'])(
    '--keep %s refuses and removes nothing',
    (n) => {
      const root = fixture(8);
      expect(run(root, ['--keep', n, '--apply']).code).toBe(1);
      for (let i = 1; i <= 8; i++) expect(has(root, sha(i))).toBe(true);
    },
  );

  // A fatal signal needs a POSIX kill; on Windows child.kill is a hard terminate, so the Linux CI run covers this.
  it.skipIf(process.platform === 'win32')(
    'a TERM during --apply releases the colo-cd lock and removes nothing',
    () => {
      const root = fixture(8);
      // An ls stand-in that marks that the lock is held, waits, then lists.
      writeFileSync(
        join(root, 'shim', 'ls'),
        `#!/bin/sh
: > "${p(root)}/ls.started"
sleep 3
exec "${REAL_BIN}/ls" "$@"
`,
        { mode: 0o755 },
      );
      const child = spawn(SH, [p(SCRIPT), '--keep', '2', '--apply'], {
        env: {
          ...process.env,
          GELDAR_DEPLOY_ROOT: p(root),
          GELDAR_STATE_DIR: p(join(root, 'state')),
          PATH: [p(join(root, 'shim')), REAL_BIN, process.env.PATH ?? ''].join(delimiter),
        },
      });
      return new Promise<void>((resolve, reject) => {
        const t0 = Date.now();
        const poll = setInterval(() => {
          if (existsSync(join(root, 'ls.started'))) {
            clearInterval(poll);
            child.kill('SIGTERM');
          } else if (Date.now() - t0 > 20_000) {
            clearInterval(poll);
            child.kill('SIGKILL');
            reject(new Error('the script never reached the listing'));
          }
        }, 50);
        child.on('exit', () => {
          clearInterval(poll);
          try {
            expect(existsSync(join(root, 'state', 'cd.lock'))).toBe(false);
            expect(has(root, sha(1))).toBe(true);
            resolve();
          } catch (e) {
            reject(e);
          }
        });
      });
    },
  );

  describe('the live commit records (node fact: release.commit may not exist; the manifests name the commit)', () => {
    const put = (root: string, rel: string, text: string) => {
      mkdirSync(dirname(join(root, rel)), { recursive: true });
      writeFileSync(join(root, rel), text);
    };

    it('works with no release.commit when current.env names the live commit, and keeps it', () => {
      const root = fixture(8, null);
      put(root, 'state/current.env', `${manifest(sha(1))}\n`);
      expect(run(root, ['--keep', '2', '--apply']).code).toBe(0);
      expect(has(root, sha(1))).toBe(true);
      expect(has(root, sha(2))).toBe(false);
    });

    it('works with only the installed release.env of the state directory', () => {
      const root = fixture(8, null);
      put(root, 'state/release.env', `${manifest(sha(1))}\n`);
      expect(run(root, ['--keep', '2', '--apply']).code).toBe(0);
      expect(has(root, sha(1))).toBe(true);
    });

    it('keeps every commit any record names: release.commit, current, previous, staged and inbox', () => {
      const root = fixture(10, sha(1));
      put(root, 'state/current.env', `${manifest(sha(2))}\n`);
      put(root, 'state/previous.env', `${manifest(sha(3))}\n`);
      put(root, 'staged/release.env', `${manifest(sha(4))}\n`);
      put(root, 'inbox/release.env', `${manifest(sha(5))}\n`);
      run(root, ['--keep', '2', '--apply']);
      for (const i of [1, 2, 3, 4, 5, 9, 10]) expect(has(root, sha(i)), `sha ${i}`).toBe(true);
      for (const i of [6, 7, 8]) expect(has(root, sha(i)), `sha ${i}`).toBe(false);
    });

    it('refuses when only previous, staged or inbox name a commit: none of them says what is live', () => {
      const root = fixture(8, null);
      put(root, 'state/previous.env', `${manifest(sha(3))}\n`);
      put(root, 'staged/release.env', `${manifest(sha(4))}\n`);
      put(root, 'inbox/release.env', `${manifest(sha(5))}\n`);
      const r = run(root, ['--keep', '2', '--apply']);
      expect(r.code).toBe(1);
      for (let i = 1; i <= 8; i++) expect(has(root, sha(i))).toBe(true);
    });

    it("a refusal for want of a record names GELDAR_STATE_DIR and the node's state directory", () => {
      const root = fixture(8, null);
      const r = run(root, ['--keep', '2', '--apply']);
      expect(r.code).toBe(1);
      expect(r.err).toContain('GELDAR_STATE_DIR');
      expect(r.err).toContain('/mnt/nvme/geldar-colo/state');
    });

    it('refuses when every record is malformed (short, upper-case, no commit line)', () => {
      const root = fixture(8, 'abc');
      put(root, 'state/current.env', `${manifest('abc123')}\n`);
      put(root, 'state/release.env', 'GELDAR_BODY_IMAGE=x\n');
      expect(run(root, ['--keep', '2', '--apply']).code).toBe(1);
      expect(has(root, sha(1))).toBe(true);
    });
  });

  // Fail closed on a partial view: a record that EXISTS but cannot be used must refuse the run, never be skipped (a skipped
  // record could be the only one naming the live checkout).
  describe('a record that exists but is unusable refuses and removes nothing', () => {
    const canChmod = process.platform !== 'win32' && process.getuid?.() !== 0;
    const A = 'a'.repeat(40);
    const damages: [string, (p: string, root: string) => void][] = [
      ['truncated', (p) => writeFileSync(p, `${A.slice(0, 20)}\n`)],
      ['quoted', (p) => writeFileSync(p, `"${A}"\n`)],
      ['upper-case', (p) => writeFileSync(p, `${A.toUpperCase()}\n`)],
      ['empty', (p) => writeFileSync(p, '')],
      ['a directory', (p) => mkdirSync(p)],
      ['a dangling symlink', (p, root) => symlinkSync(join(root, 'nowhere'), p)],
    ];
    // The live commit is named by a valid release.env; release.commit is the damaged record.
    const setup = (damage: (p: string, root: string) => void, rel = 'state/release.commit') => {
      const root = fixture(8, null);
      writeFileSync(join(root, 'state', 'release.env'), `${manifest(sha(8))}\n`);
      damage(join(root, rel), root);
      return root;
    };
    const refused = (root: string, name: string) => {
      const r = run(root, ['--keep', '2', '--apply']);
      expect(r.code).toBe(1);
      expect(r.err).toContain(name);
      for (let i = 1; i <= 8; i++) expect(has(root, sha(i)), `sha ${i}`).toBe(true);
    };

    it.each(damages)('release.commit that is %s', (_what, damage) => {
      try {
        refused(setup(damage), 'release.commit');
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'EPERM') return; // no symlink right on this machine; Linux CI covers it
        throw e;
      }
    });

    it.skipIf(!canChmod)('release.commit with mode 000 (cannot be read)', () => {
      const root = setup((p) => {
        writeFileSync(p, `${sha(1)}\n`);
        chmodSync(p, 0);
      });
      refused(root, 'release.commit');
    });

    it.each(['state/previous.env', 'staged/release.env', 'inbox/release.env', 'state/current.env'])(
      'a manifest at %s whose first line names no commit',
      (rel) => {
        const root = setup((p) => {
          mkdirSync(dirname(p), { recursive: true });
          writeFileSync(p, 'GELDAR_BODY_IMAGE=x\n');
        }, rel);
        refused(root, rel);
      },
    );

    it.skipIf(!canChmod)('an unreadable previous.env (mode 000)', () => {
      const root = setup((p) => {
        writeFileSync(p, `${manifest(sha(2))}\n`);
        chmodSync(p, 0);
      }, 'state/previous.env');
      refused(root, 'previous.env');
    });

    it('a record that does not exist at all is skipped, as before', () => {
      const root = fixture(8, null);
      writeFileSync(join(root, 'state', 'release.env'), `${manifest(sha(8))}\n`);
      expect(run(root, ['--keep', '2', '--apply']).code).toBe(0);
      expect(has(root, sha(1))).toBe(false);
    });

    it("a missing state directory names GELDAR_STATE_DIR and the node's path", () => {
      const root = fixture(8, sha(8));
      rmSync(join(root, 'state'), { recursive: true });
      const r = run(root, ['--apply']);
      expect(r.code).toBe(1);
      expect(r.err).toContain('GELDAR_STATE_DIR');
      expect(r.err).toContain('/mnt/nvme/geldar-colo/state');
    });
  });

  // The live commit is in a VALID release.commit here, so only the damaged record can trigger the refusal; the other manifests
  // are absent. Each record is damaged in each mode, and the run must refuse naming that record and remove nothing.
  describe('every record, damaged beside a valid release.commit, refuses the run', () => {
    const canChmod = process.platform !== 'win32' && process.getuid?.() !== 0;
    const RECORDS = [
      'state/release.env',
      'state/current.env',
      'state/previous.env',
      'staged/release.env',
      'inbox/release.env',
    ];
    const damages: [string, (p: string, root: string) => void][] = [
      ['a directory', (p) => mkdirSync(p)],
      ['a dangling symlink', (p, root) => symlinkSync(join(root, 'nowhere'), p)],
    ];
    const setup = (rel: string, damage: (p: string, root: string) => void) => {
      const root = fixture(8); // a valid release.commit naming sha(8)
      mkdirSync(dirname(join(root, rel)), { recursive: true });
      damage(join(root, rel), root);
      return root;
    };
    const refused = (root: string, rel: string) => {
      for (const args of [
        ['--keep', '2'],
        ['--keep', '2', '--apply'],
      ]) {
        const r = run(root, args);
        expect(r.code, args.join(' ')).toBe(1);
        expect(r.err).toContain(rel);
      }
      for (let i = 1; i <= 8; i++) expect(has(root, sha(i)), `sha ${i}`).toBe(true);
    };

    it('control: a valid release.commit alone proceeds', () => {
      const root = fixture(8);
      expect(run(root, ['--keep', '2', '--apply']).code).toBe(0);
      expect(has(root, sha(1))).toBe(false);
    });

    it.each(RECORDS.flatMap((rel) => damages.map(([what, d]) => [rel, what, d] as const)))(
      '%s that is %s',
      (rel, _what, damage) => {
        let root: string;
        try {
          root = setup(rel, damage);
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code === 'EPERM') return; // no symlink right here; Linux CI covers it
          throw e;
        }
        refused(root, rel);
      },
    );

    it.skipIf(!canChmod).each(RECORDS)('%s with mode 000 (cannot be read)', (rel) => {
      const root = setup(rel, (p) => {
        writeFileSync(p, `${manifest(sha(1))}\n`);
        chmodSync(p, 0);
      });
      refused(root, rel);
    });

    it.skipIf(!canChmod).each(['state/previous.env', 'staged/release.env', 'inbox/release.env'])(
      'a record in a directory that cannot be searched (%s)',
      (rel) => {
        const root = fixture(8);
        const p = join(root, rel);
        mkdirSync(dirname(p), { recursive: true });
        // The only record that names sha(1) is hidden behind a directory with no search permission.
        writeFileSync(p, `${manifest(sha(1))}\n`);
        chmodSync(dirname(p), 0o600);
        try {
          const r = run(root, ['--keep', '2', '--apply']);
          expect(r.code).toBe(1);
          // The new check's own message (the generic "no record" refusal also names the state directory).
          expect(r.err).toContain('cannot be searched');
          expect(r.err).toContain(dirname(p));
          expect(r.err).toContain('sudo');
          expect(has(root, sha(1))).toBe(true);
        } finally {
          chmodSync(dirname(p), 0o700);
        }
      },
    );
  });
});
