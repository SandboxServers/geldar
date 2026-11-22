import { describe, expect, it, vi } from 'vitest';
import { PLAN_BUCKET, SEEN_BUCKET } from '../building/names.ts';
import { CHECKPOINT_BUCKET } from './checkpoint.ts';
import { GENERATION_BUCKET } from './generation.ts';
import { openRestartKv } from './restart.ts';

const kvm = vi.hoisted(() => ({
  created: [] as string[],
  failing: new Set<string>(),
}));

vi.mock('@geldar/contract/nats', () => ({
  connectNats: vi.fn(async () => ({
    status: () => ({
      [Symbol.asyncIterator]: async function* () {
        // No status events in these tests.
      },
    }),
    close: async () => undefined,
  })),
}));
vi.mock('@nats-io/jetstream', () => ({ jetstream: () => ({}) }));
vi.mock('@nats-io/kv', () => ({
  Kvm: class {
    async create(name: string) {
      kvm.created.push(name);
      if (kvm.failing.has(name)) throw new Error(`cannot open ${name}`);
      return { name, get: async () => null, put: async () => 1, delete: async () => undefined };
    }
  },
}));
vi.mock('../nats-credentials.ts', () => ({ golemNatsAuth: () => ({}) }));

const URL = 'nats://127.0.0.1:4222';

describe('openRestartKv: the plan and seen buckets follow body_actions.building', () => {
  it('with the flag off, opens only the generation and checkpoint buckets', async () => {
    kvm.created.length = 0;
    const opened = await openRestartKv(URL);
    expect(kvm.created).toEqual([GENERATION_BUCKET, CHECKPOINT_BUCKET]);
    expect(kvm.created).not.toContain(PLAN_BUCKET);
    expect(kvm.created).not.toContain(SEEN_BUCKET);
    expect(opened.kv.plans).toBeUndefined();
    expect(opened.kv.seen).toBeUndefined();
    expect(opened.kv.generations).toBeDefined();
    expect(opened.kv.checkpoints).toBeDefined();
  });

  it('with the flag off, a plan bucket that would fail to open does not fail the start', async () => {
    kvm.created.length = 0;
    kvm.failing.add(PLAN_BUCKET);
    kvm.failing.add(SEEN_BUCKET);
    try {
      await expect(openRestartKv(URL)).resolves.toMatchObject({
        kv: { generations: expect.anything(), checkpoints: expect.anything() },
      });
      expect(kvm.created).not.toContain(PLAN_BUCKET);
    } finally {
      kvm.failing.clear();
    }
  });

  it('with the flag on, opens the plan and seen buckets too', async () => {
    kvm.created.length = 0;
    const opened = await openRestartKv(URL, true);
    expect(kvm.created).toEqual([GENERATION_BUCKET, CHECKPOINT_BUCKET, PLAN_BUCKET, SEEN_BUCKET]);
    expect(opened.kv.plans).toBeDefined();
    expect(opened.kv.seen).toBeDefined();
  });

  it('with the flag on, a plan bucket that cannot be opened fails the start', async () => {
    kvm.created.length = 0;
    kvm.failing.add(PLAN_BUCKET);
    try {
      await expect(openRestartKv(URL, true)).rejects.toThrow(`cannot open ${PLAN_BUCKET}`);
    } finally {
      kvm.failing.clear();
    }
  });
});
