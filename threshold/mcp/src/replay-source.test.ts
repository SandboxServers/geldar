import type { JetStreamClient, JetStreamManager } from '@nats-io/jetstream';
import { describe, expect, it, vi } from 'vitest';
import { type ReplaySource, type StreamMessage, startReplay } from './cli.ts';
import {
  jetStreamReplay,
  STREAM_WAIT_MS,
  StreamWaitTimeout,
  untilStreamExists,
} from './replay-source.ts';

/** A clock the tests move: `sleep` advances it at once, so a wait of minutes takes no real time. */
function fakeClock() {
  const clock = { ms: 0 };
  return {
    now: () => clock.ms,
    sleep: async (ms: number) => {
      clock.ms += ms;
    },
    clock,
  };
}

/** The error NATS raises for a stream that is not there. */
function streamMissing(): Error {
  return Object.assign(new Error('stream not found'), { name: 'StreamNotFoundError' });
}

async function* noMessages(): AsyncGenerator<StreamMessage> {}

describe('untilStreamExists', () => {
  it('retries with backoff, logs once a minute, and returns once the stream exists', async () => {
    const clock = fakeClock();
    const logs: Record<string, string | number>[] = [];
    const sleeps: number[] = [];
    const sleep = async (ms: number) => {
      sleeps.push(ms);
      await clock.sleep(ms);
    };
    const value = await untilStreamExists(
      async () => {
        if (clock.clock.ms < 100_000) throw streamMissing();
        return 'consumer';
      },
      { log: (line) => logs.push(line), sleep, now: clock.now },
    );
    expect(value).toBe('consumer');
    expect(sleeps.slice(0, 6)).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 30_000]);
    const waiting = logs.filter((line) => line.event === 'waiting_for_event_stream');
    expect(waiting.map((line) => line.waited_ms)).toEqual([0, 61_000]);
  });

  it('gives up after five minutes with the stream still absent, and logs it', async () => {
    const clock = fakeClock();
    const logs: Record<string, string | number>[] = [];
    const open = vi.fn(async () => {
      throw streamMissing();
    });
    await expect(
      untilStreamExists(open, {
        log: (line) => logs.push(line),
        sleep: clock.sleep,
        now: clock.now,
      }),
    ).rejects.toBeInstanceOf(StreamWaitTimeout);
    expect(clock.clock.ms).toBeGreaterThanOrEqual(STREAM_WAIT_MS);
    expect(clock.clock.ms).toBeLessThan(STREAM_WAIT_MS + 30_000);
    expect(logs.at(-1)).toMatchObject({ event: 'event_stream_absent', stream: 'GELDAR_EVENTS' });
  });

  it('rethrows any other error at once, without waiting', async () => {
    const clock = fakeClock();
    const open = async () => {
      throw new Error('connection refused');
    };
    await expect(
      untilStreamExists(open, { log: () => {}, sleep: clock.sleep, now: clock.now }),
    ).rejects.toThrow('connection refused');
    expect(clock.clock.ms).toBe(0);
  });
});

describe('startReplay with a stream that is absent when it reopens', () => {
  it('exits 1 once the stream is absent for five minutes, after the first consumer ends', async () => {
    const clock = fakeClock();
    const exits: number[] = [];
    let opens = 0;
    const wait = { log: () => {}, sleep: clock.sleep, now: clock.now };
    const source: ReplaySource = {
      open: () =>
        untilStreamExists(async () => {
          opens++;
          if (opens === 1) return { pending: 0, messages: noMessages(), stop: async () => {} };
          throw streamMissing();
        }, wait),
    };
    await startReplay(source, [], '2026-11-10T00:00:00.000Z', async () => {}, {
      log: () => {},
      waitMs: 1_000,
      exit: (code) => exits.push(code),
      sleep: clock.sleep,
      now: clock.now,
    });
    await vi.waitFor(() => expect(exits).toEqual([1]));
    expect(clock.clock.ms).toBeGreaterThanOrEqual(STREAM_WAIT_MS);
  });

  it('missing stream does not count toward the five failures: seven misses, then the reopen reads on', async () => {
    const clock = fakeClock();
    const exits: number[] = [];
    let adds = 0;
    let consumed = 0;
    const jsm = {
      consumers: {
        add: async () => {
          adds++;
          if (adds === 1) return { name: 'first', num_pending: 0 };
          if (adds <= 8) throw streamMissing();
          return { name: 'second', num_pending: 0 };
        },
      },
    } as unknown as JetStreamManager;
    const js = {
      consumers: {
        get: async (_stream: string, name: string) => ({
          consume: async () => {
            if (name === 'first') return noMessages();
            consumed++;
            return {
              [Symbol.asyncIterator]: () => ({ next: () => new Promise<never>(() => {}) }),
              stop: async () => {},
            };
          },
        }),
      },
    } as unknown as JetStreamClient;
    const wait = { log: () => {}, sleep: clock.sleep, now: clock.now };
    const replay = await startReplay(
      jetStreamReplay(js, jsm, wait),
      [],
      '2026-11-10T00:00:00.000Z',
      async () => {},
      {
        log: () => {},
        waitMs: 1_000,
        exit: (code) => exits.push(code),
        sleep: clock.sleep,
        now: clock.now,
      },
    );
    await vi.waitFor(() => expect(consumed).toBe(1));
    expect(adds).toBe(9);
    expect(exits).toEqual([]);
    expect(clock.clock.ms).toBeLessThan(STREAM_WAIT_MS);
    await replay.stop();
  });
});
