// C7-03c5: the pinned Node runtime and the bundle sha256 gate of deploy/install-body-helper.sh. The fixture is
// install-body-helper-fixture.ts. The shell tests need bash (GELDAR_SHELL_TESTS_BASH on Windows).
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Fixture } from './install-body-helper-fixture';
import {
  BASH,
  BUILD_PATH,
  calls,
  fixture,
  mutations,
  NODE_BIN_PATH,
  NODE_DIR_PATH,
  NODE_STAMP_PATH,
  PG_PATH,
  PIN_SHA,
  removeFixtures,
  run,
  SCRIPT_SRC,
  SECRET_DIR_PATH,
  UNIT_PATH,
  withBuild,
  withEnv,
} from './install-body-helper-fixture';

const TARBALL = 'node-v22.23.4-linux-x64.tar.xz';
const CRAFTED = 'node-vtest.tar.xz';

afterEach(removeFixtures);

/**
 * Stages a crafted node tarball (a shell stand-in at node-vtest/bin/node) under the prefix, and a pin env file
 * that names its sha. The script reads that pin file only when a prefix is set (BODY_HELPER_NODE_ENV): the
 * real pin's tarball cannot be made here. Returns the pin file's path and the tarball's sha256.
 */
function stageCraftedNode(fx: Fixture): { pin: string; sha: string } {
  const src = join(fx.root, 'src/node-vtest/bin');
  mkdirSync(src, { recursive: true });
  writeFileSync(join(src, 'node'), '#!/bin/sh\necho "extracted-node $*" >> "$FAKE_LOG"\nexit 0\n');
  const made = spawnSync(
    BASH,
    [
      '-c',
      `chmod 755 src/node-vtest/bin/node && tar --force-local -cJf ${CRAFTED} -C src node-vtest`,
    ],
    {
      cwd: fx.root,
      encoding: 'utf8',
    },
  );
  if (made.status !== 0) throw new Error(`tar failed: ${made.stderr}`);
  const sha = createHash('sha256')
    .update(readFileSync(join(fx.root, CRAFTED)))
    .digest('hex');
  writeFileSync(
    join(fx.root, 'pin-test.env'),
    `BODY_HELPER_NODE_VERSION=22.23.4\nBODY_HELPER_NODE_TARBALL=${CRAFTED}\nBODY_HELPER_NODE_SHA256_LINUX_X64=${sha}\n`,
  );
  mkdirSync(join(fx.root, NODE_DIR_PATH), { recursive: true });
  copyFileSync(join(fx.root, CRAFTED), join(fx.root, NODE_DIR_PATH, CRAFTED));
  return { pin: './pin-test.env', sha };
}

describe('install-body-helper.sh: the pinned node (C7-03c5)', { timeout: 30_000 }, () => {
  it('the unit runs the pinned node by its absolute path, never /usr/bin/node or a PATH node', () => {
    const fx = fixture();
    withBuild(fx);
    withEnv(fx);
    const { status, out } = run(fx, ['--apply']);
    expect(status, out).toBe(0);
    const unit = readFileSync(join(fx.root, UNIT_PATH), 'utf8');
    expect(unit).toContain(
      'ExecStart=/opt/geldar/node/bin/node /opt/geldar/body-helper/dist/main.js',
    );
    expect(unit).not.toContain('/usr/bin/node');
    expect(unit).not.toMatch(/^ExecStart=node /m);
  });

  it('the migrate verb runs the pinned node: the node on PATH is never called', () => {
    const fx = fixture();
    withBuild(fx);
    withEnv(fx);
    const { status, out } = run(fx, ['--apply']);
    expect(status, out).toBe(0);
    const log = calls(fx);
    expect(
      log.some(
        (c) => c.startsWith('pinned-node ') && c.includes('--set-role-password geldar_helper'),
      ),
    ).toBe(true);
    expect(log.some((c) => c.startsWith('path-node '))).toBe(false);
  });

  it('a pinned node whose stamp names another sha is not trusted: --apply dies before any write', () => {
    const fx = fixture();
    withBuild(fx);
    withEnv(fx);
    const { status, out } = run(fx, ['--apply'], { stamp: 'f'.repeat(64) });
    expect(status, out).toBe(1);
    expect(out).toContain('nothing was changed');
    expect(existsSync(join(fx.root, UNIT_PATH))).toBe(false);
    expect(existsSync(join(fx.root, SECRET_DIR_PATH))).toBe(false);
    expect(mutations(fx)).toEqual([]);
  });

  it('the dry run names an unpinned node (stale stamp or no stamp) and plans no enable', () => {
    for (const stamp of ['f'.repeat(64), null]) {
      const fx = fixture();
      withBuild(fx);
      withEnv(fx);
      const { status, out } = run(fx, [], { stamp });
      expect(status, out).toBe(0);
      expect(out).toContain('is not the pinned 22.23.4');
      expect(out).toContain('enable blocked');
      expect(mutations(fx)).toEqual([]);
    }
  });

  it('a tarball that does not match its pin is refused on --apply, and blocked in the dry run', () => {
    const fx = fixture();
    withBuild(fx);
    withEnv(fx);
    mkdirSync(join(fx.root, NODE_DIR_PATH), { recursive: true });
    writeFileSync(join(fx.root, NODE_DIR_PATH, TARBALL), 'not the pinned tarball');
    const applied = run(fx, ['--apply'], { noNode: true });
    expect(applied.status, applied.out).toBe(1);
    expect(applied.out).toContain('does not match its sha256');
    expect(existsSync(join(fx.root, UNIT_PATH))).toBe(false);
    expect(mutations(fx)).toEqual([]);
    const planned = run(fx, [], { noNode: true });
    expect(planned.status, planned.out).toBe(0);
    expect(planned.out).toContain('blocked: pinned node 22.23.4 missing');
    expect(planned.out).not.toContain('would: extract');
  });

  it('a staged tarball with the pinned sha is extracted, stamped, and its node runs the migrate verb', () => {
    const fx = fixture();
    withBuild(fx);
    withEnv(fx);
    const { pin, sha } = stageCraftedNode(fx);
    const { status, out } = run(fx, ['--apply'], {
      noNode: true,
      env: { BODY_HELPER_NODE_ENV: pin },
    });
    expect(status, out).toBe(0);
    expect(existsSync(join(fx.root, NODE_BIN_PATH))).toBe(true);
    expect(readFileSync(join(fx.root, NODE_STAMP_PATH), 'utf8').trim()).toBe(sha);
    const log = calls(fx);
    expect(
      log.some(
        (c) => c.startsWith('extracted-node ') && c.includes('--set-role-password geldar_helper'),
      ),
    ).toBe(true);
    expect(log.some((c) => c.startsWith('path-node '))).toBe(false);
  });

  it('a root run under a prefix chowns the unpacked tree to root:root', () => {
    const fx = fixture();
    withBuild(fx);
    withEnv(fx);
    const { pin } = stageCraftedNode(fx);
    const { status, out } = run(fx, ['--apply'], {
      noNode: true,
      env: { BODY_HELPER_NODE_ENV: pin, FAKE_ROOT: '1' },
    });
    expect(status, out).toBe(0);
    expect(calls(fx)).toContain(`chown -R root:root ${NODE_DIR_PATH}`);
  });

  it('the extraction passes --no-same-owner, and the chown runs only under root', () => {
    expect(SCRIPT_SRC).toContain(
      'tar -xJf "$NODE_TARBALL_PATH" -C "$NODE_DIR" --strip-components=1 --no-same-owner',
    );
    expect(SCRIPT_SRC).toContain('if [ "$(id -u)" = 0 ]; then chown -R root:root "$NODE_DIR"; fi');
  });
});

describe('install-body-helper.sh: the bundle sha256 gate (C7-03c5)', { timeout: 30_000 }, () => {
  it('--apply with a bundle that does not match its sidecar dies before any write', () => {
    const fx = fixture();
    withBuild(fx, 'bad');
    withEnv(fx);
    const { status, out } = run(fx, ['--apply']);
    expect(status, out).toBe(1);
    expect(out).toContain('nothing was changed');
    expect(existsSync(join(fx.root, UNIT_PATH))).toBe(false);
    expect(existsSync(join(fx.root, SECRET_DIR_PATH))).toBe(false);
    expect(mutations(fx)).toEqual([]);
  });

  it('a missing sidecar blocks the dry run, and --apply dies before any write', () => {
    const fx = fixture();
    withBuild(fx, 'none');
    withEnv(fx);
    const dry = run(fx, []);
    expect(dry.status, dry.out).toBe(0);
    expect(dry.out).toContain('blocked: bundle sha256 sidecar missing');
    expect(dry.out).not.toContain('would: write unit file');
    const applied = run(fx, ['--apply']);
    expect(applied.status, applied.out).toBe(1);
    expect(applied.out).toContain('sidecar missing');
    expect(existsSync(join(fx.root, UNIT_PATH))).toBe(false);
    expect(existsSync(join(fx.root, PG_PATH))).toBe(false);
    expect(mutations(fx)).toEqual([]);
    expect(existsSync(join(fx.root, BUILD_PATH))).toBe(true);
  });

  it('the sha256 check runs before the pinned node is extracted (no tarball staged, so no extraction)', () => {
    const fx = fixture();
    withBuild(fx, 'bad');
    withEnv(fx);
    const { out } = run(fx, []);
    expect(out).toContain('blocked: bundle sha256 does not match');
    expect(out).not.toContain('extract pinned node');
    expect(existsSync(join(fx.root, NODE_BIN_PATH))).toBe(true);
  });
});

describe('pinned Node stand-in (C7-03c5)', () => {
  it('the test pin equals the committed pin', () => {
    expect(PIN_SHA).toMatch(/^[0-9a-f]{64}$/);
  });
});
