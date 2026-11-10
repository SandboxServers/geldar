import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { markedWords, mcpToolSchemas } from '../src/index.ts';

/** The schema files whose text an agent reads through the MCP tool list and its results. */
const AGENT_SCHEMAS = ['mcp-world', 'mcp-play', 'mcp-common', 'common'];

/** Every string under a `description` or `const` key, with the path to it, in a JSON value. */
function agentTexts(
  value: unknown,
  path: string,
  out: [string, string][] = [],
): [string, string][] {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      agentTexts(item, `${path}[${index}]`, out);
    }
  } else if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if ((key === 'description' || key === 'const') && typeof child === 'string') {
        out.push([`${path}.${key}`, child]);
      } else {
        agentTexts(child, `${path}.${key}`, out);
      }
    }
  }
  return out;
}

function schemaTexts(name: string): [string, string][] {
  const url = new URL(`../schemas/${name}.schema.json`, import.meta.url);
  return agentTexts(JSON.parse(readFileSync(url, 'utf8')), name);
}

describe('agent-visible contract text', () => {
  it('the tool list reads with no observer, harness or out-of-world marker', () => {
    const found = agentTexts(mcpToolSchemas, 'mcpToolSchemas').flatMap(([path, text]) =>
      markedWords(text).map((word) => `${path}: ${word}`),
    );
    expect(found).toEqual([]);
  });

  for (const name of AGENT_SCHEMAS) {
    it(`${name}.schema.json descriptions read with no marker`, () => {
      const found = schemaTexts(name).flatMap(([path, text]) =>
        markedWords(text).map((word) => `${path}: ${word}`),
      );
      expect(found).toEqual([]);
    });
  }

  it('the scan finds a marker in tool-list text (the scan itself works)', () => {
    const texts = agentTexts({ description: 'Append to the colo mirror of the observers' }, 'x');
    expect(texts.flatMap(([, text]) => markedWords(text))).toEqual(['colo', 'observers']);
  });

  it('act keeps its description within 300 characters', () => {
    expect(mcpToolSchemas.act.description.length).toBeLessThanOrEqual(300);
  });
});
