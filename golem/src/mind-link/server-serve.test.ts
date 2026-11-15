import type { NatsConnection } from '@nats-io/transport-node';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { natsRequestServer } from './server.ts';

interface FakeMsg {
  string(): string;
  respond(body: string): boolean;
}

/** A subscription the test feeds by hand: `for await` ends once it is unsubscribed and drained. */
class FakeSub implements AsyncIterable<FakeMsg> {
  private readonly queue: FakeMsg[] = [];
  private wake: (() => void) | null = null;
  closed = false;
  finished = false;

  push(msg: FakeMsg): void {
    this.queue.push(msg);
    this.wake?.();
    this.wake = null;
  }

  unsubscribe(): void {
    this.closed = true;
    this.wake?.();
    this.wake = null;
  }

  [Symbol.asyncIterator](): AsyncIterator<FakeMsg> {
    return {
      next: async () => {
        for (;;) {
          const next = this.queue.shift();
          if (next !== undefined) return { done: false, value: next };
          if (this.closed) {
            this.finished = true;
            return { done: true, value: undefined };
          }
          await new Promise<void>((resolve) => {
            this.wake = resolve;
          });
        }
      },
    };
  }
}

function fakeConnection(sub: FakeSub): NatsConnection {
  return { subscribe: () => sub } as unknown as NatsConnection;
}

function fakeMsg(data: string, respond: (body: string) => boolean = () => true): FakeMsg {
  return { string: () => data, respond };
}

/** Lets every queued message and microtask run. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('natsRequestServer: a failing request does not end the serve loop', () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => {
    unhandled.push(reason);
  };

  beforeEach(() => {
    unhandled.length = 0;
    process.on('unhandledRejection', onUnhandled);
  });

  afterEach(() => {
    process.off('unhandledRejection', onUnhandled);
    vi.restoreAllMocks();
  });

  it('a reply that throws synchronously does not end the loop: the next request is answered', async () => {
    const sub = new FakeSub();
    const answered: string[] = [];
    natsRequestServer(fakeConnection(sub)).serve('geldar.test.snap', (data, reply) => {
      reply(data);
      return Promise.resolve();
    });
    sub.push(
      fakeMsg('first', () => {
        throw new Error('connection draining');
      }),
    );
    sub.push(
      fakeMsg('second', (body) => {
        answered.push(body);
        return true;
      }),
    );
    await settle();
    expect(answered).toEqual(['second']);
    expect(sub.finished).toBe(false);
    expect(unhandled).toEqual([]);
  });

  it('a handler that throws synchronously does not end the loop: the next request is answered', async () => {
    const sub = new FakeSub();
    const answered: string[] = [];
    natsRequestServer(fakeConnection(sub)).serve('geldar.test.snap', (data, reply) => {
      if (data === 'bad') throw new Error('handler broke');
      reply(data);
      return Promise.resolve();
    });
    sub.push(fakeMsg('bad'));
    sub.push(
      fakeMsg('good', (body) => {
        answered.push(body);
        return true;
      }),
    );
    await settle();
    expect(answered).toEqual(['good']);
    expect(unhandled).toEqual([]);
  });

  it('a handler that returns a rejected promise does not end the loop: the next request is answered', async () => {
    const sub = new FakeSub();
    const answered: string[] = [];
    natsRequestServer(fakeConnection(sub)).serve('geldar.test.snap', (data, reply) => {
      if (data === 'bad') return Promise.reject(new Error('rejected'));
      reply(data);
      return Promise.resolve();
    });
    sub.push(fakeMsg('bad'));
    sub.push(
      fakeMsg('good', (body) => {
        answered.push(body);
        return true;
      }),
    );
    await settle();
    expect(answered).toEqual(['good']);
    expect(unhandled).toEqual([]);
  });

  it('logs a synchronous throw as one line with the subject and no payload, capped at 200 characters', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const sub = new FakeSub();
    natsRequestServer(fakeConnection(sub)).serve('geldar.test.snap', () => {
      throw new Error(`bad\nline ${'x'.repeat(400)}`);
    });
    sub.push(fakeMsg('{"secret":"PAYLOAD-SECRET"}'));
    await settle();
    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0]?.[0]);
    expect(line).toContain('geldar.test.snap');
    expect(line).toContain('Error: bad line');
    expect(line).not.toContain('PAYLOAD-SECRET');
    expect(line).not.toMatch(/[\r\n]/);
    expect(line).not.toContain('x'.repeat(200));
    const detail = line.slice(line.indexOf('failed: ') + 'failed: '.length);
    expect(detail.length).toBeLessThanOrEqual(200);
  });

  it('logs a rejection as one line: newlines in the message are stripped', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const sub = new FakeSub();
    natsRequestServer(fakeConnection(sub)).serve('geldar.test.snap', () =>
      Promise.reject(new Error('line one\nline two')),
    );
    sub.push(fakeMsg('{"secret":"PAYLOAD-SECRET"}'));
    await settle();
    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0]?.[0]);
    expect(line).toContain('line one line two');
    expect(line).not.toMatch(/[\r\n]/);
    expect(line).not.toContain('PAYLOAD-SECRET');
  });

  it('the stop function still ends the loop: the subscription closes and a later message is not handled', async () => {
    const sub = new FakeSub();
    const handled: string[] = [];
    const stop = natsRequestServer(fakeConnection(sub)).serve('geldar.test.snap', (data) => {
      handled.push(data);
      return Promise.resolve();
    });
    sub.push(fakeMsg('before'));
    await settle();
    stop();
    await settle();
    expect(sub.closed).toBe(true);
    expect(sub.finished).toBe(true);
    expect(handled).toEqual(['before']);
    expect(unhandled).toEqual([]);
  });
});
