import type { NatsConnection } from '@nats-io/transport-node';
import { describe, expect, it, vi } from 'vitest';
import { natsRequestServer } from './server.ts';

/** A connection whose one subscription yields the given messages, then ends. */
function connectionWith(messages: Array<{ string(): string; respond(body: string): void }>) {
  return {
    subscribe: () => ({
      unsubscribe: () => undefined,
      async *[Symbol.asyncIterator]() {
        yield* messages;
      },
    }),
  } as unknown as NatsConnection;
}

describe('natsRequestServer: a handler that throws', () => {
  it('logs one JSON line with the subject and the exception, and sends no reply', async () => {
    const respond = vi.fn();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      natsRequestServer(connectionWith([{ string: () => 'x', respond }])).serve(
        'geldar.test.subject',
        () => Promise.reject(new RangeError('handler broke')),
      );
      await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(1));
      const line = JSON.parse(String(warn.mock.calls[0]?.[0])) as Record<string, unknown>;
      expect(line).toMatchObject({
        subject: 'geldar.test.subject',
        'exception.type': 'RangeError',
        'exception.message': 'handler broke',
      });
      expect(respond).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('keeps serving the next message after a failure', async () => {
    const seen: string[] = [];
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      natsRequestServer(
        connectionWith([
          { string: () => 'one', respond: () => undefined },
          { string: () => 'two', respond: () => undefined },
        ]),
      ).serve('s', async (data) => {
        seen.push(data);
        throw new Error('always');
      });
      await vi.waitFor(() => expect(seen).toEqual(['one', 'two']));
    } finally {
      warn.mockRestore();
    }
  });
});
