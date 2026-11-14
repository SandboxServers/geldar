import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// mcp-tokens (the CLI mint) and the register (renewals) keep their own constants. A token minted by one
// and renewed by the other must last the same time, so the two lifetimes must agree (decision 0170, point 1).
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function read(path: string): string {
  return readFileSync(resolve(root, path), 'utf8');
}

function constantValue(text: string, pattern: RegExp): number {
  const match = pattern.exec(text);
  if (!match?.[1]) throw new Error(`constant not found: ${pattern.source}`);
  return Number(match[1]);
}

describe('token lifetime', () => {
  const mintDays = constantValue(
    read('tools/mcp-tokens/src/tokens.ts'),
    /^export const TOKEN_EXPIRY_DAYS = (\d+);/m,
  );
  const register = read('threshold/register/src/tokens-policy.ts');

  it('mcp-tokens mints a token for 90 days', () => {
    expect(mintDays).toBe(90);
  });

  it('the register renews for 90 days, with a day of 24 hours', () => {
    expect(register).toContain('const DAY_MS = 24 * 60 * 60 * 1000;');
    expect(constantValue(register, /^export const TOKEN_LIFETIME_MS = (\d+) \* DAY_MS;/m)).toBe(90);
  });

  it('the mint and the register renewal agree', () => {
    expect(mintDays).toBe(
      constantValue(register, /^export const TOKEN_LIFETIME_MS = (\d+) \* DAY_MS;/m),
    );
  });
});
