import { ExportResultCode } from '@opentelemetry/core';
import type { LogRecordExporter } from '@opentelemetry/sdk-logs';
import type { PushMetricExporter } from '@opentelemetry/sdk-metrics';
import type { SpanExporter } from '@opentelemetry/sdk-trace';
import { describe, expect, it, vi } from 'vitest';
import { startTelemetry, type TelemetryExporters } from '../src/sdk.ts';

const ENDPOINT = 'http://127.0.0.1:4318';
const BASE = { service: 'geldar-test', version: '0.0.0' };

// Fake exporters record what they receive and never touch the network.
function recorder(): { exporters: TelemetryExporters; spanNames: string[] } {
  const spanNames: string[] = [];
  const traces: SpanExporter = {
    export(spans, done) {
      for (const span of spans) spanNames.push(span.name);
      done({ code: ExportResultCode.SUCCESS });
    },
    shutdown: async () => {},
  };
  const logs = {
    export(_records: unknown, done: (r: { code: number }) => void) {
      done({ code: ExportResultCode.SUCCESS });
    },
    shutdown: async () => {},
  } as unknown as LogRecordExporter;
  const metrics = {
    export(_metrics: unknown, done: (r: { code: number }) => void) {
      done({ code: ExportResultCode.SUCCESS });
    },
    forceFlush: async () => {},
    shutdown: async () => {},
  } as unknown as PushMetricExporter;
  return { exporters: { traces, logs, metrics }, spanNames };
}

describe('startTelemetry off switch', () => {
  it('is completely off when the endpoint is unset: no provider, no export, no fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { exporters, spanNames } = recorder();
    const handle = startTelemetry({ ...BASE, exporters });
    expect(handle.enabled).toBe(false);
    expect(handle.tracerProvider).toBeUndefined();
    await handle.shutdown();
    expect(spanNames).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('treats a blank endpoint as unset', () => {
    const { exporters } = recorder();
    expect(startTelemetry({ ...BASE, endpoint: '   ', exporters }).enabled).toBe(false);
    expect(startTelemetry({ ...BASE, endpoint: '', exporters }).enabled).toBe(false);
  });
});

describe('startTelemetry when on', () => {
  it('exports spans through the batch processor when the endpoint is set', async () => {
    const { exporters, spanNames } = recorder();
    const handle = startTelemetry({ ...BASE, endpoint: ENDPOINT, exporters });
    expect(handle.enabled).toBe(true);
    handle.tracerProvider?.getTracer('t').startSpan('turn').end();
    await handle.shutdown();
    expect(spanNames).toEqual(['turn']);
  });

  it('drops spans when the queue is full instead of growing without bound', async () => {
    const { exporters, spanNames } = recorder();
    const handle = startTelemetry({
      ...BASE,
      endpoint: ENDPOINT,
      exporters,
      limits: { maxQueueSize: 4, maxExportBatchSize: 4 },
    });
    const tracer = handle.tracerProvider?.getTracer('t');
    for (let i = 0; i < 100; i++) tracer?.startSpan(`s${i}`).end();
    await handle.tracerProvider?.forceFlush();
    await handle.shutdown();
    expect(spanNames.length).toBeGreaterThan(0);
    expect(spanNames.length).toBeLessThanOrEqual(8);
  });

  it('never blocks the caller when the exporter never answers', () => {
    const { exporters } = recorder();
    const never: SpanExporter = { export() {}, shutdown: async () => {} };
    const handle = startTelemetry({
      ...BASE,
      endpoint: ENDPOINT,
      exporters: { ...exporters, traces: never },
      limits: { maxQueueSize: 8, maxExportBatchSize: 4 },
    });
    const tracer = handle.tracerProvider?.getTracer('t');
    const started = Date.now();
    for (let i = 0; i < 5000; i++) tracer?.startSpan(`s${i}`).end();
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
