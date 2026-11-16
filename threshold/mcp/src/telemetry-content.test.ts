import { ImageToolResult, type ToolContext } from '@geldar/mcp-mock';
import { CONTENT_CAP_BYTES, startTelemetry, type TelemetryHandle } from '@geldar/telemetry';
import { afterEach, describe, expect, it } from 'vitest';
import { worldFixture } from './fakes/world.fakes.ts';
import type { PlayerRecord } from './ports.ts';
import {
  REDACTED,
  redactArguments,
  type SpanTracer,
  TOOL_ARGUMENTS_EVENT,
  TOOL_RESULT_EVENT,
  type ToolCallSpan,
  toolSpanRecorder,
} from './telemetry.ts';
import { createWorld } from './world.ts';
import { runToolCall } from './world-session.ts';

const PLAYER: PlayerRecord = {
  playerId: 'ag-ranger-01',
  lifeId: 'ag_ranger_01',
  ownerId: 'owner_01',
  displayName: 'Jason',
  harness: 'claude-code',
  status: 'active',
  declaredModel: null,
};

interface ExportedSpan {
  name: string;
  attributes: Record<string, unknown>;
  events: { name: string; attributes: Record<string, unknown> }[];
  traceId: string;
  spanId: string;
}

interface SourceSpan {
  name: string;
  attributes: Record<string, unknown>;
  events: { name: string; attributes?: Record<string, unknown> }[];
  spanContext(): { traceId: string; spanId: string };
}

const noop = {
  export: (_batch: unknown, done: (result: { code: number }) => void) => done({ code: 0 }),
  forceFlush: async () => {},
  shutdown: async () => {},
};

const handles: TelemetryHandle[] = [];

afterEach(async () => {
  for (const handle of handles.splice(0)) await handle.shutdown();
});

/** Starts the SDK with an endpoint and an in-memory trace exporter, so no network call is possible. */
function startWithMemory() {
  const spans: ExportedSpan[] = [];
  const traces = {
    export(batch: readonly SourceSpan[], done: (result: { code: number }) => void) {
      for (const span of batch) {
        spans.push({
          name: span.name,
          attributes: { ...span.attributes },
          events: span.events.map((event) => ({
            name: event.name,
            attributes: { ...event.attributes },
          })),
          traceId: span.spanContext().traceId,
          spanId: span.spanContext().spanId,
        });
      }
      done({ code: 0 });
    },
    shutdown: async () => {},
  };
  const handle = startTelemetry({
    service: 'geldar-mcp',
    version: 'test',
    endpoint: 'http://127.0.0.1:4318',
    instanceId: 'test-instance',
    exporters: { traces: traces as never, logs: noop as never, metrics: noop as never },
  });
  handles.push(handle);
  const provider = handle.tracerProvider;
  if (!provider) throw new Error('telemetry should be on when the endpoint is set');
  return { recorder: toolSpanRecorder(provider.getTracer('geldar-mcp')), provider, spans };
}

function ctx(): ToolContext {
  return { playerId: PLAYER.playerId, signal: new AbortController().signal };
}

/** The MCP tools for one player, with the budget seeded so `look` succeeds. */
function worldTools() {
  const fx = worldFixture([PLAYER]);
  fx.budget.seed(PLAYER.lifeId, 37, 0);
  return createWorld(fx.deps).tools;
}

/** One call through the session seam, where the call's span ends; the response is what the agent gets. */
function call(
  tools: ReturnType<typeof worldTools>,
  recorder: ((call: ToolCallSpan) => void) | undefined,
  name: string,
  input: unknown = {},
) {
  return runToolCall({ tools, onToolSpan: recorder }, name, input, ctx());
}

function textOf(response: { content: { type: string; text?: string }[] }): string {
  return response.content[0]?.text ?? '';
}

function eventText(span: ExportedSpan, name: string): unknown {
  const event = span.events.find((item) => item.name === `geldar.content.${name}`);
  return event?.attributes[`geldar.content.${name}`];
}

describe('tool content as span events (T-06c)', () => {
  it('captures a call arguments and its result as span events', async () => {
    const { recorder, provider, spans } = startWithMemory();
    const tools = worldTools();

    const result = textOf(await call(tools, recorder, 'look'));
    await provider.forceFlush();

    expect(spans).toHaveLength(1);
    expect(eventText(spans[0] as ExportedSpan, TOOL_ARGUMENTS_EVENT)).toBe('{}');
    expect(eventText(spans[0] as ExportedSpan, TOOL_RESULT_EVENT)).toBe(result);
  });

  it('carries a result under the cap whole, with no truncation mark', async () => {
    const { recorder, provider, spans } = startWithMemory();
    recorder({
      tool: 'look',
      outcome: 'ok',
      durationMs: 1,
      content: { name: 'look', arguments: {}, result: 'short' },
    });
    await provider.forceFlush();

    const span = spans[0] as ExportedSpan;
    expect(eventText(span, TOOL_RESULT_EVENT)).toBe('"short"');
    const key = `geldar.content.${TOOL_RESULT_EVENT}.truncated`;
    const event = span.events.find((item) => item.name === `geldar.content.${TOOL_RESULT_EVENT}`);
    expect(event?.attributes[key]).toBe(false);
  });

  it('captures a picture result as its caption and base64 length, never the base64 itself', async () => {
    const { recorder, provider, spans } = startWithMemory();
    const png = 'A'.repeat(300_000);
    recorder({
      tool: 'see',
      outcome: 'ok',
      durationMs: 1,
      content: { name: 'see', arguments: {}, result: new ImageToolResult(png, 'a view of stone') },
    });
    await provider.forceFlush();

    const span = spans[0] as ExportedSpan;
    const text = eventText(span, TOOL_RESULT_EVENT) as string;
    expect(JSON.parse(text)).toEqual({ caption: 'a view of stone', png_base64_chars: 300_000 });
    expect(text).toContain('a view of stone');
    expect(new TextEncoder().encode(text).byteLength).toBeLessThan(1024);
    const key = `geldar.content.${TOOL_RESULT_EVENT}`;
    const event = span.events.find((item) => item.name === key);
    expect(event?.attributes[`${key}.truncated`]).toBe(false);
  });

  it('caps a result above 32 KiB on a UTF-8 boundary and marks it truncated', async () => {
    const { recorder, provider, spans } = startWithMemory();
    // Two-byte characters: the cap falls inside one, so the kept text must still be whole characters.
    const big = 'é'.repeat(CONTENT_CAP_BYTES);
    recorder({
      tool: 'look',
      outcome: 'ok',
      durationMs: 1,
      content: { name: 'look', arguments: {}, result: big },
    });
    await provider.forceFlush();

    const span = spans[0] as ExportedSpan;
    const text = eventText(span, TOOL_RESULT_EVENT) as string;
    const encoder = new TextEncoder();
    const original = JSON.stringify(big);
    expect(encoder.encode(text).byteLength).toBeLessThanOrEqual(CONTENT_CAP_BYTES);
    expect(original.startsWith(text)).toBe(true);
    expect(text).not.toContain('�');
    const key = `geldar.content.${TOOL_RESULT_EVENT}`;
    const event = span.events.find((item) => item.name === key);
    expect(event?.attributes[`${key}.truncated`]).toBe(true);
    expect(event?.attributes[`${key}.bytes`]).toBe(encoder.encode(original).byteLength);
  });

  it('a tool result returned to the agent is byte-identical with telemetry on and off', async () => {
    const { recorder, provider, spans } = startWithMemory();
    const off = worldTools();
    const on = worldTools();

    const resultOff = await call(off, undefined, 'look');
    const resultOn = await call(on, recorder, 'look');
    await provider.forceFlush();

    expect(spans).toHaveLength(1);
    expect(JSON.stringify(resultOn)).toBe(JSON.stringify(resultOff));
  });

  it('a successful look is the same wire response with the recorder on and off, with no trace id in it', async () => {
    const { recorder, provider, spans } = startWithMemory();
    const off = worldTools();
    const on = worldTools();

    const wireOff = await call(off, undefined, 'look');
    const wireOn = await call(on, recorder, 'look');
    await provider.forceFlush();

    expect(spans).toHaveLength(1);
    const traceId = spans[0]?.traceId ?? '';
    expect(traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(wireOn).toEqual(wireOff);
    expect(wireOn.isError).not.toBe(true);
    expect(wireOn.content[0]).toMatchObject({ type: 'text' });
    const text = JSON.stringify(wireOn);
    expect(text).not.toContain(traceId);
    expect(text).not.toMatch(/[0-9a-f]{32}/);
    expect(text).not.toContain('trace_id');
    expect(text).not.toContain('traceId');
    expect(text).not.toContain('_meta');
  });

  it('no trace id or span id reaches the agent-visible result or the error response', async () => {
    const { recorder, provider, spans } = startWithMemory();
    const tools = worldTools();

    const response = await call(tools, recorder, 'look');
    const failed = await call(tools, recorder, 'write_book');
    await provider.forceFlush();

    expect(spans).toHaveLength(2);
    expect(failed.isError).toBe(true);
    const visible = JSON.stringify([response, failed]);
    for (const span of spans) {
      expect(visible).not.toContain(span.traceId);
      expect(visible).not.toContain(span.spanId);
    }
  });

  it('redacts secret-named argument keys before capture, and never changes the input', async () => {
    const { recorder, provider, spans } = startWithMemory();
    const tools = worldTools();
    // Built at runtime, so no secret literal sits in the source.
    const secret = ['fake', 'secret', 'value', Date.now().toString(36)].join('-');
    const input = {
      token: secret,
      Authorization: `Bearer ${secret}`,
      nested: { password: secret, note: 'visible' },
      list: [{ cookie: secret }],
    };

    await call(tools, recorder, 'write_book', input);
    await provider.forceFlush();

    const span = spans[0] as ExportedSpan;
    const args = eventText(span, TOOL_ARGUMENTS_EVENT) as string;
    expect(args).not.toContain(secret);
    expect(args).toContain(REDACTED);
    expect(args).toContain('visible');
    expect(JSON.stringify(span.attributes)).not.toContain(secret);
    expect(input.token).toBe(secret);
  });

  it('redactArguments replaces secret-named keys at any depth, in any case, and copies', () => {
    const secret = ['fake', 'key', Date.now().toString(36)].join('-');
    const input = { PassWord: secret, a: [{ SECRET_x: secret, keep: 1 }], b: { keep: 'yes' } };
    const out = redactArguments(input) as Record<string, unknown>;
    expect(out).toEqual({
      PassWord: REDACTED,
      a: [{ SECRET_x: REDACTED, keep: 1 }],
      b: { keep: 'yes' },
    });
    expect(input.PassWord).toBe(secret);
  });

  it('redacts the credential-name family (apiKey, bearer, sessionId) and keeps token counts', () => {
    const secret = ['fake', 'family', Date.now().toString(36)].join('-');
    const input = {
      apiKey: secret,
      bearer: secret,
      sessionId: secret,
      input_tokens: 12,
      max_tokens: 64,
    };
    expect(redactArguments(input)).toEqual({
      apiKey: REDACTED,
      bearer: REDACTED,
      sessionId: REDACTED,
      input_tokens: 12,
      max_tokens: 64,
    });
  });

  it('keeps a __proto__ key as an own key of the copy, with its value redacted or kept', () => {
    const input = JSON.parse('{"__proto__":{"a":1},"keep":2}');
    const out = redactArguments(input);
    expect(JSON.stringify(out)).toBe('{"__proto__":{"a":1},"keep":2}');
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
  });

  it('stops copying at depth 32 with a [truncated] mark, and copies up to that depth', () => {
    let deep: unknown = 'leaf';
    for (let i = 0; i < 40; i += 1) deep = { n: deep };
    const text = JSON.stringify(redactArguments(deep));
    expect(text.split('{"n":').length - 1).toBe(32);
    expect(text).toContain('"[truncated]"');
    expect(text).not.toContain('leaf');
  });

  it('a cyclic argument still captures its arguments event, with a [cycle] mark at the repeat', async () => {
    const { recorder, provider, spans } = startWithMemory();
    const loop: Record<string, unknown> = { keep: 'visible' };
    loop.self = loop;
    recorder({
      tool: 'look',
      outcome: 'ok',
      durationMs: 1,
      content: { name: 'look', arguments: loop },
    });
    await provider.forceFlush();

    expect(spans).toHaveLength(1);
    expect(eventText(spans[0] as ExportedSpan, TOOL_ARGUMENTS_EVENT)).toBe(
      '{"keep":"visible","self":"[cycle]"}',
    );
  });

  it('a shared, non-cyclic reference is copied in full at each place it appears', () => {
    const shared = { a: 1 };
    expect(redactArguments({ x: shared, y: [shared] })).toEqual({ x: { a: 1 }, y: [{ a: 1 }] });
  });
});

describe('content failures never change the call (T-06c)', () => {
  it('a span whose content events throw still ends, and the call result stands', async () => {
    let ended = 0;
    const tracer: SpanTracer = {
      startSpan: () => ({
        setAttributes: () => undefined,
        addEvent: () => {
          throw new Error('exporter down');
        },
        end: () => {
          ended += 1;
        },
      }),
    };
    const record = toolSpanRecorder(tracer);
    expect(() =>
      record({
        tool: 'look',
        outcome: 'ok',
        durationMs: 1,
        content: { name: 'look', arguments: {}, result: {} },
      }),
    ).not.toThrow();
    expect(ended).toBe(1);
  });

  it('a result that cannot be serialized loses only its own event, and the arguments are still captured', () => {
    const events: string[] = [];
    const tracer: SpanTracer = {
      startSpan: () => ({
        setAttributes: () => undefined,
        addEvent: (name: string) => {
          events.push(name);
        },
        end: () => undefined,
      }),
    };
    toolSpanRecorder(tracer)({
      tool: 'look',
      outcome: 'ok',
      durationMs: 1,
      content: { name: 'look', arguments: { a: 1 }, result: { big: 10n } },
    });
    expect(events).toEqual([`geldar.content.${TOOL_ARGUMENTS_EVENT}`]);
  });

  it('a failed call captures its arguments and no result', async () => {
    const { recorder, provider, spans } = startWithMemory();
    const tools = worldTools();
    const failed = await call(tools, recorder, 'write_book', { title: 'x' });
    await provider.forceFlush();

    expect(failed.isError).toBe(true);
    const span = spans[0] as ExportedSpan;
    expect(eventText(span, TOOL_ARGUMENTS_EVENT)).toBe('{"title":"x"}');
    expect(eventText(span, TOOL_RESULT_EVENT)).toBeUndefined();
  });
});

/** A tracer that records each added event's name and attributes, with no SDK processor behind it. */
function fakeTracer(added: { name: string; attributes: Record<string, unknown> }[]): SpanTracer {
  return {
    startSpan: () => ({
      setAttributes: () => undefined,
      addEvent: (name: string, attributes?: Record<string, unknown>) => {
        added.push({ name, attributes: { ...attributes } });
      },
      end: () => undefined,
    }),
  };
}

describe('the content helper caps and serializes (T-06c)', () => {
  it('marks an over-cap argument event truncated, and an under-cap one not', () => {
    const added: { name: string; attributes: Record<string, unknown> }[] = [];
    const record = toolSpanRecorder(fakeTracer(added));
    record({
      tool: 'look',
      outcome: 'ok',
      durationMs: 1,
      content: { name: 'look', arguments: { big: 'é'.repeat(CONTENT_CAP_BYTES) } },
    });
    record({
      tool: 'look',
      outcome: 'ok',
      durationMs: 1,
      content: { name: 'look', arguments: { small: 'x' } },
    });

    const key = `geldar.content.${TOOL_ARGUMENTS_EVENT}`;
    expect(added.map((item) => item.name)).toEqual([key, key]);
    expect(added[0]?.attributes[`${key}.truncated`]).toBe(true);
    expect(added[1]?.attributes[`${key}.truncated`]).toBe(false);
  });

  it('a bigint in the arguments drops only the arguments event; the result event is still emitted', () => {
    const added: { name: string; attributes: Record<string, unknown> }[] = [];
    toolSpanRecorder(fakeTracer(added))({
      tool: 'look',
      outcome: 'ok',
      durationMs: 1,
      content: { name: 'look', arguments: { a: 1n }, result: 'ok' },
    });

    expect(added.map((item) => item.name)).toEqual([`geldar.content.${TOOL_RESULT_EVENT}`]);
    expect(added[0]?.attributes[`geldar.content.${TOOL_RESULT_EVENT}`]).toBe('"ok"');
  });
});
