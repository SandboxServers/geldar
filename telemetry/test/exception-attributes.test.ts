import { logs, metrics, trace } from '@opentelemetry/api';
import { ExportResultCode } from '@opentelemetry/core';
import type { LogRecordExporter } from '@opentelemetry/sdk-logs';
import type { PushMetricExporter } from '@opentelemetry/sdk-metrics';
import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace';
import { beforeEach, describe, expect, it } from 'vitest';
import { CONTENT_CAP_BYTES } from '../src/cap-text.ts';
import { startTelemetry, type TelemetryExporters } from '../src/sdk.ts';

const BASE = { service: 'geldar-test', version: '0.0.0', endpoint: 'http://127.0.0.1:4318' };

interface Captured {
  spans: ReadableSpan[];
  logs: Array<{ attributes: Record<string, unknown> }>;
}

// Fake exporters: they record what the SDK hands them and never touch the network.
function capturing(): { exporters: TelemetryExporters; seen: Captured } {
  const seen: Captured = { spans: [], logs: [] };
  const traces: SpanExporter = {
    export(spans, done) {
      seen.spans.push(...spans);
      done({ code: ExportResultCode.SUCCESS });
    },
    shutdown: async () => {},
  };
  const logExporter = {
    export(records: Array<{ attributes: Record<string, unknown> }>, done: (r: unknown) => void) {
      seen.logs.push(...records);
      done({ code: ExportResultCode.SUCCESS });
    },
    shutdown: async () => {},
  } as unknown as LogRecordExporter;
  const metricExporter = {
    export(_batch: unknown, done: (r: unknown) => void) {
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
});

describe('exception attributes on span events', () => {
  it('exports exception.type and exception.message on the recorded event', async () => {
    const { exporters, seen } = capturing();
    const handle = startTelemetry({ ...BASE, exporters });
    const span = trace.getTracer('raw').startSpan('failing');
    span.recordException(new Error('boom'));
    span.end();
    await handle.shutdown();
    const event = seen.spans.find((s) => s.name === 'failing')?.events[0];
    expect(event?.name).toBe('exception');
    expect(event?.attributes?.['exception.type']).toBe('Error');
    expect(event?.attributes?.['exception.message']).toBe('boom');
  });

  it('caps a 100000-character stacktrace at 32 KiB and marks it truncated', async () => {
    const { exporters, seen } = capturing();
    const handle = startTelemetry({ ...BASE, exporters });
    const error = new Error('big');
    error.stack = 'a'.repeat(100_000);
    const span = trace.getTracer('raw').startSpan('big-stack');
    span.recordException(error);
    span.end();
    await handle.shutdown();
    const attrs = seen.spans.find((s) => s.name === 'big-stack')?.events[0]?.attributes ?? {};
    // The stacktrace is ASCII, so its character count equals its byte count.
    expect(String(attrs['exception.stacktrace']).length).toBe(CONTENT_CAP_BYTES);
    expect(attrs['exception.stacktrace.bytes']).toBe(100_000);
    expect(attrs['exception.stacktrace.truncated']).toBe(true);
  });
});

describe('exception attributes on log records', () => {
  it('caps a 100000-character stacktrace on a log record too', async () => {
    const { exporters, seen } = capturing();
    const handle = startTelemetry({ ...BASE, exporters });
    logs.getLogger('raw').emit({
      body: 'failed',
      attributes: { 'exception.type': 'Error', 'exception.stacktrace': 'b'.repeat(100_000) },
    });
    await handle.shutdown();
    expect(seen.logs).toHaveLength(1);
    const attrs = seen.logs[0]?.attributes ?? {};
    expect(attrs['exception.type']).toBe('Error');
    expect(String(attrs['exception.stacktrace']).length).toBe(CONTENT_CAP_BYTES);
    expect(attrs['exception.stacktrace.truncated']).toBe(true);
  });
});
