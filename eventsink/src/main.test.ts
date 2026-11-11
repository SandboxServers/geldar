import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SinkConfig } from './config.ts';
import { consumerOptions, main } from './main.ts';
import { EventsinkMetrics, eventsinkTelemetry } from './metrics.ts';

// The fakes stand in for the NATS connect and the consumer, so main() can run without a broker.
const fake = vi.hoisted(() => ({ connectNats: vi.fn(), startConsumer: vi.fn() }));
vi.mock('@geldar/contract/nats', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@geldar/contract/nats')>()),
  connectNats: fake.connectNats,
}));
vi.mock('./consumer.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./consumer.ts')>()),
  startConsumer: fake.startConsumer,
}));

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
    await telemetry?.stop();
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

describe('main wiring', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'eventsink-main-'));
    const pgFile = join(dir, 'postgres.txt');
    const natsFile = join(dir, 'nats-eventsink.txt');
    writeFileSync(pgFile, 'postgres-test-secret\n');
    writeFileSync(natsFile, 'nats-test-secret\n');
    vi.stubEnv('POSTGRES_PASSWORD_FILE', pgFile);
    vi.stubEnv('GELDAR_NATS_PASSWORD_FILE', natsFile);
    vi.stubEnv('GELDAR_TELEMETRY_URL', 'http://127.0.0.1:9');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 200 })),
    );
    fake.connectNats.mockResolvedValue({ drain: vi.fn(async () => undefined) });
    fake.startConsumer.mockResolvedValue({ stop: vi.fn(async () => undefined) });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    fake.connectNats.mockReset();
    fake.startConsumer.mockReset();
    rmSync(dir, { recursive: true, force: true });
  });

  it('connects with the eventsink NATS role and hands the metrics to the consumer', async () => {
    await main();
    expect(fake.connectNats).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'eventsink', user: 'eventsink', pass: 'nats-test-secret' }),
    );
    expect(fake.startConsumer).toHaveBeenCalledTimes(1);
    const options = fake.startConsumer.mock.calls[0]?.[2];
    expect(options.metrics).toBeInstanceOf(EventsinkMetrics);
  });
});
