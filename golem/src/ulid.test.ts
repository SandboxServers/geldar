import { describe, expect, it } from 'vitest';
import { ulid } from './ulid.ts';

describe('ulid', () => {
  it('is 26 Crockford base32 characters', () => {
    expect(ulid()).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it('encodes a fixed time and fixed random bytes to a known literal', () => {
    const allOnes = () => new Uint8Array(10).fill(255);
    expect(ulid(1, allOnes)).toBe('0000000001ZZZZZZZZZZZZZZZZ');
    expect(ulid(0, () => new Uint8Array(10))).toBe(`0000000000${'0'.repeat(16)}`);
  });

  it('encodes a realistic time and non-trivial random bytes to a known literal', () => {
    const bytes = () => Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(ulid(1_700_000_000_000, bytes)).toBe('01HF7YAT00000G40R40M30E209');
  });

  it('pins every alphabet index: 16 random characters per literal, 0 to 15 then 16 to 31', () => {
    // Each 5-bit group is one character; the two literals together use all 32 symbols.
    const low = () => Uint8Array.from([0, 68, 50, 20, 199, 66, 84, 182, 53, 207]);
    const high = () => Uint8Array.from([132, 101, 58, 86, 215, 198, 117, 190, 119, 223]);
    expect(ulid(1_700_000_000_000, low)).toBe('01HF7YAT000123456789ABCDEF');
    expect(ulid(1_700_000_000_000, high)).toBe('01HF7YAT00GHJKMNPQRSTVWXYZ');
  });

  it('sorts by time: an id 1 ms later sorts after an earlier one', () => {
    const zeros = () => new Uint8Array(10);
    const earlier = ulid(1_700_000_000_000, zeros);
    const later = ulid(1_700_000_000_001, zeros);
    expect([later, earlier].sort()).toEqual([earlier, later]);
    expect(earlier < later).toBe(true);
  });
});
