import { ExportResultCode } from '@opentelemetry/core';
import type { LogRecordExporter } from '@opentelemetry/sdk-logs';
import type { PushMetricExporter } from '@opentelemetry/sdk-metrics';
import type { SpanExporter } from '@opentelemetry/sdk-trace';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startTelemetry, type TelemetryExporters } from '../src/sdk.ts';

const BASE = { service: 'geldar-test', version: '0.0.0' };

// Fake exporters that answer at once and never touch the network.
const exporters: TelemetryExporters = {
  traces: {
    export: (_spans, done) => done({ code: ExportResultCode.SUCCESS }),
    shutdown: async () => {},
  } as SpanExporter,
  logs: {
    export: (_records: unknown, done: (r: { code: number }) => void) =>
      done({ code: ExportResultCode.SUCCESS }),
    shutdown: async () => {},
  } as unknown as LogRecordExporter,
  metrics: {
    export: (_metrics: unknown, done: (r: { code: number }) => void) =>
      done({ code: ExportResultCode.SUCCESS }),
    forceFlush: async () => {},
    shutdown: async () => {},
  } as unknown as PushMetricExporter,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('endpoint guard', () => {
  it('an undefined endpoint is off with no stderr line (the guard decides, not the catch)', () => {
    const write = vi.spyOn(process.stderr, 'write');
    const handle = startTelemetry({ ...BASE, endpoint: undefined, exporters });
    expect(handle.enabled).toBe(false);
    expect(handle.tracerProvider).toBeUndefined();
    expect(write).not.toHaveBeenCalled();
  });

  it.each(['', '   '])('blank endpoint %j is off with no stderr line', (endpoint) => {
    const write = vi.spyOn(process.stderr, 'write');
    expect(startTelemetry({ ...BASE, endpoint, exporters }).enabled).toBe(false);
    expect(write).not.toHaveBeenCalled();
  });

  it.each(['ftp://x', 'otel-gateway:4318'])(
    'non-http(s) scheme %s is off with no stderr line',
    (endpoint) => {
      const write = vi.spyOn(process.stderr, 'write');
      expect(startTelemetry({ ...BASE, endpoint, exporters }).enabled).toBe(false);
      expect(write).not.toHaveBeenCalled();
    },
  );

  it('a bare host with no scheme is off', () => {
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    expect(startTelemetry({ ...BASE, endpoint: 'otel-gateway', exporters }).enabled).toBe(false);
  });

  it.each(['http://127.0.0.1:4318', 'https://otel.example:4318/'])(
    'http(s) endpoint %s is accepted',
    async (endpoint) => {
      const handle = startTelemetry({ ...BASE, endpoint, exporters });
      expect(handle.enabled).toBe(true);
      await handle.shutdown();
    },
  );
});

describe('setup failure', () => {
  it('writes one stderr line without the URL and returns off', () => {
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const handle = startTelemetry({
      service: 'geldar-test',
      endpoint: 'http://collector.internal.example:4318/secret-path',
      exporters,
      get version(): string {
        throw new Error('setup boom');
      },
    });
    expect(handle.enabled).toBe(false);
    expect(write).toHaveBeenCalledTimes(1);
    const line = String(write.mock.calls[0]?.[0]);
    expect(line).not.toContain('collector.internal');
    expect(line).not.toContain('secret-path');
    expect(line.indexOf('\n')).toBe(line.length - 1);
  });
});
