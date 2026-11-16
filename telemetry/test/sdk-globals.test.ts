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

  it('sets service.namespace, the injected instance id and geldar.shard, never a life or player id', async () => {
    const spans: ReadableSpan[] = [];
    const handle = startTelemetry({
      service: 'geldar-svc',
      version: '9.9.9',
      endpoint: ENDPOINT,
      shard: 'shard-a',
      instanceId: 'inst-1',
      exporters: exporters(spans),
    });
    handle.tracerProvider?.getTracer('t').startSpan('turn').end();
    await handle.shutdown();
    const attrs = spans[0]?.resource.attributes ?? {};
    expect(attrs).toMatchObject({
      'service.namespace': 'geldar',
      'service.instance.id': 'inst-1',
      'geldar.shard': 'shard-a',
    });
    for (const key of ['life_id', 'geldar.life_id', 'player_id', 'geldar.player_id']) {
      expect(attrs).not.toHaveProperty(key);
    }
  });

  it('generates a UUID instance id per start and omits geldar.shard when no shard is given', async () => {
    const spans: ReadableSpan[] = [];
    const handle = startTelemetry({
      service: 'geldar-svc',
      version: '9.9.9',
      endpoint: ENDPOINT,
      exporters: exporters(spans),
    });
    handle.tracerProvider?.getTracer('t').startSpan('turn').end();
    await handle.shutdown();
    const attrs = spans[0]?.resource.attributes ?? {};
    expect(String(attrs['service.instance.id'])).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(attrs).not.toHaveProperty('geldar.shard');
  });
});
