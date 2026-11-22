import { describe, expect, it } from 'vitest';
import { PLAN_BUCKET, SEEN_BUCKET } from './building/names.ts';
import { type SeedKvm, seedBuildingBuckets } from './seed-buckets.ts';

/** A KV manager stand-in that records each create call and can fail one bucket name. */
function fakeKvm(failOn?: string) {
  const created: { name: string; opts: unknown }[] = [];
  const kvm: SeedKvm = {
    create: async (name: string, opts?: { ttl: number }) => {
      created.push({ name, opts });
      if (name === failOn) throw new Error(`create ${name} refused`);
      return {};
    },
  } as unknown as SeedKvm;
  return { kvm, created };
}

describe('seedBuildingBuckets (review fix 6)', () => {
  it('creates geldar-plans and geldar-seen with the Body own settings (a plain create, no ttl)', async () => {
    const { kvm, created } = fakeKvm();
    const names = await seedBuildingBuckets(kvm);
    expect(names).toEqual([PLAN_BUCKET, SEEN_BUCKET]);
    expect(created).toEqual([
      { name: 'geldar-plans', opts: undefined },
      { name: 'geldar-seen', opts: undefined },
    ]);
  });

  it('stops at the first failure and does not create the seen bucket', async () => {
    const { kvm, created } = fakeKvm('geldar-plans');
    await expect(seedBuildingBuckets(kvm)).rejects.toThrow('geldar-plans');
    expect(created.map((call) => call.name)).toEqual(['geldar-plans']);
  });
});
