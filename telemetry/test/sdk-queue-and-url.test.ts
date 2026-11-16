import { ExportResultCode } from '@opentelemetry/core';
import type { LogRecordExporter } from '@opentelemetry/sdk-logs';
import type { PushMetricExporter } from '@opentelemetry/sdk-metrics';
import type { SpanExporter } from '@opentelemetry/sdk-trace';
import { describe, expect, it } from 'vitest';
import { signalUrl, startTelemetry, type TelemetryExporters } from '../src/sdk.ts';

const noopLogs = {
  export: (_r: unknown, done: (r: { code: number }) => void) =>
    done({ code: ExportResultCode.SUCCESS }),
  shutdown: async () => {},
} as unknown as LogRecordExporter;
const noopMetrics = {
  export: (_m: unknown, done: (r: { code: number }) => void) =>
    done({ code: ExportResultCode.SUCCESS }),
  forceFlush: async () => {},
  shutdown: async () => {},
} as unknown as PushMetricExporter;

describe('collector URLs', () => {
  it('drops trailing slashes so no double slash reaches the signal path', () => {
    expect(signalUrl('http://h:4318//', 'traces')).toBe('http://h:4318/v1/traces');
    expect(signalUrl('http://h:4318/', 'logs')).toBe('http://h:4318/v1/logs');
    expect(signalUrl('http://h:4318', 'metrics')).toBe('http://h:4318/v1/metrics');
  });
});

describe('default queue bound', () => {
  it('holds 512 queued spans beyond the 128 in flight, and drops the next one', async () => {
    // The first export is held (its callback is kept), so spans pile up behind it. Every span is
    // recorded when the exporter receives it; the held batch's callback is released later.
    const received: string[] = [];
    let release: (() => void) | undefined;
    const traces: SpanExporter = {
      export(batch, done) {
        received.push(...batch.map((span) => span.name));
        if (release === undefined) {
          release = () => done({ code: ExportResultCode.SUCCESS });
          return;
        }
        done({ code: ExportResultCode.SUCCESS });
      },
      shutdown: async () => {},
    };
    const exporters: TelemetryExporters = { traces, logs: noopLogs, metrics: noopMetrics };
    const handle = startTelemetry({
      service: 'geldar-test',
      version: '0.0.0',
      endpoint: 'http://127.0.0.1:4318',
      exporters,
    });
    const tracer = handle.tracerProvider?.getTracer('queue');
    for (let i = 1; i <= 641; i += 1) tracer?.startSpan(`s${i}`).end();
    release?.();
    await handle.shutdown();
    expect(received).toHaveLength(640);
    expect(received).toContain('s640');
    expect(received).not.toContain('s641');
  });
});
