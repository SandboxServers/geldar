import { describe, expect, it } from 'vitest';
import { MCP_TOOL_NAMES, mcpToolSchemas, validateToolInput } from '../src/index.ts';

// GX-08: WaitInput takes an optional boolean `peek`; the schema is additive, so every plain wait still validates.
describe('wait peek input', () => {
  it('accepts a boolean peek alongside max_seconds', () => {
    expect(validateToolInput('wait', { max_seconds: 5, peek: true }).ok).toBe(true);
    expect(validateToolInput('wait', { max_seconds: 5, peek: false }).ok).toBe(true);
  });

  it('keeps a plain wait valid without peek', () => {
    expect(validateToolInput('wait', { max_seconds: 5 }).ok).toBe(true);
    expect(validateToolInput('wait', { max_seconds: 5, cursor: 'c_0' }).ok).toBe(true);
  });

  it('rejects a non-boolean peek', () => {
    expect(validateToolInput('wait', { max_seconds: 5, peek: 'yes' }).ok).toBe(false);
    expect(validateToolInput('wait', { max_seconds: 5, peek: 1 }).ok).toBe(false);
    expect(validateToolInput('wait', { max_seconds: 5, peek: null }).ok).toBe(false);
  });
});

// Agent-visible input text names no class, no key and no ticket (decisions 0058, 0059, 0068).
const BANNED_WORDS = /\binstinct\b|\bkey\b|\bkeyed\b|GX-/i;

/** Every `description` string under a schema node, without following `$ref`. */
function descriptionsOf(node: unknown, out: string[]): void {
  if (Array.isArray(node)) {
    for (const item of node) descriptionsOf(item, out);
    return;
  }
  if (node === null || typeof node !== 'object') return;
  for (const [key, value] of Object.entries(node)) {
    if (key === 'description' && typeof value === 'string') out.push(value);
    else descriptionsOf(value, out);
  }
}

describe('input descriptions are neutral (GX-08)', () => {
  it('the scan itself catches the banned words', () => {
    expect(BANNED_WORDS.test('the instinct class')).toBe(true);
    expect(BANNED_WORDS.test('the keyed connection')).toBe(true);
    expect(BANNED_WORDS.test('a key item')).toBe(true);
    expect(BANNED_WORDS.test('see GX-06')).toBe(true);
    expect(BANNED_WORDS.test('a keyboard')).toBe(false);
  });

  it('no mcpToolSchemas input property description names a class, a key or a ticket', () => {
    const hits: string[] = [];
    for (const name of MCP_TOOL_NAMES) {
      const found: string[] = [];
      descriptionsOf(mcpToolSchemas[name].input, found);
      for (const text of found) if (BANNED_WORDS.test(text)) hits.push(`${name}: ${text}`);
    }
    expect(hits).toEqual([]);
  });
});
