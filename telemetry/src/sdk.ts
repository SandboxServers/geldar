// SDK setup for traces, logs and metrics over OTLP/HTTP (protobuf). No NodeSDK, no auto-instrumentation.
// Off (no providers, no timers, no network, no-op API) when no endpoint is given.

import { randomUUID } from 'node:crypto';
import { context, logs, metrics, propagation, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-proto';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-proto';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  BatchLogRecordProcessor,
  LoggerProvider,
  type LogRecordExporter,
} from '@opentelemetry/sdk-logs';
import {
  MeterProvider,
  PeriodicExportingMetricReader,
  type PushMetricExporter,
} from '@opentelemetry/sdk-metrics';
import { BatchSpanProcessor, type SpanExporter, TracerProvider } from '@opentelemetry/sdk-trace';
import { allowLogKeys } from './attributes.ts';
import {
  AllowListLogProcessor,
  AllowListSpanProcessor,
  metricLabelProcessor,
} from './sdk-processors.ts';

export interface QueueLimits {
  /** Spans or log records held before new ones are dropped. */
  maxQueueSize: number;
  maxExportBatchSize: number;
}

/** Test seam: replaces the OTLP exporters. Production code never passes this. */
export interface TelemetryExporters {
  traces?: SpanExporter;
  logs?: LogRecordExporter;
  metrics?: PushMetricExporter;
}

export interface TelemetryOptions {
  service: string;
  version: string;
  environment?: string;
  /** Shard name, carried as the `geldar.shard` resource attribute. Unset or blank leaves it off. */
  shard?: string;
  /** Test seam: the `service.instance.id`. Unset means a fresh random UUID for each start. */
  instanceId?: string;
  /** Base URL of the collector. Unset or blank turns telemetry off completely. */
  endpoint?: string | undefined;
  limits?: Partial<QueueLimits>;
  exporters?: TelemetryExporters;
  /**
   * Which signals to run; each defaults to on. A signal set to false gets no provider, no exporter
   * and no timer, and its global API stays a no-op. Context and propagator are always installed.
   */
  signals?: { traces?: boolean; metrics?: boolean; logs?: boolean };
  /**
   * Extra log-record keys this service may ship on top of the allow-list. Process-wide, so one SDK per
   * process. Only log records read them; the credential deny rule still drops forbidden names.
   */
  extraKeys?: readonly string[];
}

export interface TelemetryHandle {
  enabled: boolean;
  /** The provider this handle owns (not the global one). Undefined when off. */
  tracerProvider: TracerProvider | undefined;
  shutdown(): Promise<void>;
}

export const EXPORT_TIMEOUT_MS = 5_000;
const METRIC_INTERVAL_MS = 30_000;
const DEFAULT_LIMITS: QueueLimits = { maxQueueSize: 512, maxExportBatchSize: 128 };
const OFF: TelemetryHandle = {
  enabled: false,
  tracerProvider: undefined,
  shutdown: async () => {},
};

interface Stoppable {
  shutdown(): Promise<void>;
}

/** Shuts providers down, giving up after twice the export timeout so a dead collector cannot hang exit. */
async function shutdownAll(providers: Stoppable[]): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, 2 * EXPORT_TIMEOUT_MS);
    timer.unref();
  });
  const done = Promise.allSettled(providers.map((p) => Promise.resolve().then(() => p.shutdown())));
  await Promise.race([done.then(() => undefined), limit]);
  clearTimeout(timer);
}

/** The OTLP/HTTP URL for one signal. Trailing slashes on the endpoint are dropped before `/v1/<signal>`. */
export function signalUrl(endpoint: string, signal: 'traces' | 'logs' | 'metrics'): string {
  return `${endpoint.replace(/\/+$/, '')}/v1/${signal}`;
}

/** True only for an absolute http or https URL. Throws for a bare host, which the setup catch handles. */
function hasHttpScheme(endpoint: string): boolean {
  const { protocol } = new URL(endpoint);
  return protocol === 'http:' || protocol === 'https:';
}

/** The running SDK, so a second start returns it instead of building providers again. */
let active: TelemetryHandle | undefined;

/**
 * Starts the SDK. Never throws: any setup failure writes one stderr line (no URL) and returns the
 * off handle. A second call while the SDK runs returns the running handle.
 */
export function startTelemetry(options: TelemetryOptions): TelemetryHandle {
  const endpoint = options.endpoint?.trim();
  if (!endpoint) return OFF;
  if (active) return active;
  try {
    // Only http(s) is a collector. Anything else with a scheme (ftp:, otel-gateway:4318) is off.
    if (!hasHttpScheme(endpoint)) return OFF;
    const limits = { ...DEFAULT_LIMITS, ...options.limits };
    const exporters = options.exporters ?? {};
    // Resource attributes are shared by every signal, so they carry no life or player identifier.
    const shard = options.shard?.trim();
    const resource = resourceFromAttributes({
      'service.name': options.service,
      'service.version': options.version,
      'service.namespace': 'geldar',
      'service.instance.id': options.instanceId ?? randomUUID(),
      'deployment.environment.name': options.environment ?? 'colo',
      ...(shard ? { 'geldar.shard': shard } : {}),
    });
    const queue = {
      maxQueueSize: limits.maxQueueSize,
      maxExportBatchSize: limits.maxExportBatchSize,
      exportTimeoutMillis: EXPORT_TIMEOUT_MS,
    };
    const on = {
      traces: options.signals?.traces ?? true,
      metrics: options.signals?.metrics ?? true,
      logs: options.signals?.logs ?? true,
    };
    // A signal that is off gets no exporter, so no network client is built for it.
    const traces = on.traces
      ? (exporters.traces ??
        new OTLPTraceExporter({
          url: signalUrl(endpoint, 'traces'),
          timeoutMillis: EXPORT_TIMEOUT_MS,
        }))
      : undefined;
    const logExporter = on.logs
      ? (exporters.logs ??
        new OTLPLogExporter({ url: signalUrl(endpoint, 'logs'), timeoutMillis: EXPORT_TIMEOUT_MS }))
      : undefined;
    const metricExporter = on.metrics
      ? (exporters.metrics ??
        new OTLPMetricExporter({
          url: signalUrl(endpoint, 'metrics'),
          timeoutMillis: EXPORT_TIMEOUT_MS,
        }))
      : undefined;

    // Every signal passes the allow-list inside the SDK, so raw API calls are filtered too.
    const tracerProvider = traces
      ? new TracerProvider({
          resource,
          spanProcessors: [
            new AllowListSpanProcessor(new BatchSpanProcessor({ exporter: traces, ...queue })),
          ],
        })
      : undefined;
    const loggerProvider = logExporter
      ? new LoggerProvider({
          resource,
          processors: [
            new AllowListLogProcessor(
              new BatchLogRecordProcessor({ exporter: logExporter, ...queue }),
            ),
          ],
        })
      : undefined;
    const meterProvider = metricExporter
      ? new MeterProvider({
          resource,
          views: [{ instrumentName: '*', attributesProcessors: [metricLabelProcessor] }],
          readers: [
            new PeriodicExportingMetricReader({
              exporter: metricExporter,
              exportIntervalMillis: METRIC_INTERVAL_MS,
              exportTimeoutMillis: EXPORT_TIMEOUT_MS,
            }),
          ],
        })
      : undefined;
    // Providers this start built, in shutdown order. A signal that is off contributes none.
    const made: Stoppable[] = [];
    for (const provider of [tracerProvider, loggerProvider, meterProvider]) {
      if (provider) made.push(provider);
    }

    // Each global is registered once per process. A false return means another provider already owns it.
    // Only the globals of signals that are on are registered, checked and cleared.
    const registered: Array<{ ok: boolean; clear: () => void }> = [];
    if (tracerProvider) {
      registered.push({
        ok: trace.setGlobalTracerProvider(tracerProvider),
        clear: () => trace.disable(),
      });
    }
    if (loggerProvider) {
      registered.push({
        ok: logs.setGlobalLoggerProvider(loggerProvider),
        clear: () => logs.disable(),
      });
    }
    if (meterProvider) {
      registered.push({
        ok: metrics.setGlobalMeterProvider(meterProvider),
        clear: () => metrics.disable(),
      });
    }
    // W3C trace context only: no Baggage propagator is ever installed.
    registered.push({
      ok: propagation.setGlobalPropagator(new W3CTraceContextPropagator()),
      clear: () => propagation.disable(),
    });
    registered.push({
      ok: context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable()),
      clear: () => context.disable(),
    });
    if (!registered.every((entry) => entry.ok)) {
      // Undo only what this start registered: the foreign owner's globals stay as they are.
      for (const entry of registered) if (entry.ok) entry.clear();
      void shutdownAll(made);
      // One line, no URL, as with the setup failure above.
      process.stderr.write(
        'telemetry: another OpenTelemetry provider owns the global API; telemetry is off\n',
      );
      return OFF;
    }

    // The first shutdown's promise. A second call gets the same promise, so it neither runs again
    // (it cannot clear the globals of a later start) nor returns before the flush has finished.
    let stopping: Promise<void> | undefined;
    const run = async (): Promise<void> => {
      if (active === handle) active = undefined;
      // Clears only the globals this start registered, so a signal that is off leaves others alone.
      for (const entry of registered) entry.clear();
      await shutdownAll(made);
    };
    const handle: TelemetryHandle = {
      enabled: true,
      tracerProvider,
      shutdown: () => {
        stopping ??= run();
        return stopping;
      },
    };
    // Only a running SDK widens the log allow-list, so an off start (no endpoint, a failed setup or a
    // foreign global owner) adds no keys. Set after the registration check, before the handle is kept.
    if (options.extraKeys !== undefined) allowLogKeys(options.extraKeys);
    active = handle;
    return handle;
  } catch {
    // One line, no URL: the endpoint may carry credentials or internal hostnames.
    process.stderr.write('telemetry: SDK setup failed; telemetry is off\n');
    return OFF;
  }
}
