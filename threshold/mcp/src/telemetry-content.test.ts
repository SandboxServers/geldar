import { callTool, type ToolContext } from '@geldar/mcp-mock';
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
function worldTools(recorder?: (call: ToolCallSpan) => void) {
  const fx = worldFixture([PLAYER]);
  fx.budget.seed(PLAYER.lifeId, 37, 0);
  return createWorld(recorder ? { ...fx.deps, onToolSpan: recorder } : fx.deps).tools;
}

/** A tool called directly, so its wrapper runs; the rejection is returned as the error the agent sees. */
async function failureOf(run: () => unknown): Promise<{ message: string; code: unknown }> {
  try {
    await run();
  } catch (err) {
    return { message: (err as Error).message, code: (err as { code?: unknown }).code };
  }
  throw new Error('the tool was expected to fail');
}

function eventText(span: ExportedSpan, name: string): unknown {
  const event = span.events.find((item) => item.name === `geldar.content.${name}`);
  return event?.attributes[`geldar.content.${name}`];
}

describe('tool content as span events (T-06c)', () => {
  it('captures a call arguments and its result as span events', async () => {
    const { recorder, provider, spans } = startWithMemory();
    const tools = worldTools(recorder);

    const result = await tools.look({}, ctx());
    await provider.forceFlush();

    expect(spans).toHaveLength(1);
    expect(eventText(spans[0] as ExportedSpan, TOOL_ARGUMENTS_EVENT)).toBe('{}');
    expect(eventText(spans[0] as ExportedSpan, TOOL_RESULT_EVENT)).toBe(JSON.stringify(result));
  });

  it('carries a result under the cap whole, with no truncation mark', async () => {
    const { recorder, provider, spans } = startWithMemory();
    recorder({
      tool: 'look',
      outcome: 'ok',
      durationMs: 1,
      content: { arguments: {}, result: 'short' },
    });
    await provider.forceFlush();

    const span = spans[0] as ExportedSpan;
    expect(eventText(span, TOOL_RESULT_EVENT)).toBe('"short"');
    const key = `geldar.content.${TOOL_RESULT_EVENT}.truncated`;
    const event = span.events.find((item) => item.name === `geldar.content.${TOOL_RESULT_EVENT}`);
    expect(event?.attributes[key]).toBe(false);
  });

  it('caps a result above 32 KiB on a UTF-8 boundary and marks it truncated', async () => {
    const { recorder, provider, spans } = startWithMemory();
    // Two-byte characters: the cap falls inside one, so the kept text must still be whole characters.
    const big = 'é'.repeat(CONTENT_CAP_BYTES);
    recorder({
      tool: 'look',
      outcome: 'ok',
      durationMs: 1,
      content: { arguments: {}, result: big },
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
    const on = worldTools(recorder);

    const resultOff = await off.look({}, ctx());
    const resultOn = await on.look({}, ctx());
    await provider.forceFlush();

    expect(spans).toHaveLength(1);
    expect(JSON.stringify(resultOn)).toBe(JSON.stringify(resultOff));
  });

  it('no trace id or span id reaches the agent-visible result or the error response', async () => {
    const { recorder, provider, spans } = startWithMemory();
    const tools = worldTools(recorder);

    const response = await tools.look({}, ctx());
    const failed = await failureOf(() => tools.write_book({}, ctx()));
    await provider.forceFlush();

    expect(spans).toHaveLength(2);
    expect(failed.code).toBeDefined();
    const visible = JSON.stringify([response, failed]);
    for (const span of spans) {
      expect(visible).not.toContain(span.traceId);
      expect(visible).not.toContain(span.spanId);
    }
  });

  it('redacts secret-named argument keys before capture, and never changes the input', async () => {
    const { recorder, provider, spans } = startWithMemory();
    const tools = worldTools(recorder);
    // Built at runtime, so no secret literal sits in the source.
    const secret = ['fake', 'secret', 'value', Date.now().toString(36)].join('-');
    const input = {
      token: secret,
      Authorization: `Bearer ${secret}`,
      nested: { password: secret, note: 'visible' },
      list: [{ cookie: secret }],
    };

    await failureOf(() => tools.write_book(input, ctx()));
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

  it('endpoint unset: no provider, no span and no content, and the result is unchanged', async () => {
    const handle = startTelemetry({ service: 'geldar-mcp', version: 'test' });
    handles.push(handle);
    expect(handle.tracerProvider).toBeUndefined();
    const tools = worldTools();
    const response = await callTool(tools, 'look', {}, ctx());
    expect(response.isError).not.toBe(true);
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
        content: { arguments: {}, result: {} },
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
      content: { arguments: { a: 1 }, result: { big: 10n } },
    });
    expect(events).toEqual([`geldar.content.${TOOL_ARGUMENTS_EVENT}`]);
  });

  it('a failed call captures its arguments and no result', async () => {
    const { recorder, provider, spans } = startWithMemory();
    const tools = worldTools(recorder);
    const failed = await failureOf(() => tools.write_book({ title: 'x' }, ctx()));
    await provider.forceFlush();

    expect(failed.code).toBeDefined();
    const span = spans[0] as ExportedSpan;
    expect(eventText(span, TOOL_ARGUMENTS_EVENT)).toBe('{"title":"x"}');
    expect(eventText(span, TOOL_RESULT_EVENT)).toBeUndefined();
  });
});
