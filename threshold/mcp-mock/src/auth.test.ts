import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkBearer, loadTokens } from './auth.ts';

const TOKEN_A = 'token-for-player-a-0123456789';
const TOKEN_B = 'token-for-player-b-0123456789';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tokensFile(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-mock-'));
  dirs.push(dir);
  const file = join(dir, 'tokens.json');
  writeFileSync(file, content);
  return file;
}

function loadError(content: string): string {
  try {
    loadTokens(tokensFile(content));
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error('expected loadTokens to throw');
}

describe('loadTokens', () => {
  it('loads a valid file', () => {
    const table = loadTokens(tokensFile(JSON.stringify({ a1: TOKEN_A, 'b-2': TOKEN_B })));
    expect([...table.keys()]).toEqual(['a1', 'b-2']);
    expect(table.get('a1')?.length).toBe(32);
  });

  it('rejects bad files without leaking a token', () => {
    const cases = [
      '{ not json ' + TOKEN_A,
      JSON.stringify({ a1: 'short' }),
      JSON.stringify({ A1: TOKEN_A }),
      JSON.stringify({ a1: TOKEN_A, b2: TOKEN_A }),
      JSON.stringify({}),
      JSON.stringify([TOKEN_A]),
      JSON.stringify({ a1: 12345 }),
    ];
    for (const content of cases) {
      const message = loadError(content);
      expect(message).not.toContain(TOKEN_A);
      expect(message).not.toContain(TOKEN_B);
    }
    expect(loadError(JSON.stringify({ a1: TOKEN_A, b2: TOKEN_A }))).toContain('entries 1 and 2');
    expect(loadError(JSON.stringify({ a1: 'short' }))).toContain('entry 1');
  }, 30_000);

  it('does not echo a key that is really a token', () => {
    const message = loadError(JSON.stringify({ [TOKEN_A]: 'x' }));
    expect(message).not.toContain(TOKEN_A);
    expect(message).not.toContain(TOKEN_A.slice(0, 10));
    expect(message).toContain('entry 1');
  });

  it('accepts a file that starts with a UTF-8 BOM', () => {
    const table = loadTokens(tokensFile(`﻿${JSON.stringify({ a1: TOKEN_A })}`));
    expect([...table.keys()]).toEqual(['a1']);
  });
});

describe('checkBearer', () => {
  const table = loadTokens(tokensFile(JSON.stringify({ aa: TOKEN_A, bb: TOKEN_B })));

  it('accepts the right token', () => {
    expect(checkBearer(table, 'aa', `Bearer ${TOKEN_A}`)).toBe('ok');
  });

  it('answers unauthorized for missing, malformed or wrong credentials', () => {
    expect(checkBearer(table, 'aa', undefined)).toBe('unauthorized');
    expect(checkBearer(table, 'aa', `bearer ${TOKEN_A}`)).toBe('unauthorized');
    expect(checkBearer(table, 'aa', `Basic ${TOKEN_A}`)).toBe('unauthorized');
    expect(checkBearer(table, 'aa', 'Bearer ')).toBe('unauthorized');
    expect(checkBearer(table, 'aa', 'Bearer wrong-token-0123456789')).toBe('unauthorized');
    expect(checkBearer(table, 'zz', `Bearer ${TOKEN_A}`)).toBe('unauthorized');
  });

  it("answers forbidden for another player's token", () => {
    expect(checkBearer(table, 'aa', `Bearer ${TOKEN_B}`)).toBe('forbidden');
  });
});
