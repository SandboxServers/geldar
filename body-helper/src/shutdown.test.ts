import { afterEach, describe, expect, it, vi } from 'vitest';
import { type HelperMsg, type HelperWire, newHelperStats, serveHelper } from './listener.ts';
import type { RequestHandler } from './service.ts';
import { SHUTDOWN_WAIT_MS, shutdownHelper } from './shutdown.ts';

const START = 'geldar.colo.helper.body.start';
const encoder = new TextEncoder();

/** A subscription the test feeds and ends: the iterator yields what was pushed, then returns once ended. */
function channel() {
  const items: HelperMsg[] = [];
  let ended = false;
  let wake: (() => void) | undefined;
  const poke = () => {
    const resume = wake;
    wake = undefined;
    resume?.();
  };
  return {
    push(msg: HelperMsg) {
      items.push(msg);
      poke();
    },
    end() {
      ended = true;
      poke();
    },
    iterable: {
      async *[Symbol.asyncIterator]() {
        for (;;) {
          const next = items.shift();
          if (next) {
            yield next;
            continue;
          }
          if (ended) return;
          await new Promise<void>((resume) => {
            wake = resume;
          });
        }
      },
    },
  };
}

type Channel = ReturnType<typeof channel>;

/** A NATS stand-in: publishing after the connection closed throws, as the real client does. */
function fakeWire(channels: Map<string, Channel>, events: string[], state: { closed: boolean }) {
  const wire: HelperWire = {
    subscribe(subject) {
      const sub = channel();
      channels.set(subject, sub);
      return sub.iterable;
    },
    async respond(inbox) {
      if (state.closed) throw new Error('connection closed');
      events.push(`reply ${inbox}`);
    },
  };
  return wire;
}

const startRequest = (): HelperMsg => ({
  subject: START,
  data: encoder.encode(JSON.stringify({ verb: 'start', name: 'ranger', owner: 'own-a' })),
  reply: '_INBOX.1',
});

afterEach(() => {
  vi.useRealTimers();
});

describe('body helper shutdown', () => {
  it('an in-flight request is answered before the connection closes', async () => {
    const channels = new Map<string, Channel>();
    const events: string[] = [];
    const state = { closed: false };
    const stats = newHelperStats();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const handle: RequestHandler = async () => {
      await gate;
      return { ok: true, state: 'started' };
    };
    const serving = serveHelper({
      wire: fakeWire(channels, events, state),
      shard: 'colo',
      handle,
      stats,
    });
    channels.get(START)?.push(startRequest());
    await new Promise((resolve) => setTimeout(resolve, 0));

    const shutdown = shutdownHelper({
      stopSweep: () => undefined,
      stopIntake: () => {
        for (const sub of channels.values()) sub.end();
      },
      serving,
      closeConnection: async () => {
        events.push('close');
        state.closed = true;
      },
      closePool: async () => {
        events.push('pool');
      },
    });
    release();
    await shutdown;

    expect(events).toEqual(['reply _INBOX.1', 'close', 'pool']);
    expect(stats.replyFailed).toBe(0);
  });

  it('an answer that never settles is cut at the wait, and the connection then closes', async () => {
    vi.useFakeTimers();
    const channels = new Map<string, Channel>();
    const events: string[] = [];
    const state = { closed: false };
    const handle: RequestHandler = () => new Promise(() => undefined);
    const serving = serveHelper({
      wire: fakeWire(channels, events, state),
      shard: 'colo',
      handle,
      stats: newHelperStats(),
    });
    channels.get(START)?.push(startRequest());
    await vi.advanceTimersByTimeAsync(0);

    const done = shutdownHelper({
      stopSweep: () => undefined,
      stopIntake: () => {
        for (const sub of channels.values()) sub.end();
      },
      serving,
      closeConnection: async () => {
        events.push('close');
      },
      closePool: async () => {
        events.push('pool');
      },
    });
    await vi.advanceTimersByTimeAsync(SHUTDOWN_WAIT_MS - 1);
    expect(events).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    await done;
    expect(events).toEqual(['close', 'pool']);
  });
});
