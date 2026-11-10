import { describe, expect, it } from 'vitest';
import { hashToken, mintToken, TOKEN_PATTERN } from './token-hash.ts';

/**
 * RFC 4231 HMAC-SHA-256 test vectors (cases 1, 2, 3 and 7; case 7 covers a key longer than the
 * block size). Case 6 is left out: its value could not be checked offline.
 */
const RFC_4231 = [
  {
    name: 'case 1',
    key: Buffer.alloc(20, 0x0b),
    data: 'Hi There',
    hex: 'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7',
  },
  {
    name: 'case 2',
    key: 'Jefe',
    data: 'what do ya want for nothing?',
    hex: '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
  },
  {
    name: 'case 3',
    key: Buffer.alloc(20, 0xaa),
    data: Buffer.alloc(50, 0xdd),
    hex: '773ea91e36800e46854db8ebd09181a72959098b3ef8c122d9635514ced565fe',
  },
  {
    name: 'case 7 (key and data longer than the block)',
    key: Buffer.alloc(131, 0xaa),
    data: 'This is a test using a larger than block-size key and a larger than block-size data. The key needs to be hashed before being used by the HMAC algorithm.',
    hex: '9b09ffa71b942fcb27635fbcd5b0e944bfdc63644f0713938a7f51535c3a35e2',
  },
];

describe('hashToken', () => {
  for (const vector of RFC_4231) {
    it(`matches RFC 4231 ${vector.name}`, () => {
      const digest = hashToken(vector.key, vector.data);
      expect(digest.toString('hex')).toBe(vector.hex);
    });
  }

  it('stores 32 bytes, the mcp_tokens CHECK (octet_length = 32)', () => {
    expect(hashToken('pepper', mintToken()).length).toBe(32);
  });

  it('depends on the pepper: another pepper gives another hash for the same token', () => {
    const token = mintToken();
    expect(hashToken('pepper-a', token).equals(hashToken('pepper-b', token))).toBe(false);
  });

  it('reads a string pepper and a byte pepper of the same bytes alike', () => {
    const token = mintToken();
    const bytes = Buffer.from('pepper-bytes', 'utf8');
    expect(hashToken('pepper-bytes', token).equals(hashToken(bytes, token))).toBe(true);
  });

  it('changes when the token changes by one character', () => {
    const token = mintToken();
    const other = `${token.slice(0, -1)}${token.endsWith('0') ? '1' : '0'}`;
    expect(hashToken('p', token).equals(hashToken('p', other))).toBe(false);
  });
});

describe('mintToken', () => {
  it('is gmcp- and 64 lower-case hex characters, from 32 random bytes', () => {
    const token = mintToken((size) => Buffer.alloc(size, 0xab));
    expect(token).toBe(`gmcp-${'ab'.repeat(32)}`);
    expect(TOKEN_PATTERN.test(token)).toBe(true);
  });

  it('asks for exactly 32 random bytes', () => {
    const sizes: number[] = [];
    mintToken((size) => {
      sizes.push(size);
      return Buffer.alloc(size);
    });
    expect(sizes).toEqual([32]);
  });

  it('produces tokens that match the pattern from the real random source', () => {
    for (let i = 0; i < 20; i += 1) expect(TOKEN_PATTERN.test(mintToken())).toBe(true);
  });

  it('rejects upper-case, short and prefixless strings', () => {
    expect(TOKEN_PATTERN.test(`gmcp-${'AB'.repeat(32)}`)).toBe(false);
    expect(TOKEN_PATTERN.test(`gmcp-${'ab'.repeat(31)}`)).toBe(false);
    expect(TOKEN_PATTERN.test(`xmcp-${'ab'.repeat(32)}`)).toBe(false);
  });
});
