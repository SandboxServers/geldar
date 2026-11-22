import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SKINS_BUCKET } from './ensure-skins-bucket.ts';
import { REGISTRY_BUCKET } from './registry.ts';

// main() runs against a recording KV manager: the test sees every bucket the seed one-shot creates.
const state = vi.hoisted(() => ({ created: [] as string[] }));

vi.mock('@geldar/contract/nats', () => ({
  connectNats: async () => ({ close: async () => undefined }),
}));
vi.mock('@nats-io/jetstream', () => ({ jetstream: () => ({}) }));
vi.mock('@nats-io/kv', () => ({
  Kvm: class {
    async create(name: string) {
      state.created.push(name);
      return {};
    }
  },
}));
vi.mock('./nats-credentials.ts', () => ({ golemNatsAuth: () => ({}) }));

const { main, seedBuildingBuckets } = await import('./seed-buckets.ts');

describe('seed-buckets main (the scratch and NF one-shot, as the seed NATS user)', () => {
  beforeEach(() => {
    state.created.length = 0;
    process.env.GELDAR_NATS_URL = 'nats://127.0.0.1:4222';
  });

  it('creates only the identity buckets, never geldar-plans or geldar-seen', async () => {
    await main();
    expect(state.created).toEqual([REGISTRY_BUCKET, SKINS_BUCKET]);
    expect(state.created).not.toContain('geldar-plans');
    expect(state.created).not.toContain('geldar-seen');
  });

  it('still creates the building buckets when seedBuildingBuckets is called directly', async () => {
    const kvm = { create: async (name: string) => state.created.push(name) };
    await seedBuildingBuckets(kvm as never);
    expect(state.created).toEqual(['geldar-plans', 'geldar-seen']);
  });
});
