// Installer tests for a directory or a FIFO in place of the operator's env file or the channel log (G3-02, GE-04). Helpers are
// in genesis-deploy-channel-harness.ts.
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, INSTALL_TIMEOUT, install, setup } from './genesis-deploy-channel-harness';

afterEach(cleanup);
// POSIX FIFO support: mkfifo must be on PATH. spawnSync reports ENOENT in error when the binary is absent.
function hasMkfifo(): boolean {
  return spawnSync('mkfifo', ['--help'], { encoding: 'utf8' }).error === undefined;
}

function makeFifo(path: string) {
  const r = spawnSync('mkfifo', [path], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`mkfifo failed: ${r.stderr}`);
}

describe('deploy channel: installer, special files (GE-04)', () => {
  // A directory is a portable non-regular file: refused where the operator file or the log should be.
  it('refuses a directory in place of colo-env.sh or channel.log', () => {
    const fx = setup();
    const dest = join(fx.root, 'dest');
    mkdirSync(join(dest, 'home', 'op-user', 'colo-env.sh'), { recursive: true });
    const envRefused = install(dest, 'op-user');
    expect(envRefused.status).toBe(1);
    expect(envRefused.stderr).toContain('colo-env.sh is not a regular file; refused');
    const dest2 = join(fx.root, 'dest2');
    mkdirSync(join(dest2, 'var', 'lib', 'geldar-deploy', 'channel.log'), { recursive: true });
    const logRefused = install(dest2, 'op-user');
    expect(logRefused.status).toBe(1);
    expect(logRefused.stderr).toContain('channel.log is not a regular file; refused');
  });

  // A FIFO is not a regular file, and a read of it would block. The installer must refuse it at once: a run that hangs
  // until the 10-second spawn timeout is a failure (status null and a signal, not status 1).
  it.skipIf(process.platform === 'win32' || !hasMkfifo())(
    'refuses a FIFO in place of colo-env.sh or channel.log, and does not hang',
    () => {
      const fx = setup();
      const dest = join(fx.root, 'dest');
      mkdirSync(join(dest, 'home', 'op-user'), { recursive: true });
      makeFifo(join(dest, 'home', 'op-user', 'colo-env.sh'));
      const envRefused = install(dest, 'op-user', { timeout: 10000 });
      expect(envRefused.signal).toBeNull();
      expect(envRefused.status).toBe(1);
      expect(envRefused.stderr).toContain('colo-env.sh is not a regular file; refused');
      const dest2 = join(fx.root, 'dest2');
      const logDir = join(dest2, 'var', 'lib', 'geldar-deploy');
      mkdirSync(logDir, { recursive: true });
      makeFifo(join(logDir, 'channel.log'));
      const logRefused = install(dest2, 'op-user', { timeout: 10000 });
      expect(logRefused.signal).toBeNull();
      expect(logRefused.status).toBe(1);
      expect(logRefused.stderr).toContain('channel.log is not a regular file; refused');
    },
    INSTALL_TIMEOUT,
  );
});
