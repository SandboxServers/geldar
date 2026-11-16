import { type ToolContext, ToolError } from '@geldar/mcp-mock';
import { startTelemetry, type TelemetryHandle } from '@geldar/telemetry';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { worldFixture } from './fakes/world.fakes.ts';
import type { BodyGateway, PlayerRecord } from './ports.ts';
import { TOOL_SPAN_NAME, toolSpanAttributes, toolSpanRecorder } from './telemetry.ts';
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

interface Captured {
  name: string;
  attributes: Record<string, unknown>;
  startTime: [number, number];
  endTime: [number, number];
}

/** An in-memory trace exporter. Logs and metrics get no-op exporters, so nothing leaves the process. */
function memoryExporter(): { spans: Captured[]; traces: object } {
  const spans: Captured[] = [];
  const traces = {
    export(batch: readonly Captured[], done: (result: { code: number }) => void) {
      spans.push(...batch);
      done({ code: 0 });
    },
    shutdown: async () => {},
  };
  return { spans, traces };
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

/** Starts the SDK with an endpoint and in-memory exporters, so no network call is possible. */
function startWithMemory() {
  const memory = memoryExporter();
  const handle = startTelemetry({
    service: 'geldar-mcp',
    version: 'test',
    endpoint: 'http://127.0.0.1:4318',
    instanceId: 'test-instance',
    exporters: {
      traces: memory.traces as never,
      logs: noop as never,
      metrics: noop as never,
    },
  });
  handles.push(handle);
  return { handle, spans: memory.spans };
}

function ctx(): ToolContext {
  return { playerId: PLAYER.playerId, signal: new AbortController().signal };
}

describe('telemetry with the endpoint unset', () => {
  it('starts no provider', () => {
    const handle = startTelemetry({ service: 'geldar-mcp', version: 'test' });
    expect(handle.enabled).toBe(false);
    expect(handle.tracerProvider).toBeUndefined();
  });

  it('treats a blank endpoint as unset', () => {
    const handle = startTelemetry({ service: 'geldar-mcp', version: 'test', endpoint: '   ' });
    expect(handle.enabled).toBe(false);
    expect(handle.tracerProvider).toBeUndefined();
  });
});

describe('one span per MCP tool call', () => {
  it('exports exactly one span per call, with only the allow-listed attributes', async () => {
    const { handle, spans } = startWithMemory();
    const provider = handle.tracerProvider;
    if (!provider) throw new Error('telemetry should be on when the endpoint is set');
    const fx = worldFixture([PLAYER]);
    fx.budget.seed(PLAYER.lifeId, 37, 0);
    const tools = createWorld(fx.deps).tools;
    const spanning = { tools, onToolSpan: toolSpanRecorder(provider.getTracer('geldar-mcp')) };

    await runToolCall(spanning, 'look', {}, ctx());
    await provider.forceFlush();

    expect(spans.map((span) => span.name)).toEqual([TOOL_SPAN_NAME]);
    expect(spans[0]?.attributes).toEqual({ 'gen_ai.tool.name': 'look', outcome: 'ok' });
  });

  it('exports one span for each of two calls', async () => {
    const { handle, spans } = startWithMemory();
    const provider = handle.tracerProvider;
    if (!provider) throw new Error('telemetry should be on when the endpoint is set');
    const fx = worldFixture([PLAYER]);
    fx.budget.seed(PLAYER.lifeId, 37, 0);
    const tools = createWorld(fx.deps).tools;
    const spanning = { tools, onToolSpan: toolSpanRecorder(provider.getTracer('geldar-mcp')) };

    await runToolCall(spanning, 'look', {}, ctx());
    await runToolCall(spanning, 'look', {}, ctx());
    await provider.forceFlush();

    expect(spans).toHaveLength(2);
  });

  it('marks a failed call with its outcome code as the error type', () => {
    expect(toolSpanAttributes({ tool: 'act', outcome: 'internal', durationMs: 3 })).toEqual({
      'gen_ai.tool.name': 'act',
      outcome: 'internal',
      'error.type': 'internal',
    });
  });

  it('drops a token-named attribute and its value', async () => {
    const { handle, spans } = startWithMemory();
    const provider = handle.tracerProvider;
    if (!provider) throw new Error('telemetry should be on when the endpoint is set');
    // Built at runtime so no literal credential shape sits in the source.
    const tokenKey = ['auth', 'token'].join('_');
    const tokenValue = ['tok', 'en', '-', 'value'].join('');
    const hostile = { tool: 'look', outcome: 'ok', durationMs: 1, [tokenKey]: tokenValue };
    toolSpanRecorder(provider.getTracer('geldar-mcp'))(hostile);
    await provider.forceFlush();

    expect(spans).toHaveLength(1);
    expect(Object.keys(spans[0]?.attributes ?? {})).not.toContain(tokenKey);
    expect(JSON.stringify(spans[0]?.attributes)).not.toContain(tokenValue);
  });
});

/**
 * A world whose Body throws `error` on every method, so a `look` call (which reads the Body's snapshot
 * first, with no wrapping) fails with it. `view` is not usable here: viewTool turns any Body throw into BodyUnavailable.
 */
function failingLook(error: unknown) {
  const fx = worldFixture([PLAYER]);
  fx.budget.seed(PLAYER.lifeId, 37, 0);
  const body = new Proxy({} as BodyGateway, {
    get: () => async () => {
      throw error;
    },
  });
  return createWorld({ ...fx.deps, body }).tools;
}

/**
 * Runs one failing `look` per error through one real span exporter, and returns the spans made, in order.
 * One SDK start per test: a second start in the same test sends its spans to the first exporter.
 */
async function spansOfFailedLooks(errors: unknown[]): Promise<Captured[]> {
  const { handle, spans } = startWithMemory();
  const provider = handle.tracerProvider;
  if (!provider) throw new Error('telemetry should be on when the endpoint is set');
  const recorder = toolSpanRecorder(provider.getTracer('geldar-mcp'));
  for (const error of errors) {
    const response = await runToolCall(
      { tools: failingLook(error), onToolSpan: recorder },
      'look',
      {},
      ctx(),
    );
    expect(response.isError).toBe(true);
  }
  await provider.forceFlush();
  return spans;
}

describe('recorder faults and failed calls', () => {
  it('a recorder that throws does not fail a successful call', async () => {
    const fx = worldFixture([PLAYER]);
    fx.budget.seed(PLAYER.lifeId, 37, 0);
    const tools = createWorld(fx.deps).tools;
    const onToolSpan = () => {
      throw new Error('recorder down');
    };
    const response = await runToolCall({ tools, onToolSpan }, 'look', {}, ctx());
    expect(response.isError).not.toBe(true);
  });

  it('keeps the tool error code when the recorder also throws', async () => {
    const tools = failingLook(new ToolError('rate_limited', 'Slow down.'));
    const onToolSpan = () => {
      throw new Error('recorder down');
    };
    const response = await runToolCall({ tools, onToolSpan }, 'look', {}, ctx());
    expect(response.isError).toBe(true);
    expect(response.content[0]).toMatchObject({ text: 'rate_limited: Slow down.' });
  });

  it('marks a ToolError with its code, and a plain Error as internal', async () => {
    const spans = await spansOfFailedLooks([
      new ToolError('rate_limited', 'Slow down.'),
      new Error('boom'),
    ]);
    expect(spans).toHaveLength(2);
    const [limited, crashed] = spans;
    if (!limited || !crashed) throw new Error('two spans expected');
    expect(limited.attributes['error.type']).toBe('rate_limited');
    expect(limited.attributes.outcome).toBe('rate_limited');
    expect(crashed.attributes['error.type']).toBe('internal');
  });
});

describe('the span helpers', () => {
  it('ends the span durationMs after it started', async () => {
    const { handle, spans } = startWithMemory();
    const provider = handle.tracerProvider;
    if (!provider) throw new Error('telemetry should be on when the endpoint is set');
    const recorder = toolSpanRecorder(provider.getTracer('geldar-mcp'));
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_000_000);
    try {
      recorder({ tool: 'look', outcome: 'ok', durationMs: 250 });
    } finally {
      vi.useRealTimers();
    }
    await provider.forceFlush();
    const span = spans[0];
    if (!span) throw new Error('one span expected');
    const [startS, startNs] = span.startTime;
    const [endS, endNs] = span.endTime;
    expect((endS - startS) * 1000 + (endNs - startNs) / 1e6).toBe(250);
  });

  it('copies only the explicit fields: allow-listed names and token-named fields never reach the attributes', () => {
    const tokenKey = ['auth', 'token'].join('_');
    const tokenValue = ['tok', 'en', '-', 'value'].join('');
    // Names the span does allow-list (a model, an error type) are hostile too on an ok call: the
    // attributes come only from the explicit map, so neither can leak in.
    const hostile = {
      tool: 'look',
      outcome: 'ok',
      durationMs: 1,
      'gen_ai.request.model': 'x',
      'error.type': 'leak',
      [tokenKey]: tokenValue,
    };
    expect(toolSpanAttributes(hostile)).toEqual({ 'gen_ai.tool.name': 'look', outcome: 'ok' });
  });

  it('exports exactly the explicit attributes for the same hostile input through the recorder', async () => {
    const { handle, spans } = startWithMemory();
    const provider = handle.tracerProvider;
    if (!provider) throw new Error('telemetry should be on when the endpoint is set');
    const tokenKey = ['auth', 'token'].join('_');
    const tokenValue = ['tok', 'en', '-', 'value'].join('');
    const hostile = {
      tool: 'look',
      outcome: 'ok',
      durationMs: 1,
      'gen_ai.request.model': 'x',
      'error.type': 'leak',
      [tokenKey]: tokenValue,
    };
    toolSpanRecorder(provider.getTracer('geldar-mcp'))(hostile);
    await provider.forceFlush();

    expect(spans).toHaveLength(1);
    expect(spans[0]?.attributes).toEqual({ 'gen_ai.tool.name': 'look', outcome: 'ok' });
  });

  it('clamps an unknown tool name to other, and keeps a known one', () => {
    const known = toolSpanAttributes({ tool: 'look', outcome: 'ok', durationMs: 1 });
    expect(known['gen_ai.tool.name']).toBe('look');
    const unknown = toolSpanAttributes({ tool: 'made_up_tool', outcome: 'ok', durationMs: 1 });
    expect(unknown['gen_ai.tool.name']).toBe('other');
  });
});
