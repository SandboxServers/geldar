import { describe, expect, it } from 'vitest';
import { buildMcpTools, loadSchemas } from '../scripts/generator.ts';
import { validateViewInput, validateViewResult } from '../src/generated/validators.js';
import { viewSubject } from '../src/subjects.ts';

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

  it('names the view subject on the life, with five tokens', () => {
    expect(viewSubject('phase0', 'ag_jason_01')).toBe('geldar.phase0.body.ag_jason_01.view');
    expect(() => viewSubject('phase0.*', 'ag_jason_01')).toThrow();
    expect(() => viewSubject('phase0', 'ag_jason_01.>')).toThrow();
  });

  it('is in the tool list', async () => {
    const tools = buildMcpTools(await loadSchemas());
    expect(tools).toContain("'view'");
  });
});
