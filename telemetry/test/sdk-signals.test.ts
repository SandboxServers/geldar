import { logs, metrics, trace } from '@opentelemetry/api';
import { ExportResultCode } from '@opentelemetry/core';
import { LoggerProvider, type LogRecordExporter } from '@opentelemetry/sdk-logs';
import { MeterProvider, type PushMetricExporter } from '@opentelemetry/sdk-metrics';
import { TracerProvider } from '@opentelemetry/sdk-trace';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { startTelemetry, type TelemetryExporters, type TelemetryHandle } from '../src/sdk.ts';

// Counts how many tracer, reader, meter and logger providers the SDK builds. Subclasses keep
// the real behaviour; only the constructors are counted.
const built = vi.hoisted(() => ({
  tracerProviders: 0,
  readers: 0,
  meterProviders: 0,
  loggerProviders: 0,
}));

vi.mock('@opentelemetry/sdk-trace', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@opentelemetry/sdk-trace')>();
  class CountingTracerProvider extends actual.TracerProvider {
    constructor(...args: ConstructorParameters<typeof actual.TracerProvider>) {
      super(...args);
      built.tracerProviders++;
    }
  }
  return { ...actual, TracerProvider: CountingTracerProvider };
});

vi.mock('@opentelemetry/sdk-metrics', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@opentelemetry/sdk-metrics')>();
  class CountingReader extends actual.PeriodicExportingMetricReader {
    constructor(...args: ConstructorParameters<typeof actual.PeriodicExportingMetricReader>) {
      super(...args);
      built.readers++;
    }
  }
  class CountingMeterProvider extends actual.MeterProvider {
    constructor(...args: ConstructorParameters<typeof actual.MeterProvider>) {
      super(...args);
      built.meterProviders++;
    }
  }
  return {
    ...actual,
    PeriodicExportingMetricReader: CountingReader,
    MeterProvider: CountingMeterProvider,
  };
});

vi.mock('@opentelemetry/sdk-logs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@opentelemetry/sdk-logs')>();
  class CountingLoggerProvider extends actual.LoggerProvider {
    constructor(...args: ConstructorParameters<typeof actual.LoggerProvider>) {
      super(...args);
      built.loggerProviders++;
    }
  }
  return { ...actual, LoggerProvider: CountingLoggerProvider };
});

const ENDPOINT = 'http://127.0.0.1:4318';

// Fake exporters that count each export call. None of them touches the network.
function fakeExporters(): { exporters: TelemetryExporters; calls: Record<string, number> } {
  const calls = { traces: 0, logs: 0, metrics: 0 };
  const ok = (done: (r: { code: number }) => void) => done({ code: ExportResultCode.SUCCESS });
  const exporters: TelemetryExporters = {
    traces: {
      export(_spans, done) {
        calls.traces++;
        ok(done);
      },
      shutdown: async () => {},
    },
    logs: {
      export(_records: unknown, done: (r: { code: number }) => void) {
        calls.logs++;
        ok(done);
      },
      shutdown: async () => {},
    } as unknown as LogRecordExporter,
    metrics: {
      export(_batch: unknown, done: (r: { code: number }) => void) {
        calls.metrics++;
        ok(done);
      },
      forceFlush: async () => {},
      shutdown: async () => {},
    } as unknown as PushMetricExporter,
  };
  return { exporters, calls };
}

// Each test starts with no global API registered, so a previous test cannot leak a provider in.
beforeEach(() => {
  trace.disable();
  logs.disable();
  metrics.disable();
  built.tracerProviders = 0;
  built.readers = 0;
  built.meterProviders = 0;
  built.loggerProviders = 0;
});

// Emits one span, one log record and one counter sample through whatever globals are registered.
function emitOneOfEach(handle: TelemetryHandle): void {
  handle.tracerProvider?.getTracer('t').startSpan('turn').end();
  logs.getLogger('t').emit({ body: 'line' });
  metrics.getMeter('t').createCounter('c').add(1);
}

describe('signals option', () => {
  it('builds all three signals by default and exports metrics and logs on shutdown', async () => {
    const { exporters, calls } = fakeExporters();
    const handle = startTelemetry({
      service: 'geldar-test',
      version: '0.0.0',
      endpoint: ENDPOINT,
      exporters,
    });
    try {
      expect(handle.enabled).toBe(true);
      expect(handle.tracerProvider).toBeDefined();
      expect(built).toEqual({
        tracerProviders: 1,
        readers: 1,
        meterProviders: 1,
        loggerProviders: 1,
      });
      expect(metrics.getMeterProvider()).toBeInstanceOf(MeterProvider);
      emitOneOfEach(handle);
    } finally {
      await handle.shutdown();
    }
    // Positive control: the fakes do see exports when the signals are on.
    expect(calls.metrics).toBeGreaterThan(0);
    expect(calls.logs).toBeGreaterThan(0);
    expect(calls.traces).toBeGreaterThan(0);
  });

  it('with metrics and logs off, builds no meter provider, reader or logger provider and exports neither', async () => {
    const { exporters, calls } = fakeExporters();
    const handle = startTelemetry({
      service: 'geldar-test',
      version: '0.0.0',
      endpoint: ENDPOINT,
      exporters,
      signals: { metrics: false, logs: false },
    });
    try {
      expect(handle.enabled).toBe(true);
      expect(handle.tracerProvider).toBeDefined();
      expect(built).toEqual({
        tracerProviders: 1,
        readers: 0,
        meterProviders: 0,
        loggerProviders: 0,
      });
      // No global meter provider was registered: the API still hands out the no-op one.
      expect(metrics.getMeterProvider()).not.toBeInstanceOf(MeterProvider);
      emitOneOfEach(handle);
    } finally {
      await handle.shutdown();
    }
    expect(calls.metrics).toBe(0);
    expect(calls.logs).toBe(0);
    // Traces still run on their own provider.
    expect(calls.traces).toBeGreaterThan(0);
  });

  it('with metrics off, a foreign global meter provider does not stop the start', async () => {
    // A foreign owner already holds the global meter API. With metrics off this start never asks for it.
    const foreign = new MeterProvider();
    expect(metrics.setGlobalMeterProvider(foreign)).toBe(true);
    const { exporters } = fakeExporters();
    const handle = startTelemetry({
      service: 'geldar-test',
      version: '0.0.0',
      endpoint: ENDPOINT,
      exporters,
      signals: { metrics: false },
    });
    try {
      expect(handle.enabled).toBe(true);
      expect(handle.tracerProvider).toBeDefined();
    } finally {
      await handle.shutdown();
    }
    // The foreign owner's global survives this start's shutdown.
    expect(metrics.getMeterProvider()).toBe(foreign);
    await foreign.shutdown();
  });

  it('with traces off, builds no tracer provider, exports no spans and registers no global tracer', async () => {
    const { exporters, calls } = fakeExporters();
    const handle = startTelemetry({
      service: 'geldar-test',
      version: '0.0.0',
      endpoint: ENDPOINT,
      exporters,
      signals: { traces: false },
    });
    try {
      expect(handle.enabled).toBe(true);
      expect(handle.tracerProvider).toBeUndefined();
      expect(built).toEqual({
        tracerProviders: 0,
        readers: 1,
        meterProviders: 1,
        loggerProviders: 1,
      });
      emitOneOfEach(handle);
      // Nothing registered a global tracer: a probe provider is accepted as the first one.
      expect(trace.setGlobalTracerProvider(new TracerProvider())).toBe(true);
    } finally {
      await handle.shutdown();
    }
    expect(calls.traces).toBe(0);
    expect(calls.logs).toBeGreaterThan(0);
    expect(calls.metrics).toBeGreaterThan(0);
  });

  it('with logs off alone, builds no logger provider and exports no log record', async () => {
    const { exporters, calls } = fakeExporters();
    const handle = startTelemetry({
      service: 'geldar-test',
      version: '0.0.0',
      endpoint: ENDPOINT,
      exporters,
      signals: { logs: false },
    });
    try {
      expect(handle.enabled).toBe(true);
      expect(handle.tracerProvider).toBeDefined();
      expect(built).toEqual({
        tracerProviders: 1,
        readers: 1,
        meterProviders: 1,
        loggerProviders: 0,
      });
      emitOneOfEach(handle);
      // Nothing registered a global logger: a probe provider is accepted as the first one.
      expect(logs.setGlobalLoggerProvider(new LoggerProvider())).toBe(true);
    } finally {
      await handle.shutdown();
    }
    expect(calls.logs).toBe(0);
    expect(calls.traces).toBeGreaterThan(0);
    expect(calls.metrics).toBeGreaterThan(0);
  });

  it('with traces off, a foreign global tracer provider does not stop the start and survives shutdown', async () => {
    const foreign = new TracerProvider();
    expect(trace.setGlobalTracerProvider(foreign)).toBe(true);
    const { exporters } = fakeExporters();
    const handle = startTelemetry({
      service: 'geldar-test',
      version: '0.0.0',
      endpoint: ENDPOINT,
      exporters,
      signals: { traces: false },
    });
    try {
      expect(handle.enabled).toBe(true);
      expect(handle.tracerProvider).toBeUndefined();
    } finally {
      await handle.shutdown();
    }
    // The foreign owner still holds the global tracer API: a second registration is refused.
    expect(trace.setGlobalTracerProvider(new TracerProvider())).toBe(false);
  });

  it('with logs off, a foreign global logger provider does not stop the start and survives shutdown', async () => {
    const foreign = new LoggerProvider();
    expect(logs.setGlobalLoggerProvider(foreign)).toBe(true);
    const { exporters } = fakeExporters();
    const handle = startTelemetry({
      service: 'geldar-test',
      version: '0.0.0',
      endpoint: ENDPOINT,
      exporters,
      signals: { logs: false },
    });
    try {
      expect(handle.enabled).toBe(true);
      expect(handle.tracerProvider).toBeDefined();
    } finally {
      await handle.shutdown();
    }
    expect(logs.setGlobalLoggerProvider(new LoggerProvider())).toBe(false);
  });

  it('a second shutdown of a stale handle keeps the globals of the later start', async () => {
    const first = startTelemetry({
      service: 'geldar-test',
      version: '0.0.0',
      endpoint: ENDPOINT,
      exporters: fakeExporters().exporters,
    });
    await first.shutdown();
    const later = startTelemetry({
      service: 'geldar-test',
      version: '0.0.0',
      endpoint: ENDPOINT,
      exporters: fakeExporters().exporters,
    });
    try {
      expect(later.enabled).toBe(true);
      await first.shutdown();
      // The later start still owns all three globals, so each registration attempt is refused.
      expect(trace.setGlobalTracerProvider(new TracerProvider())).toBe(false);
      expect(metrics.setGlobalMeterProvider(new MeterProvider())).toBe(false);
      expect(logs.setGlobalLoggerProvider(new LoggerProvider())).toBe(false);
    } finally {
      await later.shutdown();
    }
  });
});
