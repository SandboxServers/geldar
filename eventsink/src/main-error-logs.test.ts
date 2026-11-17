import type { TelemetryExporters } from '@geldar/telemetry';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SinkConfig } from './config.ts';
import {
  boundedStop,
  consumerOptions,
  type ErrorLogs,
  exitAfterFlush,
  SERVICE_NAME,
  startErrorLogs,
} from './main.ts';

const CONFIG = { batchSize: 10, fetchWaitMs: 1000 } as unknown as SinkConfig;

describe('startErrorLogs', () => {
  let started: ErrorLogs | undefined;
  afterEach(async () => {
    await started?.stop();
    started = undefined;
  });

  it('returns nothing without GELDAR_TELEMETRY_URL, blank or unusable', () => {
    expect(startErrorLogs({})).toBeUndefined();
    expect(startErrorLogs({ GELDAR_TELEMETRY_URL: '   ' })).toBeUndefined();
    expect(startErrorLogs({ GELDAR_TELEMETRY_URL: 'ftp://127.0.0.1:9' })).toBeUndefined();
  });

  it('returns an error log that does not throw when the URL is set', () => {
    started = startErrorLogs({ GELDAR_TELEMETRY_URL: 'http://127.0.0.1:9' });
    expect(started).toBeDefined();
    expect(() => started?.errorLog('dead_letter', { subject: 's', reason: 'r' })).not.toThrow();
  });
});

interface SeenRecord {
  attributes: Record<string, unknown>;
  resource: { attributes: Record<string, unknown> };
}

/** A log exporter that records what the SDK hands it; `silent` never answers and never shuts down. */
function fakeLogs(silent = false) {
  const seen: SeenRecord[] = [];
  const logs = {
    export(records: SeenRecord[], done: (result: unknown) => void) {
      seen.push(...records);
      if (!silent) done({ code: 0 });
    },
    shutdown: () => (silent ? new Promise<void>(() => {}) : Promise.resolve()),
    forceFlush: () => (silent ? new Promise<void>(() => {}) : Promise.resolve()),
  } as unknown as NonNullable<TelemetryExporters['logs']>;
  return { seen, exporters: { logs } satisfies TelemetryExporters };
}

const URL_ENV = { GELDAR_TELEMETRY_URL: 'http://127.0.0.1:9' };

describe('exported error log records', () => {
  it('carry reason, subject, trace_id, delivery_count, batch_size and event, and drop the rest', async () => {
    const fake = fakeLogs();
    const started = startErrorLogs(URL_ENV, fake.exporters);
    started?.errorLog('dead_letter', {
      reason: 'bad',
      subject: 'geldar.phase0.damage',
      trace_id: 'a'.repeat(32),
      delivery_count: 3,
      batch_size: 7,
      event_body: 'SECRET-BODY',
      password: 'p',
    });
    await started?.stop();
    expect(fake.seen).toHaveLength(1);
    const attrs = fake.seen[0]?.attributes ?? {};
    expect(Object.keys(attrs).sort()).toEqual(
      ['batch_size', 'delivery_count', 'event', 'reason', 'subject', 'trace_id'].sort(),
    );
    expect(attrs.event).toBe('dead_letter');
    expect(attrs.subject).toBe('geldar.phase0.damage');
    expect(attrs.delivery_count).toBe(3);
    expect(fake.seen[0]?.resource.attributes['service.name']).toBe(SERVICE_NAME);
  });

  it('uses the one service name geldar-eventsink', () => {
    expect(SERVICE_NAME).toBe('geldar-eventsink');
  });
});

describe('bounded telemetry flush', () => {
  it('boundedStop returns within its bound when a stop never resolves', async () => {
    const started = performance.now();
    await boundedStop([() => new Promise<void>(() => {})], 100);
    const elapsed = performance.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(90);
    expect(elapsed).toBeLessThan(1000);
  });

  it('boundedStop does not reject when a stop throws or rejects', async () => {
    await expect(
      boundedStop([() => Promise.reject(new Error('x')), undefined, () => 1 as never], 100),
    ).resolves.toBeUndefined();
  });

  it('the fatal exit calls exit(1) within the bound while the exporter never answers', async () => {
    const fake = fakeLogs(true);
    const started = startErrorLogs(URL_ENV, fake.exporters);
    started?.errorLog('fetch_failed', { reason: 'r' });
    const exit = vi.fn();
    const began = performance.now();
    await exitAfterFlush(started, exit, 150);
    expect(performance.now() - began).toBeLessThan(1500);
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('the fatal exit flushes the pending record before it exits', async () => {
    const fake = fakeLogs();
    const started = startErrorLogs(URL_ENV, fake.exporters);
    started?.errorLog('fetch_failed', { reason: 'last words' });
    const order: string[] = [];
    await exitAfterFlush(
      started,
      (code) => order.push(`exit ${code} after ${fake.seen.length}`),
      1000,
    );
    expect(order).toEqual(['exit 1 after 1']);
  });

  it('the fatal exit still exits when the flush rejects, and with no error logs at all', async () => {
    const exit = vi.fn();
    await exitAfterFlush(
      { errorLog: () => undefined, stop: () => Promise.reject(new Error('down')) },
      exit,
      100,
    );
    await exitAfterFlush(undefined, exit, 100);
    expect(exit).toHaveBeenCalledTimes(2);
  });
});

describe('consumerOptions error log', () => {
  it('passes the error log only when there is one', () => {
    const errorLog = () => undefined;
    const withLog = consumerOptions(CONFIG, undefined, () => undefined, {
      errorLog,
      stop: async () => undefined,
    });
    expect(withLog.errorLog).toBe(errorLog);
    expect('errorLog' in consumerOptions(CONFIG, undefined, () => undefined)).toBe(false);
  });
});
