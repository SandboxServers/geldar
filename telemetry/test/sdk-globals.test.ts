import { propagation } from '@opentelemetry/api';
import { ExportResultCode } from '@opentelemetry/core';
import type { LogRecordExporter } from '@opentelemetry/sdk-logs';
import type { PushMetricExporter } from '@opentelemetry/sdk-metrics';
import type { ReadableSpan } from '@opentelemetry/sdk-trace';
import { describe, expect, it } from 'vitest';
import { startTelemetry, type TelemetryExporters } from '../src/sdk.ts';

const ENDPOINT = 'http://127.0.0.1:4318';

// Traces are recorded into `spans`; logs and metrics answer at once.
function exporters(spans: ReadableSpan[]): TelemetryExporters {
  return {
    traces: {
      export(batch, done) {
        spans.push(...batch);
        done({ code: ExportResultCode.SUCCESS });
      },
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

// One start per file: the OTel API keeps the first global propagator and providers it is given.
describe('global propagator', () => {
  it('installs W3C trace context only: fields are traceparent and tracestate, never baggage', async () => {
    const handle = startTelemetry({
      service: 'geldar-test',
      version: '0.0.0',
      endpoint: ENDPOINT,
      exporters: exporters([]),
    });
    expect(propagation.fields()).toEqual(['traceparent', 'tracestate']);
    await handle.shutdown();
  });
});

describe('resource attributes', () => {
  it('sets service.name and service.version from the options', async () => {
    const spans: ReadableSpan[] = [];
    const handle = startTelemetry({
      service: 'geldar-svc',
      version: '9.9.9',
      endpoint: ENDPOINT,
      exporters: exporters(spans),
    });
    handle.tracerProvider?.getTracer('t').startSpan('turn').end();
    await handle.shutdown();
    expect(spans[0]?.resource.attributes).toMatchObject({
      'service.name': 'geldar-svc',
      'service.version': '9.9.9',
    });
  });
});
