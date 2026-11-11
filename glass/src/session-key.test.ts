import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadGlassConfig } from './config.ts';
import { MIN_SESSION_KEY_LENGTH, verifyKinoSession } from './kino-cookie.ts';

const forge = (key: string): string => {
  const body = Buffer.from(JSON.stringify({ h: 'a'.repeat(64), exp: 9e15 })).toString('base64url');
  const sig = createHmac('sha256', key).update(`kino-session-v1:${body}`).digest('base64url');
  return `${body}.${sig}`;
};

describe('session key fails closed', () => {
  afterEach(() => vi.restoreAllMocks());

  it('accepts a cookie signed with a real key', () => {
    const key = 'k'.repeat(MIN_SESSION_KEY_LENGTH);
    expect(verifyKinoSession(key, forge(key), Date.now())?.identityHash).toBe('a'.repeat(64));
  });

  it('rejects a cookie anyone could sign against an empty or short key', () => {
    expect(verifyKinoSession('', forge(''), Date.now())).toBeNull();
    expect(verifyKinoSession('short', forge('short'), Date.now())).toBeNull();
  });

  const env = (extra: Record<string, string>): NodeJS.ProcessEnv => ({
    GELDAR_GLASS_PG_PASSWORD_FILE: '/pw',
    ...extra,
  });
  const read = (files: Record<string, string>) => (p: string) => {
    if (!(p in files)) throw new Error('ENOENT');
    return files[p] as string;
  };

  it('disables the cookie path for an empty, short or unreadable key file and logs an error', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const files of [
      { '/pw': 'p', '/k': '  \n' },
      { '/pw': 'p', '/k': 'x'.repeat(31) },
      { '/pw': 'p' },
    ]) {
      const c = loadGlassConfig(env({ GELDAR_GLASS_SESSION_KEY_FILE: '/k' }), read(files));
      expect(c.sessionKey).toBeUndefined();
    }
    expect(err).toHaveBeenCalledTimes(3);
  });

  it('keeps a long key, and stays silent and anonymous-only when no file is configured', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const key = 'y'.repeat(40);
    expect(
      loadGlassConfig(
        env({ GELDAR_GLASS_SESSION_KEY_FILE: '/k' }),
        read({ '/pw': 'p', '/k': `${key}\n` }),
      ).sessionKey,
    ).toBe(key);
    expect(loadGlassConfig(env({}), read({ '/pw': 'p' })).sessionKey).toBeUndefined();
    expect(err).not.toHaveBeenCalled();
  });
});
