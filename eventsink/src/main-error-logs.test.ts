import { afterEach, describe, expect, it } from 'vitest';
import type { SinkConfig } from './config.ts';
import { consumerOptions, type ErrorLogs, startErrorLogs } from './main.ts';

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
