import { describe, expect, it } from 'vitest';
import {
  declareMcpMetrics,
  MetricRegistry,
  pushMetrics,
  recordToolCall,
  startTelemetry,
} from './metrics.ts';

/** A fake fetch that answers with `status` and records each call. */
function fakeFetch(status = 200) {
  const calls: Array<{ url: string; body: string }> = [];
  const fetchFn = (async (url: string, init?: RequestInit) => {
    calls.push({ url, body: String(init?.body ?? '') });
    return new Response(null, { status });
  }) as unknown as typeof fetch;
  return { calls, fetchFn };
}

function registry(): MetricRegistry {
  const reg = new MetricRegistry();
  reg.declare('counter', 'geldar_mcp_requests_total', 'MCP requests', ['route', 'outcome']);
  reg.declare('gauge', 'geldar_nats_connected', 'NATS link up (1) or down (0)');
  reg.declare(
    'histogram',
    'geldar_mcp_request_seconds',
    'MCP request latency',
    ['route'],
    [0.1, 1],
  );
  return reg;
}

describe('MetricRegistry', () => {
  it('renders counters, gauges and histograms in the Prometheus text format', () => {
    const reg = registry();
    reg.add('geldar_mcp_requests_total', { route: 'wait', outcome: '200' }, 2);
    reg.set('geldar_nats_connected', {}, 1);
    reg.observe('geldar_mcp_request_seconds', { route: 'wait' }, 0.05);
    reg.observe('geldar_mcp_request_seconds', { route: 'wait' }, 0.5);
    const text = reg.render();
    expect(text).toContain('# TYPE geldar_mcp_requests_total counter');
    expect(text).toContain('geldar_mcp_requests_total{route="wait",outcome="200"} 2');
    expect(text).toContain('geldar_nats_connected 1');
    expect(text).toContain('geldar_mcp_request_seconds_bucket{route="wait",le="0.1"} 1');
    expect(text).toContain('geldar_mcp_request_seconds_bucket{route="wait",le="1"} 2');
    expect(text).toContain('geldar_mcp_request_seconds_bucket{route="wait",le="+Inf"} 2');
    expect(text).toContain('geldar_mcp_request_seconds_count{route="wait"} 2');
  });

  it.each(['player', 'life', 'token', 'life_id', 'player_name', 'auth_token'])(
    'refuses a label named %s, which could carry a player, a life or a token',
    (label) => {
      const reg = new MetricRegistry();
      expect(() => reg.declare('counter', 'geldar_x_total', 'x', [label])).toThrow(
        `label ${label} on geldar_x_total is not allowed`,
      );
    },
  );

  it('refuses a series whose labels are not exactly the declared names', () => {
    const reg = registry();
    expect(() => reg.add('geldar_mcp_requests_total', { route: 'wait' })).toThrow(
      'takes labels route, outcome',
    );
    expect(() =>
      reg.add('geldar_mcp_requests_total', { route: 'wait', outcome: '200', player: 'ag_x' }),
    ).toThrow('takes labels route, outcome');
  });

  it('refuses a value of the wrong kind for a metric', () => {
    const reg = registry();
    expect(() => reg.set('geldar_mcp_requests_total', { route: 'a', outcome: 'b' }, 1)).toThrow(
      'is a counter, not a gauge',
    );
  });

  it('writes OTLP JSON with a monotonic sum for counters and no label named for a person', () => {
    const reg = registry();
    reg.add('geldar_mcp_requests_total', { route: 'wait', outcome: '200' }, 3);
    const [resource] = [{ metrics: reg.otlp('1700000000000000000') }];
    const counter = resource.metrics.find(
      (m) => (m as { name: string }).name === 'geldar_mcp_requests_total',
    ) as {
      sum: {
        isMonotonic: boolean;
        dataPoints: Array<{ asDouble: number; attributes: Array<{ key: string }> }>;
      };
    };
    expect(counter.sum.isMonotonic).toBe(true);
    expect(counter.sum.dataPoints[0]?.asDouble).toBe(3);
    const keys = counter.sum.dataPoints[0]?.attributes.map((a) => a.key) ?? [];
    expect(keys).toEqual(['route', 'outcome']);
  });
});

describe('the MCP tool-call metrics', () => {
  it('counts a call by its tool and outcome code, and times it in seconds', () => {
    const reg = new MetricRegistry();
    declareMcpMetrics(reg);
    recordToolCall(reg, 'look', 'ok', 250);
    const text = reg.render();
    expect(text).toContain('geldar_mcp_tool_calls_total{tool="look",outcome="ok"} 1');
    expect(text).toContain('geldar_mcp_tool_call_seconds_count{tool="look"} 1');
    expect(text).toContain('geldar_mcp_tool_call_seconds_bucket{tool="look",le="0.25"} 1');
  });

  it('keeps every label on a closed set: an unknown tool is other, an unknown outcome is internal', () => {
    const reg = new MetricRegistry();
    declareMcpMetrics(reg);
    recordToolCall(reg, 'a player said hello', 'Canary-7 secret words', 5);
    const text = reg.render();
    expect(text).toContain('geldar_mcp_tool_calls_total{tool="other",outcome="internal"} 1');
    expect(text).not.toContain('Canary');
  });

  it('uses only the label names tool, outcome and le, never one that names a person or a token', () => {
    const reg = new MetricRegistry();
    declareMcpMetrics(reg);
    recordToolCall(reg, 'wait', 'rate_limited', 1);
    const names = new Set(reg.render().match(/[a-zA-Z_]+(?=="|=")/g));
    expect([...names].sort()).toEqual(['le', 'outcome', 'tool']);
  });
});

describe('telemetry push', () => {
  it('no endpoint, no outbound request: an unset URL starts nothing and calls fetch never', async () => {
    const { calls, fetchFn } = fakeFetch();
    const logs: Record<string, string | number>[] = [];
    const handle = startTelemetry(registry(), {
      url: undefined,
      service: 'geldar-mcp',
      log: (line) => logs.push(line),
      fetch: fetchFn,
      intervalMs: 5,
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    await handle.stop();
    expect(calls).toHaveLength(0);
    expect(logs).toHaveLength(0);
  });

  it('stop waits for a push still in flight, and no push starts after it', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const starts: string[] = [];
    // Each push is held until the gate opens, so stop() is called while a request is in flight.
    const heldFetch = (async (url: string) => {
      starts.push(url);
      await gate;
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;
    const handle = startTelemetry(registry(), {
      url: 'http://127.0.0.1:4318',
      service: 'geldar-mcp',
      log: () => {},
      fetch: heldFetch,
      intervalMs: 5,
    });
    try {
      expect(starts).toHaveLength(1);
      await new Promise((resolve) => setTimeout(resolve, 20));
      let settled = false;
      const stopping = handle.stop().then(() => {
        settled = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(settled).toBe(false);
      release();
      await stopping;
      expect(settled).toBe(true);
      const started = starts.length;
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(starts.length).toBe(started);
    } finally {
      release();
    }
  });

  it('posts the OTLP JSON to <url>/v1/metrics once', async () => {
    const { calls, fetchFn } = fakeFetch();
    await pushMetrics(registry(), {
      url: 'http://127.0.0.1:4318/',
      service: 'geldar-mcp',
      log: () => {},
      fetch: fetchFn,
      now: () => 1_700_000_000_000,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('http://127.0.0.1:4318/v1/metrics');
    const body = JSON.parse(calls[0]?.body ?? '{}');
    expect(body.resourceMetrics[0].resource.attributes).toContainEqual({
      key: 'service.name',
      value: { stringValue: 'geldar-mcp' },
    });
  });

  it('logs a failed push with its status code and does not throw', async () => {
    const { fetchFn } = fakeFetch(503);
    const logs: Record<string, string | number>[] = [];
    await pushMetrics(registry(), {
      url: 'http://127.0.0.1:4318',
      service: 'geldar-mcp',
      log: (line) => logs.push(line),
      fetch: fetchFn,
    });
    expect(logs).toEqual([{ event: 'telemetry_push_failed', status: 503 }]);
  });
});
