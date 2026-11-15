import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { calls, type Fixture, fixture, mutates, REAL, run, sha256 } from './colo-deploy-fixture';

// fetch_chunky and fetch_coreprotect (deploy/common.sh) check the downloaded jar's sha512 as well as its sha256 when the
// lock declares a sha512 (check_lock_sha512). The fixture locks carry no sha512, so these tests write their own locks.
const sha512 = (text: string) => createHash('sha512').update(text).digest('hex');
const ZERO512 = '0'.repeat(128);

function lockWith(url: string, sha: string, sha512Value?: string): string {
  const extra = sha512Value === undefined ? '' : `,\n  "sha512": "${sha512Value}"`;
  return `{\n  "url": "${url}",\n  "sha256": "${sha}"${extra}\n}\n`;
}

interface JarCase {
  name: string;
  lock: (fx: Fixture) => string;
  text: (fx: Fixture) => string;
  jar: string;
}

const CASES: JarCase[] = [
  {
    name: 'chunky',
    lock: (fx) => fx.chunkyLock,
    text: (fx) => fx.chunkyText,
    jar: 'chunky.jar',
  },
  {
    name: 'coreprotect',
    lock: (fx) => fx.coreprotectLock,
    text: (fx) => fx.coreprotectText,
    jar: 'coreprotect.jar',
  },
];

describe.each(CASES)('colo-up.sh: the $name jar checks sha512 as well as sha256', (c) => {
  // Writes the lock for this case: the URL is the local fixture jar, and the hashes are given (or computed).
  function writeLock(fx: Fixture, sha: string, sha512Value?: string) {
    const url = pathToFileURL(join(fx.dir, c.jar)).href;
    writeFileSync(c.lock(fx), lockWith(url, sha, sha512Value));
  }

  it('stores the jar when the sha256 and the sha512 both match the lock', () => {
    const fx = fixture();
    const text = c.text(fx);
    writeLock(fx, sha256(text), sha512(text));
    const r = run('colo-up.sh', fx, REAL);
    expect(r.code).toBe(0);
    expect(r.out).toContain(`${c.name}: jar verified and stored`);
    expect(readFileSync(join(fx.state, c.name, c.jar), 'utf8')).toBe(text);
  });

  it('keeps the old behaviour for a lock with no sha512 key: sha256 alone is checked', () => {
    const fx = fixture();
    writeLock(fx, sha256(c.text(fx)));
    const r = run('colo-up.sh', fx, REAL);
    expect(r.code).toBe(0);
    expect(r.out).toContain(`${c.name}: jar verified and stored`);
    expect(readFileSync(join(fx.state, c.name, c.jar), 'utf8')).toBe(c.text(fx));
  });

  it('refuses a jar whose sha256 matches and whose sha512 does not, and stores nothing', () => {
    const fx = fixture();
    writeLock(fx, sha256(c.text(fx)), ZERO512);
    const r = run('colo-up.sh', fx, REAL);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain(`${c.name}: sha512 mismatch`);
    expect(existsSync(join(fx.state, c.name, c.jar))).toBe(false);
    expect(mutates(calls(fx))).toBe(false);
  });

  it('refuses the tampered jar on a dry run too, and runs no pull or up', () => {
    const fx = fixture();
    writeLock(fx, sha256(c.text(fx)), ZERO512);
    const r = run('colo-up.sh', fx);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain(`${c.name}: sha512 mismatch`);
    expect(mutates(calls(fx))).toBe(false);
  });

  it('still reports a sha256 mismatch first, when the sha512 is right', () => {
    const fx = fixture();
    writeLock(fx, '0'.repeat(64), sha512(c.text(fx)));
    const r = run('colo-up.sh', fx, REAL);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain(`${c.name}: sha256 mismatch`);
    expect(r.out).not.toContain('sha512');
    expect(existsSync(join(fx.state, c.name, c.jar))).toBe(false);
  });

  it.each([
    ['an uppercase hex value', (t: string) => sha512(t).toUpperCase()],
    ['a value of the wrong length', (t: string) => sha512(t).slice(0, 64)],
    ['an empty value', () => ''],
  ])('refuses a lock whose sha512 is %s, before any pull or up', (_label, value) => {
    const fx = fixture();
    const text = c.text(fx);
    writeLock(fx, sha256(text), value(text));
    const r = run('colo-up.sh', fx, REAL);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain(`${c.name} lock: sha512 is not 128 lowercase hex characters`);
    expect(existsSync(join(fx.state, c.name, c.jar))).toBe(false);
    expect(mutates(calls(fx))).toBe(false);
  });
});
