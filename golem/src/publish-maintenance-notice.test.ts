import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  checkNotice,
  deployNatsAuth,
  type NoticePublisher,
  publishMaintenanceNotice,
} from './publish-maintenance-notice.ts';

const NOTICE = {
  id: 'cd-pause-world-20261112000000-0a1b2c3d',
  kind: 'pause',
  scope: 'world',
  seconds: 120,
  reason: 'update',
};
const PAYLOAD = JSON.stringify(NOTICE);

describe('checkNotice (CD-1d)', () => {
  it('returns a notice that matches the schema', () => {
    expect(checkNotice(PAYLOAD)).toEqual(NOTICE);
  });

  it('refuses a countdown above 600 seconds', () => {
    expect(() => checkNotice(JSON.stringify({ ...NOTICE, seconds: 601 }))).toThrow(
      /invalid maintenance notice/,
    );
  });

  it('refuses a kind outside the enum', () => {
    expect(() => checkNotice(JSON.stringify({ ...NOTICE, kind: 'stop' }))).toThrow(
      /invalid maintenance notice/,
    );
  });

  it('refuses text that is not JSON', () => {
    expect(() => checkNotice('{"id":')).toThrow('not valid JSON');
  });
});

describe('publishMaintenanceNotice (CD-1d)', () => {
  it('publishes the notice JSON on geldar.<shard>.maintenance, flushes, and returns the id', async () => {
    const publish = vi.fn();
    const flush = vi.fn().mockResolvedValue(undefined);
    const nc: NoticePublisher = { publish, flush };
    expect(await publishMaintenanceNotice(nc, 'colo', NOTICE)).toBe(NOTICE.id);
    expect(publish).toHaveBeenCalledExactlyOnceWith(
      'geldar.colo.maintenance',
      expect.any(Uint8Array),
    );
    expect(new TextDecoder().decode(publish.mock.calls[0]?.[1])).toBe(PAYLOAD);
    expect(publish.mock.invocationCallOrder[0]).toBeLessThan(
      flush.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('uses the shard it is given in the subject', async () => {
    const publish = vi.fn();
    await publishMaintenanceNotice(
      { publish, flush: vi.fn().mockResolvedValue(undefined) },
      'other',
      NOTICE,
    );
    expect(publish.mock.calls[0]?.[0]).toBe('geldar.other.maintenance');
  });

  it('refuses a shard name the contract rejects, and publishes nothing', async () => {
    const publish = vi.fn();
    await expect(
      publishMaintenanceNotice({ publish, flush: vi.fn() }, 'Bad.Shard', NOTICE),
    ).rejects.toThrow('invalid shard name');
    expect(publish).not.toHaveBeenCalled();
  });

  it('rejects when the flush fails, so a notice the server never took is not reported as published', async () => {
    const flush = vi.fn().mockRejectedValue(new Error('connection closed'));
    await expect(
      publishMaintenanceNotice({ publish: vi.fn(), flush }, 'colo', NOTICE),
    ).rejects.toThrow('connection closed');
  });

  it('rejects when the publish itself throws (a permissions violation)', async () => {
    const publish = vi.fn(() => {
      throw new Error('permissions violation');
    });
    await expect(
      publishMaintenanceNotice({ publish, flush: vi.fn() }, 'colo', NOTICE),
    ).rejects.toThrow('permissions violation');
  });
});

describe('deployNatsAuth (CD-1d)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'geldar-notice-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('refuses when no NATS user is set', () => {
    expect(() => deployNatsAuth({})).toThrow(/must be deploy/);
  });

  it('refuses another role, even with its password file', () => {
    const file = join(dir, 'nats-body.txt');
    writeFileSync(file, 'body-secret\n');
    expect(() =>
      deployNatsAuth({ GELDAR_NATS_USER: 'body', GELDAR_NATS_PASSWORD_FILE: file }),
    ).toThrow(/must be deploy/);
  });

  it('reads the deploy password from the file named by GELDAR_NATS_PASSWORD_FILE', () => {
    const file = join(dir, 'nats-deploy.txt');
    writeFileSync(file, 'deploy-secret\n');
    expect(deployNatsAuth({ GELDAR_NATS_USER: 'deploy', GELDAR_NATS_PASSWORD_FILE: file })).toEqual(
      { user: 'deploy', pass: 'deploy-secret' },
    );
  });

  it('names the path, not a password, when the file cannot be read', () => {
    const file = join(dir, 'missing.txt');
    expect(() =>
      deployNatsAuth({ GELDAR_NATS_USER: 'deploy', GELDAR_NATS_PASSWORD_FILE: file }),
    ).toThrow('cannot read the NATS password file');
  });
});
