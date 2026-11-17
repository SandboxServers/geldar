import { describe, expect, it } from 'vitest';
import { SKINS_BUCKET } from './ensure-skins-bucket.ts';
import { REGISTRY_BUCKET, REGISTRY_TTL_MS } from './registry.ts';
import { seedIdentityBuckets } from './seed-buckets.ts';

/** A KV manager that records each create call and fails the named bucket when asked. */
function fakeKvm(failOn?: string) {
  const calls: Array<{ name: string; opts: unknown }> = [];
  return {
    calls,
    create(name: string, opts?: { ttl: number }): Promise<unknown> {
      calls.push({ name, opts });
      if (name === failOn) return Promise.reject(new Error(`cannot create ${name}`));
      return Promise.resolve({ name });
    },
  };
}

describe('seedIdentityBuckets (scratch seed step)', () => {
  it('creates the life registry with golem TTL and the skins bucket with defaults', async () => {
    const kvm = fakeKvm();
    const names = await seedIdentityBuckets(kvm);
    expect(kvm.calls).toEqual([
      { name: REGISTRY_BUCKET, opts: { ttl: REGISTRY_TTL_MS } },
      { name: SKINS_BUCKET, opts: undefined },
    ]);
    expect(names).toEqual([REGISTRY_BUCKET, SKINS_BUCKET]);
  });

  it('uses the bucket names golem and the plugin share', () => {
    expect(REGISTRY_BUCKET).toBe('geldar-life-registry');
    expect(SKINS_BUCKET).toBe('geldar-skins');
    expect(REGISTRY_TTL_MS).toBe(60_000);
  });

  it('fails when the registry bucket cannot be created, and does not create the skins bucket', async () => {
    const kvm = fakeKvm(REGISTRY_BUCKET);
    await expect(seedIdentityBuckets(kvm)).rejects.toThrow(`cannot create ${REGISTRY_BUCKET}`);
    expect(kvm.calls.map((c) => c.name)).toEqual([REGISTRY_BUCKET]);
  });

  it('fails when the skins bucket cannot be created', async () => {
    const kvm = fakeKvm(SKINS_BUCKET);
    await expect(seedIdentityBuckets(kvm)).rejects.toThrow(`cannot create ${SKINS_BUCKET}`);
  });
});
