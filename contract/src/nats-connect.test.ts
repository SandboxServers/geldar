import { describe, expect, it, vi } from 'vitest';
import { connectNats } from './nats-connect.ts';

const connectMock = vi.hoisted(() => vi.fn());

vi.mock('@nats-io/transport-node', () => ({ connect: connectMock }));

/** A fake connection whose `closed()` settles when the test calls `finish`. */
function fakeConnection() {
  let finish: (reason?: unknown) => void = () => undefined;
  const closed = new Promise<unknown>((resolve) => {
    finish = resolve;
  });
  return { closed: () => closed, finish };
}

const OPTIONS = { name: 'golem', servers: 'nats://127.0.0.1:4222' };

/** Lets the `closed()` handler run. */
async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('connectNats', () => {
  it('connects with unbounded reconnects, overriding the caller value', async () => {
    connectMock.mockResolvedValueOnce(fakeConnection());
    await connectNats({ ...OPTIONS, maxReconnectAttempts: 10, timeout: 5_000 }, vi.fn());
    expect(connectMock).toHaveBeenCalledWith({
      ...OPTIONS,
      maxReconnectAttempts: -1,
      timeout: 5_000,
    });
  });

  it('calls onFatalClose with the error when the connection closes with one', async () => {
    const conn = fakeConnection();
    connectMock.mockResolvedValueOnce(conn);
    const onFatalClose = vi.fn();
    await connectNats(OPTIONS, onFatalClose);
    conn.finish(new Error('authorization violation'));
    await flush();
    expect(onFatalClose).toHaveBeenCalledTimes(1);
    expect(onFatalClose.mock.calls[0]?.[0]).toBeInstanceOf(Error);
    expect(onFatalClose.mock.calls[0]?.[1]).toBe('golem');
  });

  it('does not call onFatalClose for a clean close the code asked for', async () => {
    const conn = fakeConnection();
    connectMock.mockResolvedValueOnce(conn);
    const onFatalClose = vi.fn();
    await connectNats(OPTIONS, onFatalClose);
    conn.finish(undefined);
    await flush();
    expect(onFatalClose).not.toHaveBeenCalled();
  });

  it('rejects when the first connect fails, without a watcher', async () => {
    connectMock.mockRejectedValueOnce(new Error('connection refused'));
    const onFatalClose = vi.fn();
    await expect(connectNats(OPTIONS, onFatalClose)).rejects.toThrow('connection refused');
    expect(onFatalClose).not.toHaveBeenCalled();
  });
});
