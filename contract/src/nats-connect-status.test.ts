import { afterEach, describe, expect, it, vi } from 'vitest';
import { connectNats, watchNatsStatus } from './nats-connect.ts';

const connectMock = vi.hoisted(() => vi.fn());

vi.mock('@nats-io/transport-node', () => ({ connect: connectMock }));

afterEach(() => {
  vi.restoreAllMocks();
  connectMock.mockReset();
});

/** Lets the status loop drain: every queued microtask runs before a macrotask. */
async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/** A fake connection whose `status()` yields the given events, then ends. */
function fakeConnection(events: unknown[]) {
  return {
    status: async function* () {
      for (const event of events) yield event;
    },
  };
}

describe('watchNatsStatus', () => {
  it('passes each status type to both hooks, in order', async () => {
    const types = [
      'disconnect',
      'reconnecting',
      'reconnect',
      'update',
      'ldm',
      'error',
      'staleConnection',
      'forceReconnect',
    ];
    const onStatus = vi.fn();
    const incStatus = vi.fn();
    const events = types.map((type) => ({ type }));
    watchNatsStatus(fakeConnection(events) as never, { onStatus, incStatus });
    await flush();
    expect(incStatus.mock.calls.map((call) => call[0])).toEqual(types);
    expect(onStatus.mock.calls.map((call) => call[0])).toEqual(types.map((type) => ({ type })));
  });

  it('sends the type only, never the server URL or the error text from the client event', async () => {
    const onStatus = vi.fn();
    const events = [
      { type: 'disconnect', server: 'nats://mind:hunter2@10.0.0.5:4222' },
      { type: 'error', error: new Error('auth failed for nats://mind:hunter2@10.0.0.5') },
    ];
    watchNatsStatus(fakeConnection(events) as never, { onStatus });
    await flush();
    expect(onStatus.mock.calls.map((call) => call[0])).toEqual([
      { type: 'disconnect' },
      { type: 'error' },
    ]);
    expect(JSON.stringify(onStatus.mock.calls)).not.toContain('hunter2');
    expect(JSON.stringify(onStatus.mock.calls)).not.toContain('10.0.0.5');
  });

  it('works with only one of the two hooks set', async () => {
    const incStatus = vi.fn();
    watchNatsStatus(fakeConnection([{ type: 'reconnect' }]) as never, { incStatus });
    await flush();
    expect(incStatus).toHaveBeenCalledWith('reconnect');
  });

  it('does not read the status stream when no hook is given, and does not throw', () => {
    const status = vi.fn(() => {
      throw new Error('status must not be read');
    });
    expect(() => watchNatsStatus({ status } as never, {})).not.toThrow();
    expect(status).not.toHaveBeenCalled();
  });

  it('stops and logs the message when a hook throws, without an unhandled rejection', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const incStatus = vi.fn(() => {
      throw new Error('counter unavailable');
    });
    const onStatus = vi.fn();
    watchNatsStatus(fakeConnection([{ type: 'disconnect' }, { type: 'reconnect' }]) as never, {
      incStatus,
      onStatus,
    });
    await flush();
    expect(incStatus).toHaveBeenCalledTimes(1);
    expect(onStatus).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith('NATS status watcher stopped: counter unavailable');
  });
});

describe('connectNats status hooks', () => {
  const OPTIONS = { name: 'golem', servers: 'nats://127.0.0.1:4222' };

  it('watches the status stream of the connection it opens', async () => {
    const onStatus = vi.fn();
    const incStatus = vi.fn();
    connectMock.mockResolvedValueOnce({
      ...fakeConnection([{ type: 'staleConnection' }, { type: 'forceReconnect' }]),
      closed: () => new Promise(() => undefined),
    });
    await connectNats(OPTIONS, vi.fn(), { onStatus, incStatus });
    await flush();
    expect(incStatus.mock.calls.map((call) => call[0])).toEqual([
      'staleConnection',
      'forceReconnect',
    ]);
    expect(onStatus).toHaveBeenCalledWith({ type: 'staleConnection' });
  });

  it('connects without hooks and without reading status, as before', async () => {
    const status = vi.fn();
    connectMock.mockResolvedValueOnce({ status, closed: () => new Promise(() => undefined) });
    await expect(connectNats(OPTIONS, vi.fn())).resolves.toBeDefined();
    expect(status).not.toHaveBeenCalled();
  });
});
