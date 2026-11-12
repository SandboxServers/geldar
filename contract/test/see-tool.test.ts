import { describe, expect, it } from 'vitest';
import { MCP_TOOL_NAMES, validateToolInput, validateToolResult } from '../src/index.ts';

const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==';

describe('see: the picture tool (decision 0156, VP-3)', () => {
  it('is one of the exposed tools', () => {
    expect(MCP_TOOL_NAMES).toContain('see');
  });

  it('takes no arguments, or an optional width and height', () => {
    expect(validateToolInput('see', {}).ok).toBe(true);
    expect(validateToolInput('see', { width: 320, height: 180 }).ok).toBe(true);
    expect(validateToolInput('see', { width: 1000 }).ok).toBe(true);
  });

  it('rejects extra properties and non-integer sizes', () => {
    expect(validateToolInput('see', { observer: true }).ok).toBe(false);
    expect(validateToolInput('see', { width: 'wide' }).ok).toBe(false);
    expect(validateToolInput('see', { height: 1.5 }).ok).toBe(false);
    expect(validateToolInput('see', { width: 0 }).ok).toBe(false);
  });

  it('accepts a picture with its caption and rejects extra or missing fields', () => {
    expect(validateToolResult('see', { png: PNG, caption: 'what you see' }).ok).toBe(true);
    expect(validateToolResult('see', { png: PNG }).ok).toBe(false);
    expect(validateToolResult('see', { png: PNG, caption: 'x', extra: 1 }).ok).toBe(false);
  });
});
