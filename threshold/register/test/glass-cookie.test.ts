import { describe, expect, it } from 'vitest';
import { kinoSessionFromHeader } from '../../../glass/src/kino-cookie.ts';
import { signKinoSession } from '../src/session-cookie.ts';

const KEY = 'k'.repeat(40);
const HASH = 'cd'.repeat(32);

describe("Glass's read-only verifier agrees with the register signer", () => {
  const good = signKinoSession(KEY, { identityHash: HASH, expiresAt: 5000 });
  it('accepts what register signs, and refuses a wrong key, an edit and expiry', () => {
    expect(kinoSessionFromHeader(KEY, `a=b; gk_session=${good}`, 4999)?.identityHash).toBe(HASH);
    expect(kinoSessionFromHeader('z'.repeat(40), `gk_session=${good}`, 4999)).toBeNull();
    expect(kinoSessionFromHeader(KEY, `gk_session=${good.replace(/^./, 'A')}`, 4999)).toBeNull();
    expect(kinoSessionFromHeader(KEY, `gk_session=${good}`, 5000)).toBeNull();
    expect(kinoSessionFromHeader(KEY, `other=${good}`, 4999)).toBeNull();
  });
});
