import { describe, expect, it } from 'vitest';
import { PLAN_BUCKET, SEEN_BUCKET } from './building/names.ts';
import { SKINS_BUCKET } from './ensure-skins-bucket.ts';
import { REGISTRY_BUCKET } from './registry.ts';
import { type SeedKvm, seedAllBuckets } from './seed-buckets.ts';

/** A KV manager stand-in that records each create call. */
function fakeKvm() {
  const created: string[] = [];
  const kvm = {
    create: async (name: string) => {
      created.push(name);
      return {};
    },
  } as unknown as SeedKvm;
  return { kvm, created };
}

describe('seedAllBuckets (the seed step main runs, BLD-fix2e)', () => {
  it('creates the identity buckets and then the building buckets, and returns all four names', async () => {
    const { kvm, created } = fakeKvm();
    const names = await seedAllBuckets(kvm);
    expect(names).toEqual([REGISTRY_BUCKET, SKINS_BUCKET, PLAN_BUCKET, SEEN_BUCKET]);
    expect(created).toEqual([REGISTRY_BUCKET, SKINS_BUCKET, PLAN_BUCKET, SEEN_BUCKET]);
  });
});
