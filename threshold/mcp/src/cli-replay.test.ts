import type { SpeechIdentity } from '@geldar/animus/src/attention/classify.ts';
import { eventOf } from '@geldar/animus/src/link/link.fixtures.ts';
import { describe, expect, it } from 'vitest';
import {
  type ReplaySource,
  runStreamLoop,
  type StreamLoopCounters,
  type StreamMessage,
  startReplay,
} from './cli.ts';
import { RingEventLog } from './events/player-log.ts';
import { handleStreamMessage, type StreamCounters } from './events/stream.ts';

type Line = Record<string, string | number>;

type Counted = StreamMessage & { acked: number; naked: number; delays: Array<number | undefined> };

/** A delivered message with its acknowledgements and naks counted, and each nak's delay; `json` parses the body or throws. */
function message(seq: number, body: string): Counted {
  const state = { acked: 0, naked: 0, delays: [] as Array<number | undefined> };
  return {
    seq,
    json: () => JSON.parse(body),
    ack: () => {
      state.acked++;
    },
    nak: (delayMs?: number) => {
      state.naked++;
      state.delays.push(delayMs);
    },
    get acked() {
      return state.acked;
    },
    get naked() {
      return state.naked;
    },
    get delays() {
      return state.delays;
    },
  };
}

async function* feed(
  ...items: Array<StreamMessage | AsyncIterable<StreamMessage>>
): AsyncGenerator<StreamMessage> {
  for (const item of items) {
    if (Symbol.asyncIterator in item) yield* item;
    else yield item;
  }
}

/** A message redelivered after each nak, as JetStream does, until it is acked or 10 deliveries. */
async function* redelivering(m: StreamMessage & { acked: number; naked: number }) {
  let deliveries = 0;
  while (deliveries < 10 && (deliveries === 0 || (m.naked >= deliveries && m.acked === 0))) {
    deliveries++;
    yield m;
  }
}

function loopCounters(): StreamLoopCounters {
  return { malformed: 0, failed: 0, dropped: 0 };
}

/** A consumer that never delivers again and never ends, as a quiet stream does. */
function stalled(): AsyncIterable<StreamMessage> {
  return {
    [Symbol.asyncIterator]: () => ({
      next: () => new Promise<IteratorResult<StreamMessage>>(() => {}),
    }),
  };
}

/** A consumer whose first read fails, as a dropped connection does. */
function broken(): AsyncIterable<StreamMessage> {
  return {
    [Symbol.asyncIterator]: () => ({
      next: async (): Promise<IteratorResult<StreamMessage>> => {
        throw new Error('nats gone');
      },
    }),
  };
}

const dayNight = (phase: string, tick: number) => ({
  ...eventOf('day_night', 5, null),
  payload: { phase, tick },
});

describe('the stream loop survives a bad message', () => {
  it('counts a body that is not JSON, acks it, and still reads the next message', async () => {
    const lines: Line[] = [];
    const seen: number[] = [];
    const counters = loopCounters();
    const bad = message(1, '{not json, secret payload');
    const good = message(2, '{"x":1}');
    await runStreamLoop(
      feed(bad, good),
      async (seq) => {
        seen.push(seq);
      },
      counters,
      (line) => lines.push(line),
    );
    expect(counters.malformed).toBe(1);
    expect(bad.acked).toBe(1);
    expect(good.acked).toBe(1);
    expect(seen).toEqual([2]);
    expect(JSON.stringify(lines)).not.toContain('secret payload');
  });

  it('counts a JSON body of the wrong shape as invalid, acks it, and does not throw', async () => {
    const counters: StreamCounters = { invalid: 0 };
    const ctx = {
      map: { identity: {} as SpeechIdentity, runs: new Map() },
      log: new RingEventLog(),
      lives: () => ['ag_jason_01'],
    };
    const wrong = message(3, '{"type":"nope","at":3}');
    const loopStats = loopCounters();
    await runStreamLoop(
      feed(wrong),
      (seq, raw) => handleStreamMessage(seq, raw, ctx, counters),
      loopStats,
      () => {},
    );
    expect(counters.invalid).toBe(1);
    expect(wrong.acked).toBe(1);
    expect(loopStats.failed).toBe(0);
  });

  it('retries a handler that throws once, then acks the message', async () => {
    const counters = loopCounters();
    let calls = 0;
    const flaky = message(5, '{"x":1}');
    await runStreamLoop(
      feed(redelivering(flaky)),
      async () => {
        calls++;
        if (calls === 1) throw new Error('transient');
      },
      counters,
      () => {},
    );
    expect(calls).toBe(2);
    expect(flaky.naked).toBe(1);
    expect(flaky.acked).toBe(1);
    expect(counters).toEqual({ malformed: 0, failed: 1, dropped: 0 });
  });

  it('drops a day_night whose lives() rejects after four tries, and keeps reading', async () => {
    const counters = loopCounters();
    const streamCounters: StreamCounters = { invalid: 0 };
    const ctx = {
      map: { identity: {} as SpeechIdentity, runs: new Map() },
      log: new RingEventLog(),
      lives: () => Promise.reject(new Error('pg down')),
    };
    const fanOut = message(7, JSON.stringify(dayNight('night', 9)));
    const after = message(8, '{"x":1}');
    const resolved = await runStreamLoop(
      feed(redelivering(fanOut), after),
      (seq, raw) => handleStreamMessage(seq, raw, ctx, streamCounters),
      counters,
      () => {},
    ).then(() => 'resolved');
    expect(resolved).toBe('resolved');
    expect(counters).toEqual({ malformed: 0, failed: 4, dropped: 1 });
    expect(fanOut.naked).toBe(3);
    expect(fanOut.acked).toBe(1);
    expect(after.acked).toBe(1);
    expect(streamCounters.invalid).toBe(1);
  });
});

describe('startReplay waits for the replay to catch up', () => {
  /** The first open gives `messages`; a reopen after its end gives a stream that stays quiet. */
  function sourceOf(pending: number, messages: AsyncIterable<StreamMessage>): ReplaySource {
    let opened = 0;
    return {
      open: async () => {
        opened++;
        const next = opened === 1 ? messages : stalled();
        return { pending, messages: next, stop: async () => {} };
      },
    };
  }

  it('resolves only once the messages the replay held are settled', async () => {
    const handled: number[] = [];
    await startReplay(
      sourceOf(2, feed(message(1, '{"x":1}'), message(2, '{"x":2}'))),
      ['geldar.phase0.speech'],
      '2026-01-01T00:00:00.000Z',
      async (seq) => {
        handled.push(seq);
      },
      { log: () => {}, waitMs: 5_000 },
    );
    expect(handled).toEqual([1, 2]);
  });

  it('resolves at once when the replay holds nothing', async () => {
    const lines: Line[] = [];
    await startReplay(
      sourceOf(0, feed()),
      ['geldar.phase0.speech'],
      '2026-01-01T00:00:00.000Z',
      async () => {},
      { log: (line) => lines.push(line), waitMs: 5_000 },
    );
    expect(lines).toContainEqual({ event: 'replay_caught_up', settled: 0 });
  });

  it('gives up after the wait, logs it, and lets the front door listen', async () => {
    const lines: Line[] = [];
    async function* stalled(): AsyncGenerator<StreamMessage> {
      yield message(1, '{"x":1}');
      await new Promise(() => {});
    }
    await startReplay(
      sourceOf(3, stalled()),
      ['geldar.phase0.speech'],
      '2026-01-01T00:00:00.000Z',
      async () => {},
      { log: (line) => lines.push(line), waitMs: 20 },
    );
    expect(lines).toContainEqual({
      event: 'replay_catchup_timeout',
      settled: 1,
      pending: 3,
      waitMs: 20,
    });
  });

  it('naks a failing message after 1 s, 5 s and 15 s, then drops it, counts it, and logs its code', async () => {
    const counters = loopCounters();
    const lines: Line[] = [];
    const poison = message(9, '{"x":1}');
    await runStreamLoop(
      feed(redelivering(poison)),
      async () => {
        throw Object.assign(new Error('pg down'), { code: '57P01' });
      },
      counters,
      (line) => lines.push(line),
    );
    expect(poison.delays).toEqual([1000, 5000, 15000]);
    expect(poison.acked).toBe(1);
    expect(counters).toEqual({ malformed: 0, failed: 4, dropped: 1 });
    expect(lines).toContainEqual(
      expect.objectContaining({
        event: 'stream_message_dropped',
        dropped_total: 1,
        error: 'Error',
        code: '57P01',
      }),
    );
  });

  it('reopens the consumer after an unexpected end and keeps reading until a stop', async () => {
    const seen: number[] = [];
    const sleeps: number[] = [];
    const exits: number[] = [];
    let opened = 0;
    let stopped = false;
    await runStreamLoop(
      broken(),
      async (seq) => {
        seen.push(seq);
        stopped = true;
      },
      loopCounters(),
      () => {},
      undefined,
      {
        reopen: async () => {
          opened++;
          return feed(message(10, '{"x":1}'));
        },
        stopping: () => stopped,
        exit: (code) => exits.push(code),
        sleep: async (ms) => {
          sleeps.push(ms);
        },
      },
    );
    expect(opened).toBe(1);
    expect(seen).toEqual([10]);
    expect(sleeps).toEqual([1000]);
    expect(exits).toEqual([]);
  });

  it('exits non-zero after five failed reopens, waiting 1 s up to 16 s between them', async () => {
    const sleeps: number[] = [];
    const exits: number[] = [];
    await runStreamLoop(
      broken(),
      async () => {},
      loopCounters(),
      () => {},
      undefined,
      {
        reopen: async () => {
          throw new Error('still gone');
        },
        stopping: () => false,
        exit: (code) => exits.push(code),
        sleep: async (ms) => {
          sleeps.push(ms);
        },
      },
    );
    expect(sleeps).toEqual([1000, 2000, 4000, 8000, 16000]);
    expect(exits).toEqual([1]);
  });

  it('reopens the replay consumer through startReplay when its messages end with an error', async () => {
    let opened = 0;
    const handled: number[] = [];
    const source: ReplaySource = {
      open: async () => {
        opened++;
        const messages = opened === 1 ? broken() : feed(message(11, '{"x":1}'), stalled());
        return { pending: 0, messages, stop: async () => {} };
      },
    };
    const handle = await startReplay(
      source,
      ['geldar.phase0.speech'],
      '2026-01-01T00:00:00.000Z',
      async (seq) => {
        handled.push(seq);
      },
      { log: () => {}, waitMs: 5_000, sleep: async () => {} },
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(opened).toBe(2);
    expect(handled).toEqual([11]);
    await handle.stop();
  });

  it('counts a poison message once toward the settled count, so the replay waits for the rest', async () => {
    const handled: number[] = [];
    await startReplay(
      sourceOf(2, feed(redelivering(message(1, '{"x":1}')), message(2, '{"x":2}'))),
      ['geldar.phase0.speech'],
      '2026-01-01T00:00:00.000Z',
      async (seq) => {
        if (seq === 1) throw new Error('transient');
        await new Promise((resolve) => setTimeout(resolve, 5));
        handled.push(seq);
      },
      { log: () => {}, waitMs: 5_000, sleep: async () => {} },
    );
    expect(handled).toEqual([2]);
  });
});
