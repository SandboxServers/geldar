import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connectNats } from '@geldar/contract/nats';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { golemNatsAuth } from './nats-credentials.ts';

// A fake connect: the shared helper calls the transport's `connect`, and this records what it got.
const fake = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock('@nats-io/transport-node', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@nats-io/transport-node')>()),
  connect: fake.connect,
}));

const SECRET = 'golem-test-secret-7f3a';
const SERVERS = 'nats://127.0.0.1:4222';
let dir: string;
let passwordFile: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'golem-nats-'));
  passwordFile = join(dir, 'nats-body.txt');
  writeFileSync(passwordFile, `${SECRET}\n`);
  fake.connect.mockReset();
  fake.connect.mockResolvedValue({ closed: () => new Promise<void>(() => {}) });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('golemNatsAuth', () => {
  it('is undefined when neither variable is set, so the connection stays anonymous', () => {
    expect(golemNatsAuth({})).toBeUndefined();
  });

  it('passes the body role and the trimmed file password when only the file is set', async () => {
    await connectNats({
      servers: SERVERS,
      name: 'golem',
      ...golemNatsAuth({ GELDAR_NATS_PASSWORD_FILE: passwordFile }),
    });
    expect(fake.connect).toHaveBeenCalledTimes(1);
    expect(fake.connect.mock.calls[0]?.[0]).toMatchObject({ user: 'body', pass: SECRET });
  });

  it('does not pass a user or password to connect when neither variable is set', async () => {
    await connectNats({ servers: SERVERS, name: 'golem', ...golemNatsAuth({}) });
    const options: object | undefined = fake.connect.mock.calls[0]?.[0];
    expect(options).not.toHaveProperty('user');
    expect(options).not.toHaveProperty('pass');
  });

  it('lets GELDAR_NATS_USER override the role default', () => {
    expect(
      golemNatsAuth({ GELDAR_NATS_USER: 'body-ops', GELDAR_NATS_PASSWORD_FILE: passwordFile }),
    ).toEqual({ user: 'body-ops', pass: SECRET });
  });

  it('stops the start, naming the variable and the path, when the file is missing', () => {
    const missing = join(dir, 'absent.txt');
    let message = '';
    try {
      golemNatsAuth({ GELDAR_NATS_PASSWORD_FILE: missing });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain('GELDAR_NATS_PASSWORD_FILE');
    expect(message).toContain(missing);
    expect(message).not.toContain(SECRET);
    expect(fake.connect).not.toHaveBeenCalled();
  });

  it('names GELDAR_NATS_PASSWORD_FILE when a user is set without a password file', () => {
    expect(() => golemNatsAuth({ GELDAR_NATS_USER: 'body' })).toThrow('GELDAR_NATS_PASSWORD_FILE');
  });

  it('names the variable when the password file is empty', () => {
    const empty = join(dir, 'empty.txt');
    writeFileSync(empty, '\n');
    expect(() => golemNatsAuth({ GELDAR_NATS_PASSWORD_FILE: empty })).toThrow(
      'GELDAR_NATS_PASSWORD_FILE',
    );
  });
});
