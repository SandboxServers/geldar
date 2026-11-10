import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { THINKER_TOKEN_FILE_ENV, thinkerToken, tokenMatches } from './thinker-token.ts';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'geldar-thinker-token-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('thinkerToken', () => {
  it('is undefined when the variable is unset or empty (open hub)', () => {
    expect(thinkerToken({})).toBeUndefined();
    expect(thinkerToken({ [THINKER_TOKEN_FILE_ENV]: '' })).toBeUndefined();
  });

  it('reads the file and trims the trailing newline', () => {
    const file = join(dir, 'thinker.txt');
    writeFileSync(file, 's3cret-value\n');
    expect(thinkerToken({ [THINKER_TOKEN_FILE_ENV]: file })).toBe('s3cret-value');
  });

  it('refuses an unreadable or empty file, naming the variable and never a token', () => {
    const missing = join(dir, 'missing.txt');
    expect(() => thinkerToken({ [THINKER_TOKEN_FILE_ENV]: missing })).toThrow(
      THINKER_TOKEN_FILE_ENV,
    );
    const empty = join(dir, 'empty.txt');
    writeFileSync(empty, '\n');
    expect(() => thinkerToken({ [THINKER_TOKEN_FILE_ENV]: empty })).toThrow(/empty/);
  });
});

describe('tokenMatches', () => {
  it('accepts the expected token only', () => {
    expect(tokenMatches('abc123', 'abc123')).toBe(true);
    expect(tokenMatches('abc123', 'abc124')).toBe(false);
    expect(tokenMatches('abc123', 'abc1234')).toBe(false);
    expect(tokenMatches('abc123', 'ab')).toBe(false);
  });

  it('refuses a missing or non-string offer', () => {
    expect(tokenMatches('abc123', undefined)).toBe(false);
    expect(tokenMatches('abc123', '')).toBe(false);
    expect(tokenMatches('abc123', 123)).toBe(false);
  });
});
