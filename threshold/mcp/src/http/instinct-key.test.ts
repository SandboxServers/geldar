import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import {
  connectionSource,
  INSTINCT_HEADER,
  INSTINCT_KEY_MIN_BYTES,
  loadInstinctKey,
  sameKey,
} from './instinct-key.ts';

// The compare is spied: a revert to a plain === must fail here, not only in the behaviour tests.
vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return { ...actual, timingSafeEqual: vi.fn(actual.timingSafeEqual) };
});

const KEY = 'k'.repeat(40);
const KEY_BYTES = Buffer.from(KEY, 'utf8');

/** A request with the given raw header pairs; only `rawHeaders` is read. */
function request(...pairs: string[]): Pick<IncomingMessage, 'rawHeaders'> {
  return { rawHeaders: pairs } as unknown as Pick<IncomingMessage, 'rawHeaders'>;
}

describe('loadInstinctKey', () => {
  it('is off for an empty file, with or without its line feed', () => {
    expect(loadInstinctKey('')).toEqual({ outcome: 'off' });
    expect(loadInstinctKey('\n')).toEqual({ outcome: 'off' });
  });

  it('refuses a key shorter than the minimum, one byte under the line', () => {
    expect(loadInstinctKey('k'.repeat(INSTINCT_KEY_MIN_BYTES - 1))).toEqual({ outcome: 'refused' });
    expect(loadInstinctKey('k'.repeat(INSTINCT_KEY_MIN_BYTES))).toEqual({
      outcome: 'ok',
      key: Buffer.alloc(INSTINCT_KEY_MIN_BYTES, 'k'),
    });
  });

  it('removes one trailing LF or CRLF and nothing else', () => {
    expect(loadInstinctKey(`${KEY}\r\n`)).toEqual({ outcome: 'ok', key: KEY_BYTES });
    expect(loadInstinctKey(`${KEY}\n`)).toEqual({ outcome: 'ok', key: KEY_BYTES });
  });
});

describe('sameKey', () => {
  it('accepts only the exact key', () => {
    expect(sameKey(KEY, KEY_BYTES)).toBe(true);
  });

  it('refuses a prefix-equal wrong key', () => {
    expect(sameKey('k'.repeat(39), KEY_BYTES)).toBe(false);
  });

  it('refuses an equal-length wrong key', () => {
    expect(sameKey(`${'k'.repeat(39)}j`, KEY_BYTES)).toBe(false);
  });

  it('refuses a longer key, a shorter key and the empty string', () => {
    expect(sameKey('k'.repeat(41), KEY_BYTES)).toBe(false);
    expect(sameKey('k'.repeat(20), KEY_BYTES)).toBe(false);
    expect(sameKey('', KEY_BYTES)).toBe(false);
  });

  it('compares in constant time with timingSafeEqual', () => {
    vi.mocked(timingSafeEqual).mockClear();
    sameKey('wrong', KEY_BYTES);
    expect(timingSafeEqual).toHaveBeenCalledTimes(1);
  });
});

describe('connectionSource', () => {
  it('is model when no key is loaded, even with the right header', () => {
    expect(connectionSource(request(INSTINCT_HEADER, KEY), undefined)).toBe('model');
  });

  it('is instinct only for the exact key in the header', () => {
    expect(connectionSource(request(INSTINCT_HEADER, KEY), KEY_BYTES)).toBe('instinct');
    expect(connectionSource(request('X-Geldar-Instinct-Key', KEY), KEY_BYTES)).toBe('instinct');
  });

  it('is model when the header is absent, wrong, a prefix or a different length', () => {
    expect(connectionSource(request(), KEY_BYTES)).toBe('model');
    expect(connectionSource(request(INSTINCT_HEADER, 'x'.repeat(40)), KEY_BYTES)).toBe('model');
    expect(connectionSource(request(INSTINCT_HEADER, 'k'.repeat(39)), KEY_BYTES)).toBe('model');
    expect(connectionSource(request(INSTINCT_HEADER, `${KEY}k`), KEY_BYTES)).toBe('model');
    expect(connectionSource(request(INSTINCT_HEADER, ''), KEY_BYTES)).toBe('model');
  });

  it('is model when the header is repeated, even if every value is the key', () => {
    expect(connectionSource(request(INSTINCT_HEADER, KEY, INSTINCT_HEADER, KEY), KEY_BYTES)).toBe(
      'model',
    );
    expect(connectionSource(request(INSTINCT_HEADER, KEY, INSTINCT_HEADER, 'x'), KEY_BYTES)).toBe(
      'model',
    );
  });

  it('ignores other headers that carry the key', () => {
    expect(connectionSource(request('Authorization', KEY), KEY_BYTES)).toBe('model');
  });
});
