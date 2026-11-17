import { type ToolContext, ToolError } from '@geldar/mcp-mock';
import { describe, expect, it } from 'vitest';
import { ScriptedRateLimiter } from './fakes/stores.fakes.ts';
import { worldFixture } from './fakes/world.fakes.ts';
import type { BodyGateway, PlayerRecord } from './ports.ts';
import { PLAYER_FAULT } from './resources.ts';
import { authRefusalRecorder, type SpanTracer, toolSpanRecorder } from './telemetry.ts';
import { hiddenToolsFor } from './tools/unavailable.ts';
import { createWorld, takePendingCall } from './world.ts';
import { refuseHidden, runToolCall } from './world-session.ts';

const PLAYER: PlayerRecord = {
  playerId: 'ag-ranger-01',
  lifeId: 'ag_ranger_01',
  ownerId: 'owner_01',
  displayName: 'Jason',
  harness: 'claude-code',
  status: 'active',
  declaredModel: null,
};

interface FakeSpan {
  name: string;
  attributes: Record<string, unknown>;
  events: { name: string; attributes: Record<string, unknown> }[];
  status?: { code: number };
  ended: boolean;
}

/** A tracer that keeps every span and event in memory, with no SDK behind it. */
function fakeTracer(): { tracer: SpanTracer; spans: FakeSpan[] } {
  const spans: FakeSpan[] = [];
  const tracer: SpanTracer = {
    startSpan(name) {
      const span: FakeSpan = { name, attributes: {}, events: [], ended: false };
      spans.push(span);
      return {
        setAttributes: (attributes) => Object.assign(span.attributes, attributes),
        addEvent: (eventName, attributes) => {
          span.events.push({ name: eventName, attributes: { ...attributes } });
        },
        setStatus: (status) => {
          span.status = status;
        },
        end: () => {
          span.ended = true;
        },
      };
    },
  };
  return { tracer, spans };
}

function ctx(): ToolContext {
  return { playerId: PLAYER.playerId, signal: new AbortController().signal };
}

function fixture(body?: BodyGateway, limiter?: ScriptedRateLimiter) {
  const fx = worldFixture([PLAYER]);
  fx.budget.seed(PLAYER.lifeId, 37, 0);
  const deps = { ...fx.deps, ...(body ? { body } : {}), ...(limiter ? { limiter } : {}) };
  return { fx, tools: createWorld(deps).tools };
}

/** A world whose Body throws `error` on every method, so `look` fails with it. */
function failingLook(error: unknown) {
  const body = new Proxy({} as BodyGateway, {
    get: () => async () => {
      throw error;
    },
  });
  return fixture(body).tools;
}

function eventNames(span: FakeSpan | undefined): string[] {
  return (span?.events ?? []).map((event) => event.name.replace('geldar.content.', ''));
}

function eventText(span: FakeSpan | undefined, name: string): string {
  const event = span?.events.find((item) => item.name === `geldar.content.${name}`);
  return String(event?.attributes[`geldar.content.${name}`] ?? '');
}

function recorded(tools: ReturnType<typeof fixture>['tools'], extra: object = {}) {
  const { tracer, spans } = fakeTracer();
  return { deps: { tools, onToolSpan: toolSpanRecorder(tracer), ...extra }, spans };
}

describe('every call ends in one span (T-06d2)', () => {
  it('(a) a handler ToolError gives one span with the code and the full message', async () => {
    const { deps, spans } = recorded(failingLook(new ToolError('rate_limited', 'Slow down now.')));
    await runToolCall(deps, 'look', {}, ctx());
    expect(spans).toHaveLength(1);
    expect(spans[0]?.attributes.outcome).toBe('rate_limited');
    expect(spans[0]?.status).toEqual({ code: 2 });
    expect(eventText(spans[0], 'tool_error')).toContain('Slow down now.');
    // Only the handler's own stored error carries these; the response-text fallback has neither.
    expect(eventText(spans[0], 'tool_error')).toContain('exception.stacktrace');
    expect(eventText(spans[0], 'tool_error')).toContain('"exception.type":"Error"');
  });

  it('(a2) a throw out of callTool records the real error and the text the SDK sends', async () => {
    const token = `gmcp-${'cd'.repeat(32)}`;
    const failure = new TypeError(`validator broke ${token}`);
    const log = (): never => {
      throw failure;
    };
    const { deps, spans } = recorded(fixture().tools, { log });
    // An unknown tool reaches the logger inside callTool, outside its handler try: the one way it throws.
    await expect(runToolCall(deps, 'nope', {}, ctx())).rejects.toBe(failure);
    expect(spans).toHaveLength(1);
    expect(spans[0]?.attributes.outcome).toBe('internal');
    const stored = eventText(spans[0], 'tool_error');
    expect(stored).toContain('"exception.type":"TypeError"');
    expect(stored).toContain('validator broke');
    expect(stored).toContain('exception.stacktrace');
    expect(stored).not.toContain(token);
    // What the agent receives is the SDK's JSON-RPC error message: the thrown message, not an invented text.
    const response = eventText(spans[0], 'tool_response');
    expect(response).toContain('validator broke');
    expect(response).not.toContain('internal_error');
    expect(response).not.toContain(token);
  });

  it('(a3) a thrown value with no message is sent as Internal error', async () => {
    const log = (): never => {
      throw 'plain';
    };
    const { deps, spans } = recorded(fixture().tools, { log });
    await expect(runToolCall(deps, 'nope', {}, ctx())).rejects.toBe('plain');
    expect(eventText(spans[0], 'tool_response')).toBe('Internal error');
    expect(eventText(spans[0], 'tool_error')).toContain('plain');
  });

  it('(k) a 60,000-character unknown tool name and say text add under 100 ms of capture', async () => {
    const run = async (recorder: boolean): Promise<number> => {
      const tools = fixture().tools;
      const deps = recorder ? recorded(tools).deps : { tools };
      const t0 = performance.now();
      await runToolCall(deps, 'a'.repeat(60_000), { x: 'a'.repeat(60_000) }, ctx());
      await runToolCall(deps, 'say', { text: 'a'.repeat(60_000) }, ctx());
      return performance.now() - t0;
    };
    await run(true);
    const off = await run(false);
    const on = await run(true);
    console.info(`capture timing: on ${on.toFixed(1)} ms, off ${off.toFixed(1)} ms`);
    expect(on - off).toBeLessThan(100);
  });

  it('(b) an unknown tool name gives one span with the raw arguments and an error', async () => {
    const { deps, spans } = recorded(fixture().tools);
    const response = await runToolCall(deps, 'no_such_tool', { x: 1 }, ctx());
    expect(response.isError).toBe(true);
    expect(spans).toHaveLength(1);
    expect(spans[0]?.attributes).toMatchObject({
      outcome: 'unknown_tool',
      'gen_ai.tool.name': 'other',
    });
    expect(eventText(spans[0], 'tool_arguments')).toBe('{"x":1}');
    expect(eventText(spans[0], 'tool_error')).toContain('unknown_tool: no_such_tool');
  });

  it('(c) invalid input and a hidden tool give one span each, with the arguments', async () => {
    const { deps, spans } = recorded(fixture().tools);
    await runToolCall(deps, 'look', { bogus: true }, ctx());
    refuseHidden(deps, 'write_book', { title: 'x' }, hiddenToolsFor(false));
    expect(spans.map((span) => span.attributes.outcome)).toEqual([
      'invalid_input',
      'not_available',
    ]);
    expect(eventText(spans[0], 'tool_arguments')).toBe('{"bogus":true}');
    expect(eventText(spans[1], 'tool_arguments')).toBe('{"title":"x"}');
    expect(eventNames(spans[1])).toContain('tool_error');
  });

  it('(d) a result cut by the size cap keeps the raw result and shows the response, in order', async () => {
    const { deps, spans } = recorded(fixture().tools, { maxResultBytes: 10 });
    await runToolCall(deps, 'look', {}, ctx());
    expect(spans[0]?.attributes.outcome).toBe('result_too_large');
    expect(eventNames(spans[0])).toEqual([
      'tool_arguments',
      'tool_result',
      'tool_error',
      'tool_response',
    ]);
    expect(eventText(spans[0], 'tool_response')).toBe('result_too_large: look');
    expect(eventText(spans[0], 'tool_result').length).toBeGreaterThan(10);
  });

  it('(d) invalid output is its own outcome', async () => {
    const { tools } = fixture();
    const broken = { ...tools, look: async () => ({ not: 'a snapshot' }) };
    const { deps, spans } = recorded(broken);
    await runToolCall(deps, 'look', {}, ctx());
    expect(spans[0]?.attributes.outcome).toBe('invalid_output');
    expect(eventText(spans[0], 'tool_response')).toBe('invalid_output: look');
  });

  it('(e) a non-ToolError with a token in its message is internal and redacted, the agent text unchanged', async () => {
    const token = `gmcp-${'ab'.repeat(32)}`;
    const { deps, spans } = recorded(failingLook(new Error(`boom ${token}`)));
    const response = await runToolCall(deps, 'look', {}, ctx());
    expect(response.content[0]).toMatchObject({ text: `internal_error: ${PLAYER_FAULT}` });
    expect(spans[0]?.attributes.outcome).toBe('internal');
    const stored = eventText(spans[0], 'tool_error');
    expect(stored).toContain('[redacted]');
    expect(stored).not.toContain(token);
  });

  it('(f) a result with a secret-named key and a bearer string is redacted in the event', async () => {
    const bearer = ['Bearer', ['abc', 'def', '123'].join('')].join(' ');
    const apiKey = ['api', 'key'].join('_');
    const { tracer, spans } = fakeTracer();
    const record = toolSpanRecorder(tracer);
    const result = { [apiKey]: 'k-1', note: bearer };
    record({
      tool: 'look',
      outcome: 'ok',
      durationMs: 1,
      content: { name: 'look', arguments: {}, result },
    });
    const text = eventText(spans[0], 'tool_result');
    expect(text).not.toContain('k-1');
    expect(text).not.toContain('abcdef123');
    expect(text).toContain('[redacted]');
  });

  it('(g) the bytes the agent gets are the same with the recorder on and off', async () => {
    const cases: [string, unknown][] = [
      ['look', {}],
      ['no_such_tool', {}],
    ];
    for (const [name, args] of cases) {
      const off = await runToolCall({ tools: fixture().tools }, name, args, ctx());
      const on = await runToolCall(recorded(fixture().tools).deps, name, args, ctx());
      expect(JSON.stringify(on)).toBe(JSON.stringify(off));
    }
    const failing = async (spanned: boolean) => {
      const tools = failingLook(new ToolError('rate_limited', 'Slow down.'));
      return JSON.stringify(
        await runToolCall(spanned ? recorded(tools).deps : { tools }, 'look', {}, ctx()),
      );
    };
    expect(await failing(true)).toBe(await failing(false));
    const hidden = hiddenToolsFor(false);
    const deps = recorded(fixture().tools).deps;
    expect(JSON.stringify(refuseHidden(deps, 'write_book', {}, hidden))).toBe(
      JSON.stringify(refuseHidden({}, 'write_book', {}, hidden)),
    );
  });

  it('(h) a tracer that throws never changes the response or escapes', async () => {
    const boom = (): never => {
      throw new Error('tracer down');
    };
    const tools = failingLook(new ToolError('rate_limited', 'Slow down.'));
    const noStart = { tools, onToolSpan: toolSpanRecorder({ startSpan: boom }) };
    const plain = await runToolCall({ tools }, 'look', {}, ctx());
    expect(await runToolCall(noStart, 'look', {}, ctx())).toEqual(plain);
    const { tracer } = fakeTracer();
    const eventBoom: SpanTracer = {
      startSpan: (name) => ({ ...tracer.startSpan(name), addEvent: boom }),
    };
    const noEvent = { tools, onToolSpan: toolSpanRecorder(eventBoom) };
    expect(await runToolCall(noEvent, 'look', {}, ctx())).toEqual(plain);
  });

  it('(i) an auth refusal span carries the reason (the status is dropped by the allow-list until its key lands), never a token or header', () => {
    const { tracer, spans } = fakeTracer();
    authRefusalRecorder(tracer)({ reason: 'token_shape', status: 401 });
    expect(spans).toHaveLength(1);
    expect(spans[0]?.name).toBe('mcp.auth_refused');
    // Today the span carries the outcome only: http.response.status_code is filtered out.
    expect(spans[0]?.attributes).toEqual({ outcome: 'token_shape' });
    expect(spans[0]?.ended).toBe(true);
    expect(JSON.stringify(spans[0])).not.toMatch(/gmcp-|Bearer|authorization/i);
  });

  it('(j) calls past the rate limit give rate_limited spans', async () => {
    const denied = { allowed: false, retryAfterMs: 1000 };
    const { tools } = fixture(undefined, new ScriptedRateLimiter([denied, denied, denied]));
    const { deps, spans } = recorded(tools);
    for (let i = 0; i < 3; i += 1) await runToolCall(deps, 'journal', { text: 'Dusk.' }, ctx());
    expect(spans.map((span) => span.attributes.outcome)).toEqual([
      'rate_limited',
      'rate_limited',
      'rate_limited',
    ]);
  });

  it('a wrong key finds no pending call', async () => {
    const used = ctx();
    await fixture().tools.look({}, used);
    expect(takePendingCall(ctx())).toBeUndefined();
    expect(takePendingCall(used)?.handlerOutcome).toBe('ok');
    expect(takePendingCall(used)).toBeUndefined();
  });
});
