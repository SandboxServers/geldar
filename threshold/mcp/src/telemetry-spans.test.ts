import { callTool, type ToolContext } from '@geldar/mcp-mock';
import { startTelemetry, type TelemetryHandle } from '@geldar/telemetry';
import { afterEach, describe, expect, it } from 'vitest';
import { worldFixture } from './fakes/world.fakes.ts';
import type { PlayerRecord } from './ports.ts';
import { TOOL_SPAN_NAME, toolSpanAttributes, toolSpanRecorder } from './telemetry.ts';
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

interface Captured {
  name: string;
  attributes: Record<string, unknown>;
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
    const tools = createWorld({
      ...fx.deps,
      onToolSpan: toolSpanRecorder(provider.getTracer('geldar-mcp')),
    }).tools;

    await callTool(tools, 'look', {}, ctx());
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
    const tools = createWorld({
      ...fx.deps,
      onToolSpan: toolSpanRecorder(provider.getTracer('geldar-mcp')),
    }).tools;

    await callTool(tools, 'look', {}, ctx());
    await callTool(tools, 'look', {}, ctx());
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
