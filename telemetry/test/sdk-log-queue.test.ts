import { logs } from '@opentelemetry/api';
import { ExportResultCode } from '@opentelemetry/core';
import type { LogRecordExporter } from '@opentelemetry/sdk-logs';
import type { PushMetricExporter } from '@opentelemetry/sdk-metrics';
import type { SpanExporter } from '@opentelemetry/sdk-trace';
import { describe, expect, it, vi } from 'vitest';
import { startTelemetry } from '../src/sdk.ts';

// One start per file: the OTel API keeps the first global logger provider it is given.
describe('log queue bound', () => {
  it('drops log records when the queue is full instead of growing without bound', async () => {
    // Fake timers run the batch processor's scheduled flushes, so every batch that was queued exports.
    vi.useFakeTimers();
    try {
      const exported: unknown[] = [];
      const logExporter = {
        export(records: unknown[], done: (r: { code: number }) => void) {
          exported.push(...records);
          done({ code: ExportResultCode.SUCCESS });
        },
        shutdown: async () => {},
      } as unknown as LogRecordExporter;
      const traces: SpanExporter = {
        export: (_s, done) => done({ code: ExportResultCode.SUCCESS }),
        shutdown: async () => {},
      };
      const metrics = {
        export: (_m: unknown, done: (r: { code: number }) => void) =>
          done({ code: ExportResultCode.SUCCESS }),
        forceFlush: async () => {},
        shutdown: async () => {},
      } as unknown as PushMetricExporter;
      const handle = startTelemetry({
        service: 'geldar-test',
        version: '0.0.0',
        endpoint: 'http://127.0.0.1:4318',
        exporters: { traces, logs: logExporter, metrics },
        limits: { maxQueueSize: 4, maxExportBatchSize: 4 },
      });
      const logger = logs.getLogger('t');
      for (let i = 0; i < 100; i++) logger.emit({ body: `r${i}` });
      await vi.advanceTimersByTimeAsync(60_000);
      await handle.shutdown();
      expect(exported.length).toBeGreaterThan(0);
      expect(exported.length).toBeLessThanOrEqual(8);
    } finally {
      vi.useRealTimers();
    }
  });
});
