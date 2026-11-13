import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { calls, fixture, lockText, mutates, REAL, run, sha256 } from './colo-deploy-fixture';

// CoreProtect (block owner records) goes through fetch_coreprotect in deploy/common.sh: the lock's jar is verified by
// sha256 before anything uses it. The fixture lock points at a local file:// jar, so no test reaches the Modrinth CDN.
describe('colo-up.sh: the CoreProtect jar', () => {
  it('stores the verified jar under the state directory on a real run', () => {
    const fx = fixture();
    const r = run('colo-up.sh', fx, REAL);
    expect(r.code).toBe(0);
    expect(r.out).toContain('coreprotect: jar verified and stored');
    expect(readFileSync(join(fx.state, 'coreprotect', 'coreprotect.jar'), 'utf8')).toBe(
      fx.coreprotectText,
    );
  });

  it('dry run verifies the jar but keeps nothing and runs no pull or up', () => {
    const fx = fixture();
    const r = run('colo-up.sh', fx);
    expect(r.code).toBe(0);
    expect(r.out).toContain('coreprotect: jar verified against the lock (dry run keeps nothing)');
    expect(existsSync(join(fx.state, 'coreprotect', 'coreprotect.jar'))).toBe(false);
    expect(mutates(calls(fx))).toBe(false);
  });

  it('skips CoreProtect when its lock file is absent', () => {
    const fx = fixture();
    const r = run('colo-up.sh', fx, {
      ...REAL,
      GELDAR_COREPROTECT_LOCK: join(fx.dir, 'no-such.lock.json'),
    });
    expect(r.code).toBe(0);
    expect(r.out).toContain('coreprotect: no lock file');
    expect(existsSync(join(fx.state, 'coreprotect', 'coreprotect.jar'))).toBe(false);
  });

  it('refuses a CoreProtect jar whose sha256 does not match the lock, and runs no pull or up', () => {
    const fx = fixture();
    writeFileSync(
      fx.coreprotectLock,
      lockText(pathToFileURL(join(fx.dir, 'coreprotect.jar')).href, '0'.repeat(64)),
    );
    const r = run('colo-up.sh', fx, REAL);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('coreprotect: sha256 mismatch');
    expect(existsSync(join(fx.state, 'coreprotect', 'coreprotect.jar'))).toBe(false);
    expect(mutates(calls(fx))).toBe(false);
  });

  it('refuses a lock whose sha256 is not 64 lowercase hex characters', () => {
    const fx = fixture();
    writeFileSync(
      fx.coreprotectLock,
      lockText(pathToFileURL(join(fx.dir, 'coreprotect.jar')).href, 'ABC'),
    );
    const r = run('colo-up.sh', fx, REAL);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('coreprotect lock: sha256 is not 64 lowercase hex');
    expect(mutates(calls(fx))).toBe(false);
  });

  it.each([
    [
      'a file:// url without the test-only variable',
      () => pathToFileURL('coreprotect.jar').href,
      '0',
    ],
    ['an http url', () => 'http://example.invalid/coreprotect.jar', '1'],
  ])('refuses a CoreProtect lock with %s before any download', (_name, url, allow) => {
    const fx = fixture();
    writeFileSync(fx.coreprotectLock, lockText(url(), sha256(fx.coreprotectText)));
    const r = run('colo-up.sh', fx, { ...REAL, GELDAR_DEPLOY_ALLOW_FILE_URL: allow });
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('must be https');
    expect(existsSync(join(fx.state, 'coreprotect', 'coreprotect.jar'))).toBe(false);
    expect(mutates(calls(fx))).toBe(false);
  });
});
