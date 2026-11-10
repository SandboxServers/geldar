import { beforeEach, describe, expect, it, vi } from 'vitest';
import { lifeIdForPlayer } from '../src/players/player-config.ts';
import {
  LifeRegistration,
  lifeIdFor,
  REGISTRY_BUCKET,
  removeRegistryKey,
} from '../src/registry.ts';

const kvOpen = vi.hoisted(() => vi.fn());
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

/** An in-memory bucket with the calls the registry makes: put, delete, keys and get. */
function fakeBucket(entries: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(entries));
  return {
    store,
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    keys: vi.fn(async () =>
      (async function* () {
        yield* [...store.keys()];
      })(),
    ),
    get: vi.fn(async (key: string) => {
      const value = store.get(key);
      return value === undefined ? null : { json: () => JSON.parse(value) };
    }),
  };
}

const NATS_URL = 'nats://127.0.0.1:4222';

describe('removeRegistryKey', () => {
  let bucket: ReturnType<typeof fakeBucket>;

  beforeEach(() => {
    kvOpen.mockReset();
    natsClose.mockClear();
    bucket = fakeBucket();
    kvOpen.mockResolvedValue(bucket);
  });

  it('deletes the lowercase key of a life id and closes NATS', async () => {
    bucket = fakeBucket({ ag_kestrel_01: '{"life_id":"ag_kestrel_01","registered_at":"t"}' });
    kvOpen.mockResolvedValue(bucket);
    await removeRegistryKey(NATS_URL, 'ag_Kestrel_01');
    expect(kvOpen).toHaveBeenCalledWith(REGISTRY_BUCKET);
    expect(bucket.delete).toHaveBeenCalledWith('ag_kestrel_01');
    expect(natsClose).toHaveBeenCalledTimes(1);
  });

  it('deletes the key of a username that is not a life id, found by its life_id', async () => {
    const lifeId = lifeIdFor('GolemBench');
    bucket = fakeBucket({ golembench: JSON.stringify({ life_id: lifeId, registered_at: 't' }) });
    kvOpen.mockResolvedValue(bucket);
    await removeRegistryKey(NATS_URL, lifeId);
    expect(bucket.store.has('golembench')).toBe(false);
  });

  it('leaves the entries of other lives in place', async () => {
    const other = JSON.stringify({ life_id: 'ag_iris_01', registered_at: 't' });
    bucket = fakeBucket({ iris: other });
    kvOpen.mockResolvedValue(bucket);
    await removeRegistryKey(NATS_URL, 'ag_kestrel_01');
    expect(bucket.store.get('iris')).toBe(other);
  });

  it('throws when the bucket cannot be opened, and still closes NATS', async () => {
    kvOpen.mockRejectedValue(new Error('no bucket'));
    await expect(removeRegistryKey(NATS_URL, 'ag_kestrel_01')).rejects.toThrow('no bucket');
    expect(bucket.delete).not.toHaveBeenCalled();
    expect(natsClose).toHaveBeenCalledTimes(1);
  });

  it('throws when the delete fails, and still closes NATS', async () => {
    bucket.delete.mockRejectedValue(new Error('delete refused'));
    await expect(removeRegistryKey(NATS_URL, 'ag_kestrel_01')).rejects.toThrow('delete refused');
    expect(natsClose).toHaveBeenCalledTimes(1);
  });
});

describe('the registry key the Body writes and the key the removal deletes', () => {
  it('are identical for a hyphenated player id and its underscore life id', async () => {
    const lifeId = lifeIdForPlayer('ag-jason-01') ?? '';
    expect(lifeId).toBe('ag_jason_01');
    const bucket = fakeBucket();
    kvOpen.mockResolvedValue(bucket);
    const registration = new LifeRegistration(async () => ({
      kv: bucket,
      close: async () => undefined,
    }));
    await registration.register(lifeId);
    await registration.close();
    expect([...bucket.store.keys()]).toEqual(['ag_jason_01']);
    await removeRegistryKey(NATS_URL, lifeId);
    expect(bucket.delete).toHaveBeenCalledWith('ag_jason_01');
    expect(bucket.store.size).toBe(0);
  });

  it('are identical for a username that is not a life id', async () => {
    const bucket = fakeBucket();
    kvOpen.mockResolvedValue(bucket);
    const registration = new LifeRegistration(async () => ({
      kv: bucket,
      close: async () => undefined,
    }));
    await registration.register('GolemBench');
    await registration.close();
    expect([...bucket.store.keys()]).toEqual(['golembench']);
    await removeRegistryKey(NATS_URL, lifeIdFor('GolemBench'));
    expect(bucket.store.size).toBe(0);
  });
});
