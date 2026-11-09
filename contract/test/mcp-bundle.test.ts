import ajv2020Module from 'ajv/dist/2020.js';
import ajvFormatsModule from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import { bundleDefinition, type LoadedSchema, loadSchemas } from '../scripts/generator.ts';
import {
  MCP_TOOL_NAMES,
  mcpToolSchemas,
  validateToolInput,
  validateToolResult,
} from '../src/index.ts';

const Ajv2020 = ajv2020Module.default;
const addFormats = ajvFormatsModule.default;

const bundles = Object.entries(mcpToolSchemas).flatMap(([tool, entry]) => [
  { name: `${tool} input`, tool, kind: 'input' as const, schema: entry.input },
  { name: `${tool} result`, tool, kind: 'result' as const, schema: entry.result },
]);

/** Keys whose value is a map of names to schemas: the names are not keywords. */
const NAME_MAPS = new Set(['properties', '$defs']);

/** Calls `visit` for each keyword key of a schema, descending into sub-schemas but not into name maps' keys. */
function walk(
  node: unknown,
  visit: (key: string, value: unknown, isDefinitionRoot: boolean) => void,
  isDefinitionRoot = false,
): void {
  if (Array.isArray(node)) {
    for (const item of node) walk(item, visit);
    return;
  }
  if (typeof node !== 'object' || node === null) return;
  for (const [key, value] of Object.entries(node)) {
    visit(key, value, isDefinitionRoot);
    if (NAME_MAPS.has(key) && typeof value === 'object' && value !== null) {
      for (const sub of Object.values(value)) walk(sub, visit, key === '$defs');
    } else {
      walk(value, visit);
    }
  }
}

describe('bundled tool schemas', () => {
  it('rewrites every $ref locally and strips $id, $comment and root titles', () => {
    for (const { name, schema } of bundles) {
      walk(
        schema,
        (key, value, isDefinitionRoot) => {
          if (key === '$ref') expect(String(value), name).toMatch(/^#\/\$defs\//);
          expect(key, name).not.toBe('$id');
          expect(key, name).not.toBe('$comment');
          if (isDefinitionRoot) expect(key, name).not.toBe('title');
        },
        true,
      );
    }
    const text = (mcpToolSchemas.look.result.$defs as Record<string, unknown>)
      .UntrustedWorldText as { properties: { book: { properties: { title?: unknown } } } };
    expect(text.properties.book.properties.title).toBeDefined();
  });

  it('compiles each bundle in a fresh strict Ajv with nothing else added', () => {
    for (const { name, schema } of bundles) {
      const ajv = new Ajv2020({ strict: true });
      addFormats(ajv);
      expect(() => ajv.compile(schema), name).not.toThrow();
    }
  });

  it('agrees with the generated validators', () => {
    const cases: [string, 'input' | 'result', unknown][] = [
      ['act', 'input', { say: 'hello', actions: [{ do: 'eat' }] }],
      ['act', 'input', { say: 'hello', actions: [{ do: 'fly' }] }],
      ['wait', 'input', { max_seconds: 30, cursor: 'c_3' }],
      ['wait', 'input', { max_seconds: 300 }],
    ];
    for (const [tool, kind, value] of cases) {
      const ajv = new Ajv2020({ strict: true });
      addFormats(ajv);
      const bundle = mcpToolSchemas[tool as keyof typeof mcpToolSchemas][kind];
      const fresh = ajv.compile(bundle)(value);
      const generated = (kind === 'input' ? validateToolInput : validateToolResult)(tool, value).ok;
      expect(fresh, tool).toBe(generated);
    }
    expect(validateToolInput('act', { say: 'hello' }).ok).toBe(true);
    expect(validateToolInput('wait', { max_seconds: 300 }).ok).toBe(false);
  });

  it('bundles the definitions act reaches from the thought and common schemas', () => {
    const defs = Object.keys(mcpToolSchemas.act.input.$defs as object);
    expect(defs).toEqual(expect.arrayContaining(['Intent', 'Action', 'Position']));
  });

  it('lists the tools', () => {
    expect([...MCP_TOOL_NAMES]).toEqual(['act', 'look', 'say', 'wait']);
  });

  it('throws when a definition refs a missing name', async () => {
    const schemas: LoadedSchema[] = [
      {
        name: 'x',
        schema: {
          $id: 'https://geldar.dev/schemas/x.schema.json',
          $defs: { Broken: { $ref: '#/$defs/Missing' } },
        },
      },
    ];
    expect(() => bundleDefinition(schemas, 'x', 'Broken')).toThrow(/missing/);
    const real = await loadSchemas();
    expect(() => bundleDefinition(real, 'mcp-play', 'ActInput')).not.toThrow();
  });
});
