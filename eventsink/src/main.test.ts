import { describe, expect, it, vi } from 'vitest';
import type { SinkConfig } from './config.ts';
import { consumerOptions } from './main.ts';
import { EventsinkMetrics, eventsinkTelemetry } from './metrics.ts';

const CONFIG: SinkConfig = {
  natsUrl: 'nats://127.0.0.1:4222',
  pg: { host: '127.0.0.1', port: 5432, user: 'eventsink', database: 'geldar', password: 'x' },
  batchSize: 10,
  fetchWaitMs: 1000,
};

describe('consumerOptions', () => {
  it('passes the metrics to startConsumer when GELDAR_TELEMETRY_URL is set', async () => {
    const telemetry = eventsinkTelemetry(
      { GELDAR_TELEMETRY_URL: 'http://127.0.0.1:9' },
      {
        service: 'eventsink',
        log: vi.fn(),
        intervalMs: 60_000,
        fetch: vi.fn(async () => new Response(null, { status: 200 })),
      },
    );
    const options = consumerOptions(CONFIG, telemetry, () => undefined);
    telemetry?.stop();
    expect(options.metrics).toBeInstanceOf(EventsinkMetrics);
    expect(options.metrics).toBe(telemetry?.metrics);
    expect(options.batchSize).toBe(CONFIG.batchSize);
  });

  it('passes no metrics key when GELDAR_TELEMETRY_URL is unset', () => {
    const telemetry = eventsinkTelemetry({}, { service: 'eventsink', log: vi.fn() });
    const options = consumerOptions(CONFIG, telemetry, () => undefined);
    expect(telemetry).toBeUndefined();
    expect(options).not.toHaveProperty('metrics');
  });
});
