import { MCP_TOOL_NAMES, type McpToolName, mcpToolSchemas } from '@geldar/contract';
import { describe, expect, it } from 'vitest';
import { createFakeHandlers } from './fake-world.ts';
import {
  callTool,
  listTools,
  type ToolContext,
  ToolError,
  type ToolHandler,
  type ToolHandlers,
} from './registry.ts';

const ctx: ToolContext = { playerId: 'a', signal: new AbortController().signal };

const inputs: Record<McpToolName, unknown> = {
  look: {},
  wait: { max_seconds: 5 },
  act: { say: 'hello' },
  say: { text: 'hello' },
  read_book: {},
  write_book: { title: 'T', text: 'body' },
  define_skill: { name: 'chop', description: 'chops', code: 'return 1;' },
  use_skill: { name: 'chop', args: {} },
  offer: { item: 'bread', count: 1 },
  propose: { rule: 'r', value: 1, reason: 'why' },
  vote: { proposal_id: 'pr_1', vote: 'yes' },
  sleep: {},
  journal: { text: 'a line' },
  status: {},
};

function with1(name: McpToolName, handler: ToolHandler): ToolHandlers {
  return { ...createFakeHandlers(), [name]: handler };
}

describe('listTools', () => {
  it('lists every tool with its bundled input schema', () => {
    const tools = listTools();
    expect(tools.map((t) => t.name)).toEqual([...MCP_TOOL_NAMES].sort());
    for (const t of tools) {
      expect(t.description.length).toBeGreaterThan(0);
      expect(t.inputSchema).toEqual(mcpToolSchemas[t.name as McpToolName].input);
      expect(t.inputSchema.type, t.name).toBe('object');
    }
  });

  it('returns copies, so a caller mutating a schema changes nothing else', () => {
    const before = structuredClone(mcpToolSchemas.say.input);
    const first = listTools().find((t) => t.name === 'say');
    expect(first).toBeDefined();
    if (first === undefined) return;
    first.inputSchema.type = 'mutated';
    first.inputSchema.extra = true;
    const second = listTools().find((t) => t.name === 'say');
    expect(second?.inputSchema).toEqual(before);
    expect(mcpToolSchemas.say.input).toEqual(before);
  });
});

describe('callTool', () => {
  it('runs every tool against the fake world', async () => {
    const handlers = createFakeHandlers();
    for (const name of MCP_TOOL_NAMES) {
      const res = await callTool(handlers, name, inputs[name], ctx);
      expect(res.isError, `${name}: ${res.content[0]?.text}`).toBeUndefined();
      expect(() => JSON.parse(res.content[0]?.text ?? '')).not.toThrow();
    }
  });

  it('returns the journal under the lowercase title from sleep', async () => {
    const res = await callTool(createFakeHandlers(), 'sleep', {}, ctx);
    const body = JSON.parse(res.content[0]?.text ?? '') as {
      untrusted_world_text: { book: { title: string } };
    };
    expect(body.untrusted_world_text.book.title).toBe('journal');
  });

  it('treats missing arguments as an empty object', async () => {
    for (const name of ['look', 'sleep', 'status', 'read_book'] as const) {
      const res = await callTool(createFakeHandlers(), name, undefined, ctx);
      expect(res.isError, name).toBeUndefined();
    }
  });

  it('rejects invalid input and unknown tools', async () => {
    const bad = await callTool(createFakeHandlers(), 'wait', { max_seconds: 1 }, ctx);
    expect(bad.isError).toBe(true);
    expect(bad.content[0]?.text.startsWith('invalid_input:')).toBe(true);
    const unknown = await callTool(createFakeHandlers(), 'dance', {}, ctx);
    expect(unknown.isError).toBe(true);
    expect(unknown.content[0]?.text).toBe('unknown_tool: dance');
  });

  it('truncates a long invalid_input message to 600 characters', async () => {
    const res = await callTool(
      createFakeHandlers(),
      'act',
      { reasoning: 'r'.repeat(5000), actions: Array.from({ length: 60 }, () => ({ bogus: 1 })) },
      ctx,
    );
    expect(res.isError).toBe(true);
    const text = res.content[0]?.text ?? '';
    expect(text.startsWith('invalid_input:')).toBe(true);
    expect(text.length).toBeLessThanOrEqual(600);
  });

  it('shows a ToolError but hides any other fault', async () => {
    const shown = await callTool(
      with1('read_book', () => {
        throw new ToolError('no_book', 'You hold no book.');
      }),
      'read_book',
      {},
      ctx,
    );
    expect(shown).toEqual({
      isError: true,
      content: [{ type: 'text', text: 'no_book: You hold no book.' }],
    });
    const logged: string[] = [];
    const hidden = await callTool(
      with1('look', () => {
        throw new Error('secret path /x');
      }),
      'look',
      {},
      ctx,
      (m) => logged.push(m),
    );
    expect(hidden.content[0]?.text.startsWith('internal_error:')).toBe(true);
    expect(hidden.content[0]?.text).not.toContain('secret path');
    expect(logged.join('\n')).toContain('secret path');
  });

  it('flags an invalid result loudly', async () => {
    const logged: string[] = [];
    const res = await callTool(
      with1('say', () => ({ spoken: 'yes' })),
      'say',
      { text: 'hi' },
      ctx,
      (m) => logged.push(m),
    );
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text.startsWith('invalid_output:')).toBe(true);
    expect(logged.length).toBe(1);
    expect(logged[0]).toContain('invalid_output');
  });

  it('logs internal_error faults, unknown tools and oversized results', async () => {
    const logged: string[] = [];
    const log = (m: string) => logged.push(m);
    await callTool(
      with1('look', () => {
        throw new Error('boom');
      }),
      'look',
      {},
      ctx,
      log,
    );
    expect(logged[0]).toContain('look');
    expect(logged[0]).toContain('boom');
    await callTool(createFakeHandlers(), 'dance', {}, ctx, log);
    expect(logged[1]).toContain('unknown_tool');
    await callTool(createFakeHandlers(), `bad\n${'x'.repeat(5000)}`, {}, ctx, log);
    expect(logged[2]).not.toContain('\n');
    expect(logged[2]?.length).toBeLessThan(120);
    const base = (await createFakeHandlers().wait({}, ctx)) as Record<string, unknown>;
    const events = Array.from({ length: 100 }, (_, i) => ({
      seq: i + 1,
      type: 'reflex',
      tick: i,
      text: 'x'.repeat(200),
    }));
    await callTool(
      with1('wait', () => ({ ...base, events })),
      'wait',
      { max_seconds: 5 },
      ctx,
      log,
    );
    expect(logged[3]).toContain('result_too_large');
    expect(logged.length).toBe(4);
  });

  it('passes the validated input and the context to the handler', async () => {
    let seen: { input: unknown; ctx: ToolContext } | undefined;
    await callTool(
      with1('say', (input, c) => {
        seen = { input, ctx: c };
        return { spoken: true, budget_remaining_thoughts: 1 };
      }),
      'say',
      { text: 'hi' },
      ctx,
    );
    expect(seen?.ctx).toBe(ctx);
    expect(seen?.input).toEqual({ text: 'hi' });
  });

  it('gives each look and wait a different snapshot id, in a fixed order', async () => {
    const id = async (h: ToolHandlers, name: 'look' | 'wait') => {
      const res = await callTool(h, name, name === 'wait' ? { max_seconds: 5 } : {}, ctx);
      return (JSON.parse(res.content[0]?.text ?? '') as { snapshot: { snapshot_id: string } })
        .snapshot.snapshot_id;
    };
    const h = createFakeHandlers();
    const a = await id(h, 'look');
    const b = await id(h, 'wait');
    expect(a).not.toBe(b);
    const h2 = createFakeHandlers();
    expect(await id(h2, 'look')).toBe(a);
    expect(await id(h2, 'wait')).toBe(b);
  });

  it('caps the result size', async () => {
    const waitWith = async (n: number) => {
      const base = (await createFakeHandlers().wait({}, ctx)) as Record<string, unknown>;
      const events = Array.from({ length: n }, (_, i) => ({
        seq: i + 1,
        type: 'reflex',
        tick: i,
        text: 'x'.repeat(200),
      }));
      return callTool(
        with1('wait', () => ({ ...base, events })),
        'wait',
        { max_seconds: 5 },
        ctx,
      );
    };
    const big = await waitWith(100);
    expect(big.isError).toBe(true);
    expect(big.content[0]?.text.startsWith('result_too_large:')).toBe(true);
    const ok = await waitWith(40);
    expect(ok.isError, ok.content[0]?.text).toBeUndefined();
  });
});
