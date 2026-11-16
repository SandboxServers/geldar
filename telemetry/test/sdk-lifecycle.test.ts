import { ExportResultCode } from '@opentelemetry/core';
import type { LogRecordExporter } from '@opentelemetry/sdk-logs';
import type { PushMetricExporter } from '@opentelemetry/sdk-metrics';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startTelemetry, type TelemetryExporters } from '../src/sdk.ts';

const ENDPOINT = 'http://127.0.0.1:4318';
const BASE = { service: 'geldar-test', version: '0.0.0' };

// Exporters that answer at once.
function answering(): TelemetryExporters {
  return {
    traces: {
      export: (_s, done) => done({ code: ExportResultCode.SUCCESS }),
      shutdown: async () => {},
    },
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

// Exporters that never answer: no export callback, no shutdown promise settles.
function silent(): TelemetryExporters {
  const never = () => new Promise<void>(() => {});
  return {
    traces: { export: () => {}, shutdown: never },
    logs: { export: () => {}, shutdown: never } as unknown as LogRecordExporter,
    metrics: {
      export: () => {},
      forceFlush: never,
      shutdown: never,
    } as unknown as PushMetricExporter,
  };
}

describe('startTelemetry lifecycle', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('a second start returns the running handle instead of building new providers', async () => {
    const first = startTelemetry({ ...BASE, endpoint: ENDPOINT, exporters: answering() });
    const again = startTelemetry({
      ...BASE,
      endpoint: 'http://other.example:4318',
      exporters: answering(),
    });
    expect(again).toBe(first);
    expect(again.enabled).toBe(true);
    await first.shutdown();
  });

  it('shutdown clears the running handle so the next start builds a new one', async () => {
    const first = startTelemetry({ ...BASE, endpoint: ENDPOINT, exporters: answering() });
    await first.shutdown();
    const next = startTelemetry({ ...BASE, endpoint: ENDPOINT, exporters: answering() });
    expect(next).not.toBe(first);
    expect(next.enabled).toBe(true);
    await next.shutdown();
  });

  it('shutdown returns within about 10 s when the exporters never answer', async () => {
    vi.useFakeTimers();
    const handle = startTelemetry({ ...BASE, endpoint: ENDPOINT, exporters: silent() });
    expect(handle.enabled).toBe(true);
    let finished = false;
    const stopped = handle.shutdown().then(() => {
      finished = true;
    });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(finished).toBe(true);
    await stopped;
  });
});
