import { beforeEach, describe, expect, it, vi } from 'vitest';
import { REGISTRY_BUCKET, removeRegistryKey } from '../src/registry.ts';

const kvOpen = vi.hoisted(() => vi.fn());
const kvDelete = vi.hoisted(() => vi.fn());
const natsClose = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock('@nats-io/transport-node', () => ({
  connect: async () => ({ close: natsClose }),
}));
vi.mock('@nats-io/jetstream', () => ({ jetstream: () => ({}) }));
vi.mock('@nats-io/kv', () => ({
  Kvm: class {
    open = kvOpen;
  },
}));

describe('removeRegistryKey', () => {
  beforeEach(() => {
    kvOpen.mockReset();
    kvDelete.mockReset();
    natsClose.mockClear();
    kvOpen.mockResolvedValue({ delete: kvDelete });
    kvDelete.mockResolvedValue(undefined);
  });

  it('deletes the lowercase key from the registry bucket and closes NATS', async () => {
    await removeRegistryKey('nats://127.0.0.1:4222', 'ag_Kestrel_01');
    expect(kvOpen).toHaveBeenCalledWith(REGISTRY_BUCKET);
    expect(kvDelete).toHaveBeenCalledWith('ag_kestrel_01');
    expect(natsClose).toHaveBeenCalledTimes(1);
  });

  it('throws when the bucket cannot be opened, and still closes NATS', async () => {
    kvOpen.mockRejectedValue(new Error('no bucket'));
    await expect(removeRegistryKey('nats://127.0.0.1:4222', 'ag_kestrel_01')).rejects.toThrow(
      'no bucket',
    );
    expect(kvDelete).not.toHaveBeenCalled();
    expect(natsClose).toHaveBeenCalledTimes(1);
  });

  it('throws when the delete fails, and still closes NATS', async () => {
    kvDelete.mockRejectedValue(new Error('delete refused'));
    await expect(removeRegistryKey('nats://127.0.0.1:4222', 'ag_kestrel_01')).rejects.toThrow(
      'delete refused',
    );
    expect(natsClose).toHaveBeenCalledTimes(1);
  });
});
