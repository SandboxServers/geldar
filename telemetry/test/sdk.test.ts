import { ExportResultCode } from '@opentelemetry/core';
import type { LogRecordExporter } from '@opentelemetry/sdk-logs';
import type { PushMetricExporter } from '@opentelemetry/sdk-metrics';
import type { SpanExporter } from '@opentelemetry/sdk-trace';
import { describe, expect, it, vi } from 'vitest';
import { startTelemetry, type TelemetryExporters } from '../src/sdk.ts';
import { CEILING_MS } from './timing.ts';

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
  it('is completely off when the endpoint is unset: no provider, no export, no timer, no fetch', async () => {
    const exportSpy = vi.fn();
    const shutdownSpy = vi.fn(async () => {});
    // Injected exporters that count every call. The off path must never reach them.
    const exporters: TelemetryExporters = {
      traces: { export: exportSpy, shutdown: shutdownSpy },
      logs: { export: exportSpy, shutdown: shutdownSpy } as unknown as LogRecordExporter,
      metrics: {
        export: exportSpy,
        forceFlush: shutdownSpy,
        shutdown: shutdownSpy,
      } as unknown as PushMetricExporter,
    };
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const intervalSpy = vi.spyOn(globalThis, 'setInterval');
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    try {
      const off = startTelemetry({ ...BASE, exporters });
      expect(off.enabled).toBe(false);
      expect(off.tracerProvider).toBeUndefined();
      // Blank endpoints are off too, and each returns the same shared off handle.
      for (const endpoint of ['', '   ']) {
        expect(startTelemetry({ ...BASE, endpoint, exporters })).toBe(off);
      }
      await off.shutdown();
      expect(exportSpy).not.toHaveBeenCalled();
      expect(shutdownSpy).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(intervalSpy).not.toHaveBeenCalled();
      expect(timeoutSpy).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
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

  it('never blocks the caller when the exporter never answers', async () => {
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
    expect(Date.now() - started).toBeLessThan(CEILING_MS);
    // Shutdown with a dead exporter is bounded by the shutdown limit: run it on fake timers.
    vi.useFakeTimers();
    try {
      const stopped = handle.shutdown();
      await vi.advanceTimersByTimeAsync(10_000);
      await stopped;
    } finally {
      vi.useRealTimers();
    }
  });
});
