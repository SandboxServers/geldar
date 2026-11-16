import { describe, expect, it, vi } from 'vitest';
import { EXPORT_TIMEOUT_MS, startTelemetry } from '../src/sdk.ts';

// Each mocked exporter records the options it was built with and answers at once (code 0 = SUCCESS).
const built = vi.hoisted(() => ({
  traces: [] as unknown[],
  logs: [] as unknown[],
  metrics: [] as unknown[],
}));

vi.mock('@opentelemetry/exporter-trace-otlp-proto', () => ({
  OTLPTraceExporter: class {
    constructor(options: unknown) {
      built.traces.push(options);
    }
    export(_spans: unknown, done: (result: { code: number }) => void) {
      done({ code: 0 });
    }
    shutdown(): Promise<void> {
      return Promise.resolve();
    }
  },
}));

vi.mock('@opentelemetry/exporter-logs-otlp-proto', () => ({
  OTLPLogExporter: class {
    constructor(options: unknown) {
      built.logs.push(options);
    }
    export(_records: unknown, done: (result: { code: number }) => void) {
      done({ code: 0 });
    }
    shutdown(): Promise<void> {
      return Promise.resolve();
    }
  },
}));

vi.mock('@opentelemetry/exporter-metrics-otlp-proto', () => ({
  OTLPMetricExporter: class {
    constructor(options: unknown) {
      built.metrics.push(options);
    }
    export(_metrics: unknown, done: (result: { code: number }) => void) {
      done({ code: 0 });
    }
    forceFlush(): Promise<void> {
      return Promise.resolve();
    }
    shutdown(): Promise<void> {
      return Promise.resolve();
    }
  },
}));

describe('OTLP exporter timeout', () => {
  it('builds every OTLP exporter with timeoutMillis equal to EXPORT_TIMEOUT_MS', async () => {
    expect(EXPORT_TIMEOUT_MS).toBe(5_000);
    const handle = startTelemetry({
      service: 'geldar-test',
      version: '0.0.0',
      endpoint: 'http://127.0.0.1:4318',
    });
    expect(handle.enabled).toBe(true);
    expect(built.traces).toEqual([
      expect.objectContaining({
        url: 'http://127.0.0.1:4318/v1/traces',
        timeoutMillis: EXPORT_TIMEOUT_MS,
      }),
    ]);
    expect(built.logs).toEqual([
      expect.objectContaining({
        url: 'http://127.0.0.1:4318/v1/logs',
        timeoutMillis: EXPORT_TIMEOUT_MS,
      }),
    ]);
    expect(built.metrics).toEqual([
      expect.objectContaining({
        url: 'http://127.0.0.1:4318/v1/metrics',
        timeoutMillis: EXPORT_TIMEOUT_MS,
      }),
    ]);
    await handle.shutdown();
  });
});
