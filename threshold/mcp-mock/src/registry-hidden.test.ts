import { MCP_TOOL_NAMES, mcpToolSchemas } from '@geldar/contract';
import { describe, expect, it } from 'vitest';
import { listTools } from './registry.ts';

const HIDDEN = ['write_book', 'define_skill', 'use_skill', 'offer', 'propose', 'vote'];

/** Every `do` verb named by a schema variant, at any depth. */
function doVerbs(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const item of node) doVerbs(item, out);
    return out;
  }
  if (node !== null && typeof node === 'object') {
    const rec = node as Record<string, unknown>;
    const doProp = (rec.properties as Record<string, { const?: unknown }> | undefined)?.do;
    if (typeof doProp?.const === 'string') out.push(doProp.const);
    for (const value of Object.values(rec)) doVerbs(value, out);
  }
  return out;
}

function actOf(list: ReturnType<typeof listTools>) {
  const act = list.find((tool) => tool.name === 'act');
  if (!act) throw new Error('act is not listed');
  return act;
}

describe('listTools with hidden tools', () => {
  it('leaves out each hidden tool by name', () => {
    const names = listTools(HIDDEN).map((tool) => tool.name);
    for (const name of HIDDEN) expect(names).not.toContain(name);
    expect(names).toContain('read_book');
    expect(names).toHaveLength(MCP_TOOL_NAMES.length - HIDDEN.length);
  });

  it('drops the hidden verbs from the act variants and keeps the others', () => {
    const verbs = doVerbs(actOf(listTools(HIDDEN)).inputSchema);
    for (const name of HIDDEN) expect(verbs).not.toContain(name);
    expect(verbs).toContain('goto');
    expect(verbs).toContain('mine');
  });

  it('keeps today’s list when nothing is hidden', () => {
    const list = listTools();
    expect(list.map((tool) => tool.name)).toEqual([...MCP_TOOL_NAMES].sort());
    const verbs = doVerbs(actOf(list).inputSchema);
    for (const name of HIDDEN) expect(verbs).toContain(name);
    expect(listTools([]).map((tool) => tool.name)).toEqual(list.map((tool) => tool.name));
  });

  it('does not change the bundled contract schema', () => {
    listTools(HIDDEN);
    expect(doVerbs(mcpToolSchemas.act.input)).toContain('offer');
  });
});
