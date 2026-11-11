import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { controlledFeed } from './control.ts';
import { type NatsLink, supervisedFeed } from './supervised-feed.ts';

class FakeLink implements NatsLink {
  published: Array<[string, string]> = [];
  throwOnPublish = false;
  private close!: () => void;
  readonly done = new Promise<void>((r) => {
    this.close = r;
  });
  publish(subject: string, data: Uint8Array): void {
    if (this.throwOnPublish) throw new Error('CONNECTION_CLOSED');
    this.published.push([subject, new TextDecoder().decode(data)]);
  }
  subscribe() {
    return Object.assign(
      (async function* () {
        /* no messages */
      })(),
      { unsubscribe() {} },
    );
  }
  closed() {
    return this.done;
  }
  async drain() {}
  shut(): void {
    this.close();
  }
}

const opts = (connect: () => Promise<NatsLink>, log: (m: string) => void = () => {}) => ({
  connect,
  feedSubject: (a: string) => `feed.${a}`,
  controlSubject: 'control',
  log,
  initialBackoffMs: 100,
  maxBackoffMs: 400,
});

describe('supervisedFeed', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('starts without NATS without throwing, stays unavailable, retries with backoff and enables on connect', async () => {
    const logs: string[] = [];
    const link = new FakeLink();
    let calls = 0;
    const feed = supervisedFeed(
      opts(
        async () => {
          calls++;
          if (calls < 3) throw new Error('auth violation');
          return link;
        },
        (m) => logs.push(m),
      ),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(feed.available()).toBe(false);
    expect(logs[0]).toMatch(/kino is disabled.*auth violation/);
    // a subscribe while unavailable is a harmless no-op
    expect(() => feed.subscribe('a', () => {})()).not.toThrow();
    await vi.advanceTimersByTimeAsync(100); // 2nd attempt after 100 ms
    expect(feed.available()).toBe(false);
    await vi.advanceTimersByTimeAsync(200); // 3rd after 200 ms (doubled)
    expect(feed.available()).toBe(true);
    await feed.close();
  });

  it('on close tells listeners, goes unavailable and reconnects with backoff', async () => {
    const first = new FakeLink();
    const second = new FakeLink();
    const links = [first, second];
    const feed = supervisedFeed(opts(async () => links.shift() as FakeLink));
    let lost = 0;
    feed.onLost(() => lost++);
    await vi.advanceTimersByTimeAsync(0);
    expect(feed.available()).toBe(true);
    first.shut();
    await vi.advanceTimersByTimeAsync(0);
    expect(lost).toBe(1);
    expect(feed.available()).toBe(false);
    await vi.advanceTimersByTimeAsync(100);
    expect(feed.available()).toBe(true);
    await feed.close();
  });

  it('a publish on a closed connection does not throw out of the refresh timer', async () => {
    const link = new FakeLink();
    const feed = supervisedFeed(opts(async () => link));
    await vi.advanceTimersByTimeAsync(0);
    link.throwOnPublish = true;
    expect(() => feed.control.publish('{}')).not.toThrow();
    const controlled = controlledFeed(feed, {
      sink: feed.control,
      enabled: () => true,
      refreshMs: 50,
    });
    controlled.subscribe('a', () => {});
    await expect(vi.advanceTimersByTimeAsync(500)).resolves.not.toThrow();
    controlled.dispose();
    await feed.close();
  });

  it('control.send survives a sink that throws', async () => {
    const sink = {
      publish() {
        throw new Error('closed');
      },
    };
    const controlled = controlledFeed(
      { subscribe: () => () => {} },
      { sink, enabled: () => true, refreshMs: 50 },
    );
    expect(() => controlled.subscribe('a', () => {})).not.toThrow();
    await expect(vi.advanceTimersByTimeAsync(500)).resolves.not.toThrow();
    controlled.dispose();
  });
});
