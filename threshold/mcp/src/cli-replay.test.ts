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

/** A delivered message with its acknowledgements counted; `json` parses the body or throws. */
function message(seq: number, body: string): StreamMessage & { acked: number; naked: number } {
  const state = { acked: 0, naked: 0 };
  return {
    seq,
    json: () => JSON.parse(body),
    ack: () => {
      state.acked++;
    },
    nak: () => {
      state.naked++;
    },
    get acked() {
      return state.acked;
    },
    get naked() {
      return state.naked;
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

/** A message redelivered after each nak, as JetStream does, until it is acked. */
async function* redelivering(m: StreamMessage & { acked: number; naked: number }) {
  let deliveries = 0;
  while (deliveries === 0 || (m.naked >= deliveries && m.acked === 0)) {
    deliveries++;
    yield m;
  }
}

function loopCounters(): StreamLoopCounters {
  return { malformed: 0, failed: 0, dropped: 0 };
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

  it('drops a day_night whose lives() rejects after three tries, and keeps reading', async () => {
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
    expect(counters).toEqual({ malformed: 0, failed: 3, dropped: 1 });
    expect(fanOut.naked).toBe(2);
    expect(fanOut.acked).toBe(1);
    expect(after.acked).toBe(1);
    expect(streamCounters.invalid).toBe(1);
  });
});

describe('startReplay waits for the replay to catch up', () => {
  function sourceOf(pending: number, messages: AsyncIterable<StreamMessage>): ReplaySource {
    return { open: async () => ({ pending, messages, stop: async () => {} }) };
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
});
