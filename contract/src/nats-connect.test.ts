import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { connectNats, natsAuth } from './nats-connect.ts';

const connectMock = vi.hoisted(() => vi.fn());

vi.mock('@nats-io/transport-node', () => ({ connect: connectMock }));

let dir = '';
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'geldar-nats-connect-'));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});
beforeEach(() => {
  // An empty value counts as unset, so a developer's shell cannot leak credentials into a test.
  vi.stubEnv('GELDAR_NATS_USER', '');
  vi.stubEnv('GELDAR_NATS_PASSWORD_FILE', '');
});
afterEach(() => {
  vi.unstubAllEnvs();
});

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

  it('connects unauthenticated when no credential is set', async () => {
    connectMock.mockResolvedValueOnce(fakeConnection());
    await connectNats(OPTIONS, vi.fn());
    const sent = connectMock.mock.calls.at(-1)?.[0] ?? {};
    expect(sent).not.toHaveProperty('user');
    expect(sent).not.toHaveProperty('pass');
  });

  it('reads the user and the trimmed password file named by the environment', async () => {
    const file = join(dir, 'connect-user.txt');
    writeFileSync(file, 'pw-from-file\n');
    vi.stubEnv('GELDAR_NATS_USER', 'golem-body');
    vi.stubEnv('GELDAR_NATS_PASSWORD_FILE', file);
    connectMock.mockResolvedValueOnce(fakeConnection());
    await connectNats(OPTIONS, vi.fn());
    expect(connectMock).toHaveBeenLastCalledWith({
      ...OPTIONS,
      user: 'golem-body',
      pass: 'pw-from-file',
      maxReconnectAttempts: -1,
    });
  });

  it('prefers the user and password given in the options over the environment', () => {
    const file = join(dir, 'connect-unused.txt');
    expect(
      natsAuth(
        { user: 'mcp', pass: 'given' },
        { GELDAR_NATS_USER: 'body', GELDAR_NATS_PASSWORD_FILE: file },
      ),
    ).toEqual({ user: 'mcp', pass: 'given' });
  });

  it('is unauthenticated when both variables are empty', () => {
    expect(natsAuth({}, { GELDAR_NATS_USER: '', GELDAR_NATS_PASSWORD_FILE: '' })).toBeUndefined();
  });

  it('fails with a clear error when the password file is missing, without the password', async () => {
    const missing = join(dir, 'no-such-file.txt');
    vi.stubEnv('GELDAR_NATS_USER', 'mind');
    vi.stubEnv('GELDAR_NATS_PASSWORD_FILE', missing);
    connectMock.mockClear();
    const error = await connectNats(OPTIONS, vi.fn()).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('GELDAR_NATS_PASSWORD_FILE');
    expect((error as Error).message).not.toContain('pw-');
    expect(connectMock).not.toHaveBeenCalled();
  });

  it('fails when a user is set without a password file, and the reverse', () => {
    expect(() => natsAuth({}, { GELDAR_NATS_USER: 'mind' })).toThrow('GELDAR_NATS_PASSWORD_FILE');
    expect(() => natsAuth({}, { GELDAR_NATS_PASSWORD_FILE: 'x' })).toThrow('GELDAR_NATS_USER');
  });

  it('fails when the password file is empty', () => {
    const file = join(dir, 'connect-empty.txt');
    writeFileSync(file, '\n');
    expect(() =>
      natsAuth({}, { GELDAR_NATS_USER: 'ops', GELDAR_NATS_PASSWORD_FILE: file }),
    ).toThrow('is empty');
  });
});
