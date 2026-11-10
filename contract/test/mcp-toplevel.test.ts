/**
 * MCP clients drop a tool whose inputSchema has oneOf, anyOf or allOf at its top level, so every
 * served input must be a plain object. The either/or rules of act and write_book are checked by
 * validateToolInput, and the served schemas carry the rest of their shape.
 */
import ajv2020Module from 'ajv/dist/2020.js';
import ajvFormatsModule from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import { MCP_TOOL_NAMES, mcpToolSchemas, validateToolInput } from '../src/index.ts';

const Ajv2020 = ajv2020Module.default;
const addFormats = ajvFormatsModule.default;

const COMBINATORS = ['oneOf', 'anyOf', 'allOf'] as const;

/** A served schema, compiled the way a client would compile it: strict, with formats. */
function served(tool: 'act' | 'write_book') {
  const ajv = new Ajv2020({ strict: true });
  addFormats(ajv);
  return ajv.compile(mcpToolSchemas[tool].input);
}

describe('the served tool input schemas', () => {
  it('has no oneOf, anyOf or allOf at the top level of any tool', () => {
    const offenders = MCP_TOOL_NAMES.flatMap((tool) =>
      COMBINATORS.filter((key) => key in mcpToolSchemas[tool].input).map(
        (key) => `${tool}: ${key}`,
      ),
    );
    expect(offenders).toEqual([]);
  });

  it('has type object at the top level of every tool', () => {
    for (const tool of MCP_TOOL_NAMES) {
      expect(mcpToolSchemas[tool].input.type, tool).toBe('object');
    }
  });

  it('serves act as a plain object that accepts a valid example and rejects an unknown field', () => {
    const check = served('act');
    expect(check({ reasoning: 'x', say: 'hello' })).toBe(true);
    expect(check({ reasoning: 'x', say: 'hello', mood: 'happy' })).toBe(false);
    expect(validateToolInput('act', { say: 'hello' }).ok).toBe(true);
    expect(validateToolInput('act', { reasoning: 'x' }).ok).toBe(false);
  });

  it('serves write_book as a plain object that accepts a valid example and rejects an unknown field', () => {
    const check = served('write_book');
    expect(check({ title: 'T', text: 'hello' })).toBe(true);
    expect(check({ title: 'T', text: 'hello', mood: 'happy' })).toBe(false);
    expect(validateToolInput('write_book', { title: 'T', text: 'hello' }).ok).toBe(true);
    expect(validateToolInput('write_book', { title: 'T', skill_id: 'sk_1' }).ok).toBe(true);
    expect(validateToolInput('write_book', { title: 'T' }).ok).toBe(false);
    expect(validateToolInput('write_book', { title: 'T', skill_id: 'sk_1', text: 'hi' }).ok).toBe(
      false,
    );
  });
});
