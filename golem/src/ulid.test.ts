import { describe, expect, it } from 'vitest';
import { ulid } from './ulid.ts';

describe('ulid', () => {
  it('is 26 Crockford base32 characters', () => {
    expect(ulid()).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it('encodes a fixed time and fixed random bytes to a known literal', () => {
    const allOnes = () => new Uint8Array(10).fill(255);
    expect(ulid(1, allOnes)).toBe('0000000001ZZZZZZZZZZZZZZZZ');
    expect(ulid(0, () => new Uint8Array(10))).toBe('0000000000' + '0'.repeat(16));
  });

  it('sorts by time: an id 1 ms later sorts after an earlier one', () => {
    const zeros = () => new Uint8Array(10);
    const earlier = ulid(1_700_000_000_000, zeros);
    const later = ulid(1_700_000_000_001, zeros);
    expect([later, earlier].sort()).toEqual([earlier, later]);
    expect(earlier < later).toBe(true);
  });
});
