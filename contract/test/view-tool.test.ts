import { describe, expect, it } from 'vitest';
import { buildMcpTools, loadSchemas } from '../scripts/generator.ts';
import { validateViewInput, validateViewResult } from '../src/generated/validators.js';

describe('view tool schema', () => {
  it('accepts no arguments, and optional cols and rows in range', () => {
    expect(validateViewInput({})).toBe(true);
    expect(validateViewInput({ cols: 21, rows: 9 })).toBe(true);
    expect(validateViewInput({ cols: 21 })).toBe(true);
    expect(validateViewInput({ rows: 1 })).toBe(true);
  });

  it('rejects an extra property, a non-integer, and an out-of-range size', () => {
    expect(validateViewInput({ cols: 21, reach: 1 })).toBe(false);
    expect(validateViewInput({ x: 0 })).toBe(false);
    expect(validateViewInput({ cols: 21.5 })).toBe(false);
    expect(validateViewInput({ cols: 0 })).toBe(false);
    expect(validateViewInput({ cols: 42 })).toBe(false);
    expect(validateViewInput({ rows: 16 })).toBe(false);
  });

  it('accepts a result with text and rejects a result with an extra key', () => {
    expect(validateViewResult({ text: 'Facing north.' })).toBe(true);
    expect(validateViewResult({ text: 'x', grid: [] })).toBe(false);
    expect(validateViewResult({})).toBe(false);
  });

  it('is not in the tool list until the wiring lands', async () => {
    const tools = buildMcpTools(await loadSchemas());
    expect(tools).not.toContain("'view'");
  });
});
