import { FakeClock } from '@geldar/mcp-mock';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { repoRoot } from './config.ts';
import { MemoryPresenceBucket } from './fakes/world.fakes.ts';
import type { FrontDoorOptions } from './http/front.ts';
import { loadStartConfig, type McpPorts, type NatsLink, startMcp } from './main.ts';

/** The shipped shard and the two secret paths it needs (the files are never read in these tests). */
const SHARD_FILE = `${repoRoot()}/shards/phase0.yaml`;
const ENV = {
  GELDAR_MCP_DB_PASSWORD_FILE: '/run/secrets/pg',
  GELDAR_MCP_PEPPER_FILE: '/run/secrets/pepper',
};
const PEPPER = 'canary-pepper-9d1c-0123456789abcdef';
const PASSWORD = 'canary-pg-password-7f3a';
const TOKEN = `gmcp-${'cd'.repeat(32)}`;

/** A record as the log exporter receives it: the body, the severity and the attributes. */
interface ShippedRecord {
  body: unknown;
  severityText: string | undefined;
  attributes: Record<string, unknown>;
}

/** Keeps every log record the SDK exports; spans and metrics are no-ops. */
function recordExporters(records: ShippedRecord[]) {
  const noop = {
    export: (_batch: unknown, done: (result: { code: number }) => void) => done({ code: 0 }),
    forceFlush: async () => {},
    shutdown: async () => {},
  };
  const logs = {
    export(batch: ShippedRecord[], done: (result: { code: number }) => void) {
      for (const record of batch) {
        records.push({
          body: record.body,
          severityText: record.severityText,
          attributes: { ...record.attributes },
        });
      }
      done({ code: 0 });
    },
    forceFlush: async () => {},
    shutdown: async () => {},
  };
  return { traces: noop, logs, metrics: noop };
}

/** Fakes for every outside port. Nothing listens or connects. The stderr sink is `stderr`. */
function fakePorts(captured: { options?: FrontDoorOptions }, stderr: Record<string, unknown>[]) {
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
  const ports: McpPorts = {
    readSecret: async (path) => (path.endsWith('pepper') ? PEPPER : PASSWORD),
    openPool: () => pool,
    connectNats: async () => nats,
    openRevokeListener: () => listener as never,
    keepAlive: { start: () => () => undefined },
    clock: new FakeClock(1_000_000),
    log: (line) => {
      stderr.push(line);
    },
    frontDoor: (options) => {
      captured.options = options;
      return {
        listen: async () => 8443,
        close: async () => {},
      };
    },
  };
  return ports;
}

/**
 * Starts the MCP with the telemetry URL `url` (or none), opens one session, makes one `look` call and
 * one 429 refusal line through the front door's log, then stops. Returns the log records the exporter
 * received and the stderr lines the sink wrote.
 */
async function runWithLogs(url: string | undefined) {
  const records: ShippedRecord[] = [];
  const stderr: Record<string, unknown>[] = [];
  const captured: { options?: FrontDoorOptions } = {};
  const ports = fakePorts(captured, stderr);
  ports.telemetry = {
    url,
    fetch: (async () => new Response(null, { status: 204 })) as unknown as typeof fetch,
    intervalMs: 3_600_000,
  };
  ports.spanExporters = recordExporters(records) as never;
  const running = await startMcp(await loadStartConfig(SHARD_FILE, ENV), ports);
  const options = captured.options;
  if (!options) throw new Error('the front door should receive its options');
  const session = options.createSession('ag-ranger-01', new AbortController().signal, {
    source: 'model',
  });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await session.connect(serverSide);
  const client = new Client({ name: 'main-logs-test', version: '0.0.0' });
  await client.connect(clientSide);
  await client.callTool({ name: 'look', arguments: {} });
  await client.close();
  const frontLog = options.log;
  if (!frontLog) throw new Error('the front door should receive its log sink');
  frontLog({
    event: 'rate_limited',
    status: 429,
    reason: 'rate_limited',
    player_id: 'aa',
    token: TOKEN,
  });
  await running.stop();
  return { records, stderr };
}

describe('the log record wiring in startMcp', () => {
  it('ships a tool_call line and a 429 refusal line as one record each, with no player id', async () => {
    const { records } = await runWithLogs('http://127.0.0.1:4318');
    const toolCalls = records.filter((record) => record.body === 'tool_call');
    expect(toolCalls).toHaveLength(1);
    // The fake pool has no player row, so the look call's outcome is unknown_player: a WARN.
    expect(toolCalls[0]?.severityText).toBe('WARN');
    // The MCP passes tool, status and duration_ms as extraKeys: closed values, so they ship with event and outcome.
    expect(toolCalls[0]?.attributes).toEqual({
      event: 'tool_call',
      outcome: 'unknown_player',
      tool: 'look',
      duration_ms: expect.any(Number),
    });
    expect(toolCalls[0]?.attributes).not.toHaveProperty('player_id');

    const refusals = records.filter((record) => record.body === 'rate_limited');
    expect(refusals).toHaveLength(1);
    expect(refusals[0]?.severityText).toBe('WARN');
    expect(refusals[0]?.attributes).toEqual({
      event: 'rate_limited',
      status: 429,
      reason: 'rate_limited',
    });
    expect(refusals[0]?.attributes).not.toHaveProperty('player_id');
    expect(JSON.stringify(records)).not.toContain(TOKEN);
  });

  it('ships no record when the telemetry URL is unset, and the stderr lines are the same either way', async () => {
    const off = await runWithLogs(undefined);
    expect(off.records).toEqual([]);
    const on = await runWithLogs('http://127.0.0.1:4318');
    // Every line after the span SDK starts is shipped once; mcp_start (before the SDK) and mcp_stopped
    // (after its shutdown) are never shipped.
    const shipped = on.stderr
      .map((line) => line.event)
      .filter((event) => event !== 'mcp_start' && event !== 'mcp_stopped');
    expect(on.records.map((record) => record.body)).toEqual(shipped);
    expect(off.stderr.map((line) => line.event)).toEqual(on.stderr.map((line) => line.event));
    expect(off.stderr).toEqual(on.stderr);
    expect(off.stderr.filter((line) => line.event === 'rate_limited')).toHaveLength(1);
  });
});
