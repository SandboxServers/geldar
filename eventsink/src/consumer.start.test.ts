import type { WorldEvent } from '@geldar/contract';
import { jetstream, jetstreamManager } from '@nats-io/jetstream';
import type { NatsConnection } from '@nats-io/transport-node';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONSUMER_NAME, STREAM_CONFIG } from './config.ts';
import { ensureConsumer, ensureStream, MAX_DELIVER, startConsumer } from './consumer.ts';
import { CONSUMED, EventsinkMetrics, WRITTEN } from './metrics.ts';
import type { EventWriter } from './writer.ts';

// The library entry points are replaced by fakes; the enums and types stay real.
vi.mock('@nats-io/jetstream', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@nats-io/jetstream')>()),
  jetstream: vi.fn(),
  jetstreamManager: vi.fn(),
}));

const EVENT: WorldEvent = {
  source_event_id: 'ev_01HZZZZZZZZZZZZZZZZZZZZZZZ',
  at: '2026-11-09T12:00:00Z',
  shard: 'phase0',
  world_day: 3,
  world_tick: 72_000,
  type: 'damage',
  payload: { amount: 4 },
};

/** A fake JetStream manager whose calls are mocks the tests can steer. */
function fakeJsm() {
  return {
    streams: { info: vi.fn(async () => ({})), add: vi.fn(async () => ({})) },
    consumers: {
      info: vi.fn(async () => ({ config: { max_deliver: MAX_DELIVER } })),
      add: vi.fn(async () => ({})),
      update: vi.fn(async () => ({})),
    },
  };
}

describe('ensureStream', () => {
  it('does nothing when the stream exists', async () => {
    const jsm = fakeJsm();
    await ensureStream(jsm as never);
    expect(jsm.streams.add).not.toHaveBeenCalled();
  });

  it('creates the stream from the shared definition when it is missing', async () => {
    const jsm = fakeJsm();
    jsm.streams.info.mockRejectedValueOnce(new Error('stream not found'));
    await ensureStream(jsm as never);
    expect(jsm.streams.add).toHaveBeenCalledWith(
      expect.objectContaining({
        name: STREAM_CONFIG.name,
        subjects: [...STREAM_CONFIG.subjects],
        max_age: STREAM_CONFIG.retentionDays * 24 * 3600 * 1_000_000_000,
        max_bytes: STREAM_CONFIG.maxBytes,
      }),
    );
  });

  it('caps the stream at 2 GiB of stored bytes by default', () => {
    expect(STREAM_CONFIG.maxBytes).toBe(2 * 1024 * 1024 * 1024);
  });

  it('accepts a stream the plugin created between the info and the add', async () => {
    const jsm = fakeJsm();
    jsm.streams.info.mockRejectedValueOnce(new Error('stream not found'));
    jsm.streams.add.mockRejectedValueOnce(new Error('stream name already in use'));
    await expect(ensureStream(jsm as never)).resolves.toBeUndefined();
    expect(jsm.streams.info).toHaveBeenCalledTimes(2);
  });

  it('throws the create error when the stream is still missing afterwards', async () => {
    const jsm = fakeJsm();
    jsm.streams.info.mockRejectedValue(new Error('stream not found'));
    jsm.streams.add.mockRejectedValueOnce(new Error('insufficient resources'));
    await expect(ensureStream(jsm as never)).rejects.toThrow('insufficient resources');
  });
});

describe('ensureConsumer', () => {
  it('does nothing when the durable consumer exists with the unlimited cap', async () => {
    const jsm = fakeJsm();
    await ensureConsumer(jsm as never);
    expect(jsm.consumers.add).not.toHaveBeenCalled();
    expect(jsm.consumers.update).not.toHaveBeenCalled();
  });

  it('lifts the redelivery cap on a consumer created with the old max_deliver of 20', async () => {
    const jsm = fakeJsm();
    jsm.consumers.info.mockResolvedValueOnce({ config: { max_deliver: 20 } });
    await ensureConsumer(jsm as never);
    expect(jsm.consumers.add).not.toHaveBeenCalled();
    expect(jsm.consumers.update).toHaveBeenCalledWith(STREAM_CONFIG.name, CONSUMER_NAME, {
      max_deliver: MAX_DELIVER,
    });
  });

  it('creates the durable consumer with explicit acks and the max_deliver cap', async () => {
    const jsm = fakeJsm();
    jsm.consumers.info.mockRejectedValueOnce(new Error('consumer not found'));
    await ensureConsumer(jsm as never);
    expect(jsm.consumers.add).toHaveBeenCalledWith(
      STREAM_CONFIG.name,
      expect.objectContaining({
        durable_name: CONSUMER_NAME,
        ack_policy: 'explicit',
        filter_subject: STREAM_CONFIG.subjects[0],
        max_deliver: MAX_DELIVER,
      }),
    );
  });
});

describe('startConsumer', () => {
  const writer: EventWriter = { insertBatch: vi.fn(async () => undefined) };
  let fetches = 0;
  let binds = 0;
  let fetch: (n: number) => Promise<AsyncIterable<unknown>>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    fetches = 0;
    binds = 0;
    const consumer = {
      fetch: async () => {
        fetches += 1;
        return fetch(fetches);
      },
    };
    vi.mocked(jetstreamManager).mockImplementation((async () => fakeJsm()) as never);
    vi.mocked(jetstream).mockReturnValue({
      consumers: {
        get: async () => {
          binds += 1;
          return consumer;
        },
      },
      publish: vi.fn(async () => ({})),
    } as never);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /** A fetched batch of messages. */
  const batchOf = (items: unknown[]): AsyncIterable<unknown> =>
    (async function* () {
      yield* items;
    })();

  /** An empty batch that arrives after the 1 s fetch wait, as a real idle fetch does. */
  const idleBatch = (): Promise<AsyncIterable<unknown>> =>
    new Promise((resolve) => setTimeout(() => resolve(batchOf([])), 1000));

  it('re-ensures the stream and consumer after 5 failed fetches in a row, then recovers', async () => {
    fetch = async (n) => {
      if (n <= 5) throw new Error('no responders');
      return idleBatch();
    };
    const running = await startConsumer({} as NatsConnection, writer, {
      batchSize: 10,
      fetchWaitMs: 1000,
    });
    expect(binds).toBe(1);
    await vi.advanceTimersByTimeAsync(5_500);
    expect(binds).toBe(2);
    const stopped = running.stop();
    await vi.advanceTimersByTimeAsync(2_000);
    await stopped;
    expect(binds).toBe(2);
  });

  it('calls onFatal after 20 failed fetches in a row and stops fetching', async () => {
    fetch = async () => {
      throw new Error('no responders');
    };
    const onFatal = vi.fn();
    const running = await startConsumer({} as NatsConnection, writer, {
      batchSize: 10,
      fetchWaitMs: 1000,
      onFatal,
    });
    await vi.advanceTimersByTimeAsync(25_000);
    expect(onFatal).toHaveBeenCalledTimes(1);
    expect(fetches).toBe(20);
    // Re-ensured at 5, 10 and 15 failures, on top of the first bind.
    expect(binds).toBe(4);
    await running.stop();
  });

  it('acks a fetched message after the write commits', async () => {
    const ack = vi.fn();
    const nak = vi.fn();
    const message = {
      subject: 'geldar.phase0.damage',
      data: new TextEncoder().encode(JSON.stringify(EVENT)),
      info: { deliveryCount: 1 },
      ack,
      nak,
    };
    fetch = async (n) => (n === 1 ? batchOf([message]) : idleBatch());
    const running = await startConsumer({} as NatsConnection, writer, {
      batchSize: 10,
      fetchWaitMs: 1000,
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(writer.insertBatch).toHaveBeenCalledTimes(1);
    expect(ack).toHaveBeenCalledTimes(1);
    expect(nak).not.toHaveBeenCalled();
    const stopped = running.stop();
    await vi.advanceTimersByTimeAsync(2_000);
    await stopped;
  });

  it('hands the metrics to the batch: one written damage counts as consumed and written', async () => {
    const metrics = new EventsinkMetrics();
    const message = {
      subject: 'geldar.phase0.damage',
      data: new TextEncoder().encode(JSON.stringify(EVENT)),
      info: { deliveryCount: 1 },
      ack: vi.fn(),
      nak: vi.fn(),
    };
    fetch = async (n) => (n === 1 ? batchOf([message]) : idleBatch());
    const running = await startConsumer({} as NatsConnection, writer, {
      batchSize: 10,
      fetchWaitMs: 1000,
      metrics,
    });
    await vi.advanceTimersByTimeAsync(100);
    // The summed value of each family, read from the OTLP form the push sends.
    const sums = Object.fromEntries(
      metrics.registry.otlp('0').map((family) => {
        const { name, sum } = family as {
          name: string;
          sum?: { dataPoints: { asDouble: number }[] };
        };
        return [name, sum?.dataPoints.reduce((total, point) => total + point.asDouble, 0)];
      }),
    );
    expect(sums[CONSUMED]).toBe(1);
    expect(sums[WRITTEN]).toBe(1);
    const stopped = running.stop();
    await vi.advanceTimersByTimeAsync(2_000);
    await stopped;
  });
});
