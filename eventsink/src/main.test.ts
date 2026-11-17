import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SinkConfig } from './config.ts';
import { consumerOptions, main } from './main.ts';
import { EventsinkMetrics, eventsinkTelemetry } from './metrics.ts';

// The fakes stand in for the NATS connect, the consumer, the writer and the two shard services, so main() runs without a broker.
const fake = vi.hoisted(() => ({
  connectNats: vi.fn(),
  startConsumer: vi.fn(),
  pgEventWriter: vi.fn(),
  serveProficiencyState: vi.fn(),
  startOutboxPublisher: vi.fn(),
}));
vi.mock('@geldar/contract/nats', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@geldar/contract/nats')>()),
  connectNats: fake.connectNats,
}));
vi.mock('./consumer.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./consumer.ts')>()),
  startConsumer: fake.startConsumer,
}));
vi.mock('./writer.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./writer.ts')>()),
  pgEventWriter: fake.pgEventWriter,
}));
vi.mock('./state/service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./state/service.ts')>()),
  serveProficiencyState: fake.serveProficiencyState,
}));
vi.mock('./xp/outbox.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./xp/outbox.ts')>()),
  startOutboxPublisher: fake.startOutboxPublisher,
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
        service: 'geldar-eventsink',
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
    const telemetry = eventsinkTelemetry({}, { service: 'geldar-eventsink', log: vi.fn() });
    const options = consumerOptions(CONFIG, telemetry, () => undefined);
    expect(telemetry).toBeUndefined();
    expect(options).not.toHaveProperty('metrics');
  });
});

describe('main wiring', () => {
  let dir: string;
  // The order the stops and the drain run in, recorded by the fakes.
  let calls: string[];
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let signalsBefore: Map<string, unknown[]>;

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
    calls = [];
    signalsBefore = new Map(
      ['SIGINT', 'SIGTERM'].map((s) => [s, process.listeners(s as NodeJS.Signals)]),
    );
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    fake.connectNats.mockResolvedValue({
      drain: vi.fn(async () => {
        calls.push('drain');
      }),
    });
    fake.startConsumer.mockResolvedValue({
      stop: vi.fn(async () => {
        calls.push('consumer');
      }),
    });
    fake.pgEventWriter.mockImplementation(() => ({}));
    fake.serveProficiencyState.mockImplementation(() => ({
      stop: vi.fn(async () => {
        calls.push('state');
      }),
    }));
    fake.startOutboxPublisher.mockImplementation(() => ({
      stop: vi.fn(async () => {
        calls.push('outbox');
      }),
    }));
  });

  afterEach(() => {
    // Remove the signal handlers this test's main() added, so a later emit does not run them.
    for (const [signal, before] of signalsBefore) {
      for (const listener of process.listeners(signal as NodeJS.Signals)) {
        if (!before.includes(listener))
          process.removeListener(signal as NodeJS.Signals, listener as () => void);
      }
    }
    exitSpy.mockRestore();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    fake.connectNats.mockReset();
    fake.startConsumer.mockReset();
    fake.pgEventWriter.mockReset();
    fake.serveProficiencyState.mockReset();
    fake.startOutboxPublisher.mockReset();
    rmSync(dir, { recursive: true, force: true });
  });

  /** Sends SIGTERM and waits for the shutdown to reach process.exit (it runs after every stop and the drain). */
  async function terminate(): Promise<void> {
    process.emit('SIGTERM');
    await vi.waitFor(() => expect(exitSpy).toHaveBeenCalledWith(0));
  }

  it('connects with the eventsink NATS role and hands the metrics to the consumer', async () => {
    await main();
    expect(fake.connectNats).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'eventsink', user: 'eventsink', pass: 'nats-test-secret' }),
    );
    expect(fake.startConsumer).toHaveBeenCalledTimes(1);
    const options = fake.startConsumer.mock.calls[0]?.[2];
    expect(options.metrics).toBeInstanceOf(EventsinkMetrics);
  });

  it('starts no state service and no outbox, and the writer counts no XP, when the sink variables are unset', async () => {
    await main();
    expect(fake.serveProficiencyState).not.toHaveBeenCalled();
    expect(fake.startOutboxPublisher).not.toHaveBeenCalled();
    expect(fake.pgEventWriter.mock.calls[0]?.[1]).toMatchObject({ enabled: false });
  });

  it('starts nothing when only the ambient GELDAR_SHARD is set (the sink switch is GELDAR_SHEET_SHARD)', async () => {
    vi.stubEnv('GELDAR_SHARD', 'colo');
    await main();
    expect(fake.serveProficiencyState).not.toHaveBeenCalled();
    expect(fake.startOutboxPublisher).not.toHaveBeenCalled();
    expect(fake.pgEventWriter.mock.calls[0]?.[1]).toMatchObject({ enabled: false });
  });

  it('starts the state service on the named shard, the outbox, and the XP writer with GELDAR_XP=1', async () => {
    vi.stubEnv('GELDAR_SHEET_SHARD', 'colo');
    vi.stubEnv('GELDAR_XP', '1');
    await main();
    expect(fake.serveProficiencyState).toHaveBeenCalledWith(
      expect.objectContaining({ shard: 'colo' }),
    );
    expect(fake.startOutboxPublisher).toHaveBeenCalledTimes(1);
    expect(fake.pgEventWriter.mock.calls[0]?.[1]).toMatchObject({ enabled: true });
  });

  it('stops the consumer, then the state service and the outbox, then drains NATS on SIGTERM', async () => {
    vi.stubEnv('GELDAR_SHEET_SHARD', 'colo');
    await main();
    await terminate();
    expect(calls).toEqual(['consumer', 'state', 'outbox', 'drain']);
  });
});
