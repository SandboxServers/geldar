import { context, logs, metrics, propagation, trace } from '@opentelemetry/api';
import { ExportResultCode } from '@opentelemetry/core';
import type { LogRecordExporter } from '@opentelemetry/sdk-logs';
import type { PushMetricExporter } from '@opentelemetry/sdk-metrics';
import { type ReadableSpan, type SpanExporter, TracerProvider } from '@opentelemetry/sdk-trace';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { startTelemetry, type TelemetryExporters } from '../src/sdk.ts';

const BASE = { service: 'geldar-test', version: '0.0.0', endpoint: 'http://127.0.0.1:4318' };

// Spans are recorded into `spans`; logs and metrics answer at once.
function exporters(spans: ReadableSpan[]): TelemetryExporters {
  const traces: SpanExporter = {
    export(batch, done) {
      spans.push(...batch);
      done({ code: ExportResultCode.SUCCESS });
    },
    shutdown: async () => {},
  };
  return {
    traces,
    logs: {
      export: (_r: unknown, done: (r: { code: number }) => void) =>
        done({ code: ExportResultCode.SUCCESS }),
      shutdown: async () => {},
    } as unknown as LogRecordExporter,
    metrics: {
      export: (_m: unknown, done: (r: { code: number }) => void) =>
        done({ code: ExportResultCode.SUCCESS }),
      forceFlush: async () => {},
      shutdown: async () => {},
    } as unknown as PushMetricExporter,
  };
}

// Each test starts from an empty global API, as a fresh process would.
beforeEach(() => {
  trace.disable();
  logs.disable();
  metrics.disable();
  propagation.disable();
  context.disable();
});

describe('start, shutdown, start again in one process', () => {
  it('sends a raw API span from the second start to the second exporter', async () => {
    const first: ReadableSpan[] = [];
    const second: ReadableSpan[] = [];
    const before = startTelemetry({ ...BASE, exporters: exporters(first) });
    await before.shutdown();

    const after = startTelemetry({ ...BASE, exporters: exporters(second) });
    expect(after.enabled).toBe(true);
    trace.getTracer('raw').startSpan('after-restart').end();
    await after.shutdown();

    expect(second.map((span) => span.name)).toContain('after-restart');
    expect(first).toHaveLength(0);
  });
});

describe('another provider already owns the global API', () => {
  it('returns the off handle, writes one URL-free stderr line and leaves no globals of its own', async () => {
    trace.setGlobalTracerProvider(new TracerProvider());
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const handle = startTelemetry({ ...BASE, exporters: exporters([]) });
      expect(handle.enabled).toBe(false);
      expect(write).toHaveBeenCalledTimes(1);
      expect(String(write.mock.calls[0]?.[0])).not.toContain('127.0.0.1');
      // Our propagator was registered before the conflict was seen, so it must have been rolled back.
      expect(propagation.fields()).toEqual([]);
      await handle.shutdown();
    } finally {
      write.mockRestore();
    }
  });
});
