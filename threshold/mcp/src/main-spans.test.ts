import { FakeClock } from '@geldar/mcp-mock';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { repoRoot } from './config.ts';
import { MemoryPresenceBucket } from './fakes/world.fakes.ts';
import type { FrontDoorOptions } from './http/front.ts';
import { loadStartConfig, type McpPorts, type NatsLink, startMcp } from './main.ts';
import { TOOL_SPAN_NAME } from './telemetry.ts';

/** The shipped shard and the two secret paths it needs (the files are never read in these tests). */
const SHARD_FILE = `${repoRoot()}/shards/phase0.yaml`;
const ENV = {
  GELDAR_MCP_DB_PASSWORD_FILE: '/run/secrets/pg',
  GELDAR_MCP_PEPPER_FILE: '/run/secrets/pepper',
};
const PEPPER = 'canary-pepper-9d1c-0123456789abcdef';
const PASSWORD = 'canary-pg-password-7f3a';

interface ExportedSpan {
  name: string;
  attributes: Record<string, unknown>;
}

/** In-memory span exporters: the traces one records what it is sent; logs and metrics are no-ops. */
function spanExporters(spans: ExportedSpan[]) {
  const noop = {
    export: (_batch: unknown, done: (result: { code: number }) => void) => done({ code: 0 }),
    forceFlush: async () => {},
    shutdown: async () => {},
  };
  const traces = {
    export(batch: ExportedSpan[], done: (result: { code: number }) => void) {
      spans.push(...batch);
      done({ code: 0 });
    },
    shutdown: async () => {},
  };
  return { traces, logs: noop, metrics: noop };
}

/** Fakes for every outside port. Nothing listens or connects. */
function fakePorts(captured: { options?: FrontDoorOptions }): McpPorts {
  const nats: NatsLink = {
    request: (() => Promise.reject(new Error('not used'))) as never,
    buckets: { create: async () => new MemoryPresenceBucket() } as never,
    publishCall: async () => {},
    replay: async () => ({ stop: async () => {} }),
    drain: async () => {},
  };
  const pool = {
    query: async () => ({ rows: [] }),
    on: () => undefined,
    end: async () => {},
  } as unknown as Pool;
  const listener = {
    on: () => listener,
    connect: async () => {},
    query: async () => ({ rows: [] }),
    end: async () => {},
  };
  return {
    readSecret: async (path) => (path.endsWith('pepper') ? PEPPER : PASSWORD),
    openPool: () => pool,
    connectNats: async () => nats,
    openRevokeListener: () => listener as never,
    keepAlive: { start: () => () => undefined },
    clock: new FakeClock(1_000_000),
    log: () => undefined,
    frontDoor: (options) => {
      captured.options = options;
      return {
        listen: async () => 8443,
        close: async () => {},
      };
    },
  };
}

/**
 * Starts the MCP with the span SDK on when `url` is set, and in-memory exporters. Opens one session
 * through the front door's createSession, makes one `look` call over an in-memory MCP transport, then
 * stops the MCP. Returns what the span exporter received and what the telemetry push sent.
 */
async function startWithSpans(url: string | undefined, refuse = false) {
  const spans: ExportedSpan[] = [];
  const fetchCalls: string[] = [];
  const captured: { options?: FrontDoorOptions } = {};
  const ports = fakePorts(captured);
  ports.telemetry = {
    url,
    fetch: (async (target: string) => {
      fetchCalls.push(String(target));
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch,
    intervalMs: 3_600_000,
  };
  ports.spanExporters = spanExporters(spans) as never;
  const running = await startMcp(await loadStartConfig(SHARD_FILE, ENV), ports);
  if (!captured.options) throw new Error('the front door should receive its options');
  const session = captured.options.createSession('ag-ranger-01', new AbortController().signal, {
    source: 'model',
  });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await session.connect(serverSide);
  const client = new Client({ name: 'main-spans-test', version: '0.0.0' });
  await client.connect(clientSide);
  await client.callTool({ name: 'look', arguments: {} });
  await client.close();
  const hook = captured.options.onRefusal;
  if (refuse) hook?.({ reason: 'unknown_token', status: 401 });
  await running.stop();
  return { spans, fetchCalls, hook };
}

describe('the span wiring in startMcp (T-06)', () => {
  it('exports exactly one mcp.tool_call span for one tool call, on stop, when the telemetry URL is set', async () => {
    const { spans } = await startWithSpans('http://127.0.0.1:4318');
    expect(spans.map((span) => span.name)).toEqual([TOOL_SPAN_NAME]);
    expect(spans[0]?.attributes['gen_ai.tool.name']).toBe('look');
  });

  it('sends no span and no request when the telemetry URL is unset', async () => {
    const { spans, fetchCalls } = await startWithSpans(undefined);
    expect(spans).toEqual([]);
    expect(fetchCalls).toEqual([]);
  });

  it('passes the auth refusal hook to the front door only when the telemetry URL is set', async () => {
    expect((await startWithSpans('http://127.0.0.1:4318')).hook).toBeTypeOf('function');
    expect((await startWithSpans(undefined)).hook).toBeUndefined();
  });

  it('exports one mcp.auth_refused span from the hook, with the outcome and no other attribute today', async () => {
    const { spans } = await startWithSpans('http://127.0.0.1:4318', true);
    const refused = spans.filter((span) => span.name === 'mcp.auth_refused');
    expect(refused).toHaveLength(1);
    // http.response.status_code is dropped by the allow-list until that key lands (branch telemetry/t36-tm01).
    expect(refused[0]?.attributes).toEqual({ outcome: 'unknown_token' });
  });
});
