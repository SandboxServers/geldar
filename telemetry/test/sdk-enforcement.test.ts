import { logs, metrics, propagation, trace } from '@opentelemetry/api';
import { ExportResultCode } from '@opentelemetry/core';
import type { LogRecordExporter } from '@opentelemetry/sdk-logs';
import type { PushMetricExporter, ResourceMetrics } from '@opentelemetry/sdk-metrics';
import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace';
import { beforeEach, describe, expect, it } from 'vitest';
import { CONTENT_CAP_BYTES } from '../src/cap-text.ts';
import { startTelemetry, type TelemetryExporters } from '../src/sdk.ts';

const ENDPOINT = 'http://127.0.0.1:4318';
const BASE = { service: 'geldar-test', version: '0.0.0', endpoint: ENDPOINT };

type Attrs = Record<string, unknown>;

interface Captured {
  spans: ReadableSpan[];
  logs: Array<{ attributes: Attrs }>;
  points: Attrs[];
}

// Fake exporters: they record what the SDK hands them and never touch the network.
function capturing(): { exporters: TelemetryExporters; seen: Captured } {
  const seen: Captured = { spans: [], logs: [], points: [] };
  const traces: SpanExporter = {
    export(spans, done) {
      seen.spans.push(...spans);
      done({ code: ExportResultCode.SUCCESS });
    },
    shutdown: async () => {},
  };
  const logExporter = {
    export(records: Array<{ attributes: Attrs }>, done: (r: { code: number }) => void) {
      seen.logs.push(...records);
      done({ code: ExportResultCode.SUCCESS });
    },
    shutdown: async () => {},
  } as unknown as LogRecordExporter;
  const metricExporter = {
    export(batch: ResourceMetrics, done: (r: { code: number }) => void) {
      for (const scope of batch.scopeMetrics) {
        for (const metric of scope.metrics) {
          for (const point of metric.dataPoints) seen.points.push(point.attributes);
        }
      }
      done({ code: ExportResultCode.SUCCESS });
    },
    forceFlush: async () => {},
    shutdown: async () => {},
  } as unknown as PushMetricExporter;
  return { exporters: { traces, logs: logExporter, metrics: metricExporter }, seen };
}

// Each test installs its own global providers, so clear the previous test's registrations first.
beforeEach(() => {
  trace.disable();
  logs.disable();
  metrics.disable();
  propagation.disable();
});

describe('SDK-level enforcement of raw OpenTelemetry API calls', () => {
  it('filters span and event attributes and caps content before export', async () => {
    const { exporters, seen } = capturing();
    const handle = startTelemetry({ ...BASE, exporters });
    const span = trace.getTracer('raw').startSpan('raw', {
      attributes: {
        'user.email': 'a@example.test',
        life_id: 'lf_9',
        'geldar.content.x': 'z'.repeat(100_000),
      },
    });
    span.addEvent('raw.event', { 'user.email': 'b@example.test', life_id: 'lf_9' });
    span.end();
    await handle.shutdown();
    const exported = seen.spans[0];
    expect(exported).toBeDefined();
    const attrs = exported?.attributes ?? {};
    expect(attrs).not.toHaveProperty('user.email');
    expect(attrs.life_id).toBe('lf_9');
    expect(String(attrs['geldar.content.x']).length).toBe(CONTENT_CAP_BYTES);
    expect(attrs['geldar.content.x.truncated']).toBe(true);
    const eventAttrs = exported?.events[0]?.attributes ?? {};
    expect(eventAttrs).not.toHaveProperty('user.email');
    expect(eventAttrs.life_id).toBe('lf_9');
  });

  it('filters log record attributes before export', async () => {
    const { exporters, seen } = capturing();
    const handle = startTelemetry({ ...BASE, exporters });
    logs.getLogger('raw').emit({
      body: 'raw',
      attributes: { 'user.email': 'a@example.test', life_id: 'lf_9', free_text: 'x' },
    });
    await handle.shutdown();
    expect(seen.logs).toHaveLength(1);
    expect(seen.logs[0]?.attributes).not.toHaveProperty('user.email');
    expect(seen.logs[0]?.attributes).not.toHaveProperty('free_text');
    expect(seen.logs[0]?.attributes.life_id).toBe('lf_9');
  });

  it('filters span link attributes before export', async () => {
    const { exporters, seen } = capturing();
    const handle = startTelemetry({ ...BASE, exporters });
    const tracer = trace.getTracer('raw');
    const target = tracer.startSpan('target');
    target.end();
    const span = tracer.startSpan('linking', {
      links: [
        {
          context: target.spanContext(),
          attributes: { password: 'hunter2', random: 'x', life_id: 'lf_9' },
        },
      ],
    });
    span.end();
    await handle.shutdown();
    const exported = seen.spans.find((s) => s.name === 'linking');
    const link = exported?.links[0];
    expect(link).toBeDefined();
    expect(link?.attributes).not.toHaveProperty('password');
    expect(link?.attributes).not.toHaveProperty('random');
    expect(link?.attributes?.life_id).toBe('lf_9');
  });

  it('keeps life labels off exported metric series', async () => {
    const { exporters, seen } = capturing();
    const handle = startTelemetry({ ...BASE, exporters });
    metrics
      .getMeter('raw')
      .createCounter('geldar.turns')
      .add(1, { life_id: 'lf_9', outcome: 'ok' });
    await handle.shutdown();
    expect(seen.points.some((point) => point.outcome === 'ok')).toBe(true);
    for (const point of seen.points) expect(point).not.toHaveProperty('life_id');
  });
});
