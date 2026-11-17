import { ExportResultCode } from '@opentelemetry/core';
import type { LogRecordExporter } from '@opentelemetry/sdk-logs';
import type { PushMetricExporter } from '@opentelemetry/sdk-metrics';
import { describe, expect, it } from 'vitest';
import { startTelemetry, type TelemetryExporters } from '../src/sdk.ts';

function blockedExporters(gate: Promise<void>): TelemetryExporters {
  const ok = (done: (r: { code: number }) => void) => done({ code: ExportResultCode.SUCCESS });
  return {
    traces: {
      export: (_s, done) => ok(done),
      shutdown: () => gate,
    },
    logs: {
      export: (_r: unknown, done: (r: { code: number }) => void) => ok(done),
      shutdown: () => gate,
    } as unknown as LogRecordExporter,
    metrics: {
      export: (_m: unknown, done: (r: { code: number }) => void) => ok(done),
      forceFlush: async () => {},
      shutdown: () => gate,
    } as unknown as PushMetricExporter,
  };
}

describe('concurrent shutdown', () => {
  it('a second shutdown stays pending until the first has finished', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const handle = startTelemetry({
      service: 'geldar-test',
      version: '0.0.0',
      endpoint: 'http://127.0.0.1:4318',
      exporters: blockedExporters(gate),
    });
    expect(handle.enabled).toBe(true);
    let firstDone = false;
    let secondDone = false;
    const first = handle.shutdown().then(() => {
      firstDone = true;
    });
    const second = handle.shutdown().then(() => {
      secondDone = true;
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(firstDone).toBe(false);
    expect(secondDone).toBe(false);
    release();
    await Promise.all([first, second]);
    expect(firstDone).toBe(true);
    expect(secondDone).toBe(true);
  });
});
