// Tests for deploy/genesis/prune-deploy-images.sh against a docker stand-in that lists images from a file and records `image rm` calls.
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { REAL_BIN, SH } from './colo-deploy-fixture';

const SCRIPT = fileURLToPath(new URL('../genesis/prune-deploy-images.sh', import.meta.url));
const p = (s: string) => s.replaceAll(String.fromCharCode(92), '/');
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const d = (c: string) => `sha256:${c.repeat(64)}`;
const body = (c: string) => `registry.example.invalid/geldar/body@${d(c)}`;
const mind = (c: string) => `registry.example.invalid/geldar/mind@${d(c)}`;
const other = `registry.example.invalid/othertenant/app@${d('f')}`;
const env = (...refs: string[]) => `${refs.map((r, i) => `GELDAR_X${i}_IMAGE=${r}`).join('\n')}\n`;

function fixture(images: string[], current: string | null, previous: string | null) {
  const root = mkdtempSync(join(tmpdir(), 'prune-img-'));
  dirs.push(root);
  mkdirSync(join(root, 'state'));
  mkdirSync(join(root, 'bin'));
  writeFileSync(join(root, 'images.txt'), `${images.join('\n')}\n`);
  writeFileSync(
    join(root, 'bin', 'docker'),
    '#!/bin/sh\nprintf "%s\n" "$*" >> "$DOCKER_CALLS_LOG"\ncase "$*" in\n  "images "*) cat "$DOCKER_IMAGES";;\nesac\nexit 0\n',
    { mode: 0o755 },
  );
  if (current !== null) writeFileSync(join(root, 'release.env'), current);
  if (previous !== null) writeFileSync(join(root, 'state', 'previous.env'), previous);
  return root;
}

function run(root: string, args: string[] = [], extraEnv: Record<string, string> = {}) {
  const r = spawnSync(SH, [p(SCRIPT), ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      GELDAR_RELEASE_FILE: p(join(root, 'release.env')),
      GELDAR_STATE_DIR: p(join(root, 'state')),
      DOCKER_IMAGES: p(join(root, 'images.txt')),
      DOCKER_CALLS_LOG: p(join(root, 'calls.log')),
      PATH: [p(join(root, 'bin')), REAL_BIN, process.env.PATH ?? ''].join(delimiter),
      ...extraEnv,
    },
  });
  const calls = existsSync(join(root, 'calls.log'))
    ? readFileSync(join(root, 'calls.log'), 'utf8')
    : '';
  return { code: r.status, out: r.stdout, err: r.stderr, calls };
}

const all = [body('1'), body('2'), body('3'), mind('1'), mind('2'), other];

describe('prune-deploy-images.sh', () => {
  it('dry run lists the old Geldar references and calls no rm', () => {
    const root = fixture(all, env(body('3'), mind('2')), env(body('2'), mind('1')));
    const r = run(root);
    expect(r.code).toBe(0);
    expect(r.out).toBe(`would remove ${body('1')}\n`);
    expect(r.calls).not.toContain('image rm');
  });

  it('--apply removes only references outside the current and previous sets', () => {
    const root = fixture(all, env(body('3'), mind('2')), env(body('2'), mind('1')));
    const r = run(root, ['--apply']);
    expect(r.code).toBe(0);
    expect(r.calls).toContain(`image rm ${body('1')}`);
    expect(r.calls).not.toContain(body('2'));
    expect(r.calls).not.toContain(body('3'));
    expect(r.calls).not.toContain(mind('1'));
  });

  it("never touches another tenant's image, and never runs a global prune", () => {
    const root = fixture(all, env(body('3'), mind('2')), env(body('2'), mind('1')));
    const r = run(root, ['--apply']);
    expect(r.calls).not.toContain('othertenant');
    expect(r.calls).not.toMatch(/prune/);
  });

  it('works with no previous manifest, keeping only the current set', () => {
    const root = fixture(all, env(body('3'), mind('2')), null);
    const r = run(root);
    expect(r.out).toContain(`would remove ${body('2')}`);
    expect(r.out).toContain(`would remove ${mind('1')}`);
    expect(r.out).not.toContain(body('3'));
  });

  it.each([
    ['missing', null],
    ['with no images', '# only a comment\n'],
  ])('a current manifest that is %s removes nothing and exits 1', (_l, cur) => {
    const root = fixture(all, cur, null);
    const r = run(root, ['--apply']);
    expect(r.code).toBe(1);
    expect(r.calls).not.toContain('image rm');
  });

  it('a held colo-cd lock removes nothing and exits 1', () => {
    const root = fixture(all, env(body('3')), null);
    mkdirSync(join(root, 'state', 'cd.lock'));
    const r = run(root, ['--apply']);
    expect(r.code).toBe(1);
    expect(r.calls).not.toContain('image rm');
    expect(existsSync(join(root, 'state', 'cd.lock'))).toBe(true);
  });

  it('releases its lock, and rejects unknown arguments', () => {
    const root = fixture(all, env(body('3')), null);
    run(root, ['--apply']);
    expect(existsSync(join(root, 'state', 'cd.lock'))).toBe(false);
    expect(run(root, ['--force']).code).toBe(1);
  });

  it('a repository whose name is only a substring of a kept repository is not touched', () => {
    const longer = `registry.example.invalid/geldar/body-extra@${d('3')}`;
    const root = fixture([body('1'), longer], env(longer), null);
    const r = run(root, ['--apply']);
    expect(r.calls).not.toContain('image rm');
  });

  it('reads a previous manifest with CRLF, quotes and tagged references', () => {
    const prev = `GELDAR_X_IMAGE="registry.example.invalid/geldar/body:1.2@${d('2')}"\r\nGELDAR_Y_IMAGE='${mind('1')}'\r\n`;
    const root = fixture(all, env(body('3'), mind('2')), prev);
    const r = run(root);
    expect(r.out).toBe(`would remove ${body('1')}\n`);
  });

  it('a duplicated image row is reported once', () => {
    const root = fixture([body('1'), body('1'), body('3')], env(body('3')), null);
    expect(run(root).out).toBe(`would remove ${body('1')}\n`);
  });

  describe('the records of the current release (the /etc copy is root-only on the node)', () => {
    const put = (root: string, rel: string, text: string) =>
      writeFileSync(join(root, 'state', rel), text);

    it('works with no /etc manifest when the state directory copy lists the images', () => {
      const root = fixture(all, null, null);
      put(root, 'release.env', env(body('3'), mind('2')));
      const out = run(root).out;
      for (const ref of [body('1'), body('2'), mind('1')])
        expect(out).toContain(`would remove ${ref}`);
      expect(out).not.toContain(body('3'));
      expect(out).not.toContain(mind('2'));
    });

    it('works with only current.env, and keeps what previous.env names too', () => {
      const root = fixture(all, null, null);
      put(root, 'current.env', env(body('3'), mind('2')));
      put(root, 'previous.env', env(body('2'), mind('1')));
      expect(run(root).out).toBe(`would remove ${body('1')}\n`);
    });

    it("a refusal for want of a record names GELDAR_STATE_DIR and the node's state directory", () => {
      const root = fixture(all, null, null);
      const r = run(root, ['--apply']);
      expect(r.code).toBe(1);
      expect(r.err).toContain('GELDAR_STATE_DIR');
      expect(r.err).toContain('/mnt/nvme/geldar-colo/state');
    });

    it('refuses when only previous.env lists images: it is not a record of what is live', () => {
      const root = fixture(all, null, null);
      put(root, 'previous.env', env(body('2')));
      const r = run(root, ['--apply']);
      expect(r.code).toBe(1);
      expect(r.calls).not.toContain('image rm');
    });
  });

  // Fail closed on a partial view: a manifest that EXISTS but cannot be used refuses the run (dry run too), never skipped.
  describe('a manifest that exists but is unusable refuses and removes nothing', () => {
    const canChmod = process.platform !== 'win32' && process.getuid?.() !== 0;
    const records = ['previous.env', 'current.env', 'release.env'];
    const damages: [string, (p: string, root: string) => void][] = [
      ['empty', (p) => writeFileSync(p, '')],
      ['a comment only', (p) => writeFileSync(p, '# nothing\n')],
      ['a directory', (p) => mkdirSync(p)],
      ['a dangling symlink', (p, root) => symlinkSync(join(root, 'nowhere'), p)],
    ];
    // Every live record and previous.env are valid EXCEPT the one damaged, so only that record can trigger the refusal: the
    // generic "no record exists" refusal must not be able to stand in for it.
    const setup = (rel: string, damage: (p: string, root: string) => void) => {
      const root = fixture(all, null, null);
      writeFileSync(join(root, 'state', 'release.env'), env(body('3'), mind('2')));
      writeFileSync(join(root, 'state', 'current.env'), env(body('3'), mind('2')));
      writeFileSync(join(root, 'state', 'previous.env'), env(body('2'), mind('1')));
      rmSync(join(root, 'state', rel), { force: true });
      damage(join(root, 'state', rel), root);
      return root;
    };

    it('control: with every record valid the run proceeds', () => {
      const root = setup('previous.env', (p) => writeFileSync(p, env(body('2'), mind('1'))));
      expect(run(root).code).toBe(0);
    });

    it.each(records.flatMap((rel) => damages.map(([what, d]) => [rel, what, d] as const)))(
      '%s that is %s',
      (rel, _what, damage) => {
        let root: string;
        try {
          root = setup(rel, damage);
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code === 'EPERM') return; // no symlink right here; Linux CI covers it
          throw e;
        }
        for (const args of [[], ['--apply']]) {
          const r = run(root, args);
          expect(r.code, args.join(' ')).toBe(1);
          expect(r.err).toContain(rel);
          expect(r.out).not.toContain('would remove');
          expect(r.calls).not.toContain('image rm');
        }
      },
    );

    it.skipIf(!canChmod).each(records)('%s with mode 000 (cannot be read)', (rel) => {
      const root = setup(rel, (p) => {
        writeFileSync(p, env(body('2')));
        chmodSync(p, 0);
      });
      for (const args of [[], ['--apply']]) {
        const r = run(root, args);
        expect(r.code, args.join(' ')).toBe(1);
        expect(r.err).toContain(rel);
        expect(r.calls).not.toContain('image rm');
      }
    });

    // Isolated: a valid live record exists outside the state directory (release.env at the root), so the generic "no record"
    // refusal cannot stand in; the state directory is the only thing unsearchable, and the message must be the new check's.
    it.skipIf(!canChmod)(
      'a state directory that cannot be searched refuses with the search hint',
      () => {
        const root = fixture(all, env(body('3'), mind('2')), null);
        chmodSync(join(root, 'state'), 0o600);
        try {
          for (const args of [[], ['--apply']]) {
            const r = run(root, args);
            expect(r.code, args.join(' ')).toBe(1);
            expect(r.err).toContain('cannot be searched');
            expect(r.err).toContain('sudo');
            expect(r.calls).not.toContain('image rm');
          }
        } finally {
          chmodSync(join(root, 'state'), 0o700);
        }
      },
    );

    // The one exception: the root-only /etc/geldar-colo directory (GELDAR_RELEASE_FILE) is skipped when it cannot be searched.
    // Without the exception the image prune would refuse on every non-root run of the node.
    it.skipIf(!canChmod)(
      'the root-only manifest directory behind GELDAR_RELEASE_FILE is skipped, not refused',
      () => {
        const root = fixture(all, null, null);
        writeFileSync(join(root, 'state', 'current.env'), env(body('3'), mind('2')));
        const etc = join(root, 'etc-geldar-colo');
        mkdirSync(etc);
        writeFileSync(join(etc, 'release.env'), env(body('3')));
        chmodSync(etc, 0);
        try {
          const r = run(root, [], { GELDAR_RELEASE_FILE: p(join(etc, 'release.env')) });
          expect(r.err).not.toContain('cannot be searched');
          expect(r.code).toBe(0);
          expect(r.out).toContain('would remove');
        } finally {
          chmodSync(etc, 0o700);
        }
      },
    );

    it("a missing state directory names GELDAR_STATE_DIR and the node's path", () => {
      const root = fixture(all, env(body('3')), null);
      rmSync(join(root, 'state'), { recursive: true });
      const r = run(root, ['--apply']);
      expect(r.code).toBe(1);
      expect(r.err).toContain('GELDAR_STATE_DIR');
      expect(r.err).toContain('/mnt/nvme/geldar-colo/state');
    });
  });

  // The signal is sent from a shell (`kill` of the script's own pid), so it is a real TERM on Windows (Git for Windows' sh)
  // as well as on Linux. The stub docker blocks for a second inside each `image rm`; the TERM arrives during the first.
  it('a TERM during the removal loop stops the loop and releases the colo-cd lock', () => {
    const olds = ['1', '2', '3', '4', '5'].map(body);
    const root = fixture([...olds, body('9')], env(body('9')), null);
    writeFileSync(
      join(root, 'bin', 'docker'),
      [
        '#!/bin/sh',
        'case "$*" in',
        `  "images "*) cat "${p(root)}/images.txt" ;;`,
        `  "image rm"*) echo "$3" >> "${p(root)}/rm.log"; : > "${p(root)}/rm.started"; sleep 1 ;;`,
        'esac',
        '',
      ].join('\n'),
      { mode: 0o755 },
    );
    const driver = [
      `sh "${p(SCRIPT)}" --apply >/dev/null 2>&1 &`,
      'pid=$!',
      `n=0; while [ ! -e "${p(root)}/rm.started" ] && [ $n -lt 200 ]; do sleep 0.1; n=$((n + 1)); done`,
      'kill -TERM $pid',
      'wait $pid',
      'echo "rc=$?"',
    ].join('\n');
    const r = spawnSync(SH, ['-c', driver], {
      encoding: 'utf8',
      env: {
        ...process.env,
        GELDAR_RELEASE_FILE: p(join(root, 'release.env')),
        GELDAR_STATE_DIR: p(join(root, 'state')),
        PATH: [p(join(root, 'bin')), REAL_BIN, process.env.PATH ?? ''].join(delimiter),
      },
    });
    const removed = readFileSync(join(root, 'rm.log'), 'utf8').trim().split('\n');
    expect(r.stdout, r.stderr).toContain('rc=1');
    // The first removal was running when the TERM came; at most one more may already have started. All five means no stop.
    expect(removed.length).toBeLessThanOrEqual(2);
    expect(existsSync(join(root, 'state', 'cd.lock'))).toBe(false);
  });
});
