import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CHECKPOINT_BUCKET } from '../body/checkpoint.ts';
import { GENERATION_BUCKET } from '../body/generation.ts';
import { PLAN_BUCKET, SEEN_BUCKET } from '../building/names.ts';
import { restartKvFor } from './main.ts';

// The restart KV is opened on a fake NATS connection and a fake KV manager that records each bucket created.
const created = vi.hoisted(() => [] as string[]);

vi.mock('@geldar/contract/nats', () => ({
  connectNats: async () => ({
    status: () => ({
      [Symbol.asyncIterator]: async function* () {},
    }),
    close: async () => undefined,
  }),
}));
vi.mock('@nats-io/jetstream', () => ({ jetstream: () => ({}) }));
vi.mock('@nats-io/kv', () => ({
  Kvm: class {
    async create(name: string): Promise<object> {
      created.push(name);
      return {};
    }
  },
}));
vi.mock('../nats-credentials.ts', () => ({ golemNatsAuth: () => ({}) }));

const URL = 'nats://127.0.0.1:4222';

describe('restartKvFor: the restart buckets follow body_actions.building (BLD-38g)', () => {
  beforeEach(() => {
    created.length = 0;
  });

  it('opens the plan and seen buckets as well as the generation and checkpoint buckets, flag on', async () => {
    const restart = await restartKvFor({ building: true }, URL);
    expect(created).toEqual([GENERATION_BUCKET, CHECKPOINT_BUCKET, PLAN_BUCKET, SEEN_BUCKET]);
    expect(restart.kv.plans).toBeDefined();
    expect(restart.kv.seen).toBeDefined();
    await restart.close();
  });

  it('opens only the generation and checkpoint buckets, flag off: plan and seen are not opened', async () => {
    const restart = await restartKvFor({ building: false }, URL);
    expect(created).toEqual([GENERATION_BUCKET, CHECKPOINT_BUCKET]);
    expect(restart.kv.plans).toBeUndefined();
    expect(restart.kv.seen).toBeUndefined();
    await restart.close();
  });
});
