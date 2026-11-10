import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openRegistryBucket, REGISTRY_BUCKET, REGISTRY_TTL_MS } from '../src/registry.ts';

const kvmCreate = vi.hoisted(() => vi.fn());
const natsClose = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock('@nats-io/transport-node', () => ({
  connect: async () => ({ close: natsClose, closed: () => new Promise(() => undefined) }),
}));
vi.mock('@nats-io/jetstream', () => ({ jetstream: () => ({}) }));
vi.mock('@nats-io/kv', () => ({
  Kvm: class {
    create = kvmCreate;
  },
}));

describe('openRegistryBucket', () => {
  beforeEach(() => {
    kvmCreate.mockReset();
    natsClose.mockClear();
  });

  it('creates the bucket with a key TTL so a stopped Body stops being admissible', async () => {
    kvmCreate.mockResolvedValue({ put: async () => undefined, delete: async () => undefined });
    await openRegistryBucket('nats://127.0.0.1:4222');
    expect(kvmCreate).toHaveBeenCalledWith(REGISTRY_BUCKET, { ttl: REGISTRY_TTL_MS });
    expect(REGISTRY_TTL_MS).toBe(60_000);
  });

  it('explains how to recreate a bucket that predates the TTL, and closes NATS', async () => {
    kvmCreate.mockRejectedValue(new Error('stream configuration mismatch'));
    await expect(openRegistryBucket('nats://127.0.0.1:4222')).rejects.toThrow(
      /stream configuration mismatch[\s\S]*KV_geldar-life-registry/,
    );
    expect(natsClose).toHaveBeenCalledTimes(1);
  });
});
