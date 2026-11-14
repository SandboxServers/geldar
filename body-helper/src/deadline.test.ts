import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type BodyEngine,
  type ContainerState,
  createBodyHelper,
  ENGINE_TIMEOUT,
  REQUEST_DEADLINE_MS,
} from './service.ts';

const TEMPLATE = {
  image: 'golem-body:test',
  wiring: {
    shard: 'colo',
    uid: '1000',
    mcHost: 'velocity',
    mcPort: '25565',
    natsUrl: 'nats://nats:4222',
    natsUser: 'body',
    natsSecretHostPath: '/root/secrets/nats-body.txt',
    shardHostPath: '/root/shards/colo.yaml',
  },
  limits: { nanoCpus: 1_000_000_000, memory: 1024 * 1024 * 1024, pidsLimit: 256 },
};

const roster = { displayName: async () => 'Name' };
const req = (verb: string, name: string) => ({ verb, name, owner: 'own-a' });

/** An Engine whose inspect of `hung` never answers until the test releases it; every other call answers at once. */
function hangingEngine(hung: string) {
  const created: string[] = [];
  let release: ((state: ContainerState | null) => void) | undefined;
  const engine: BodyEngine = {
    async inspect(name) {
      if (name !== hung) return null;
      return new Promise<ContainerState | null>((resolve) => {
        release = resolve;
      });
    },
    async countCounted() {
      return 0;
    },
    async create(name) {
      created.push(name);
      return `id-${name}`;
    },
    async start() {},
    async stop() {},
    async remove() {},
    async logs() {
      return '';
    },
  };
  return { engine, created, release: (state: ContainerState | null) => release?.(state) };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('body helper: the per-request deadline', () => {
  it('the default deadline is 120 seconds', () => {
    expect(REQUEST_DEADLINE_MS).toBe(120_000);
  });

  it('answers engine timeout when a hung Engine call passes the deadline, and the queue moves on', async () => {
    vi.useFakeTimers();
    const fake = hangingEngine('ranger');
    const handle = createBodyHelper({
      roster,
      engine: fake.engine,
      cap: 40,
      template: TEMPLATE,
      audit: () => undefined,
      requestDeadlineMs: 1000,
    });
    let settled = false;
    const first = handle(req('start', 'ranger')).then((reply) => {
      settled = true;
      return reply;
    });
    const second = handle(req('start', 'miner'));
    await vi.advanceTimersByTimeAsync(999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await first).toEqual({ ok: false, code: 'refused', error: ENGINE_TIMEOUT });
    expect(await second).toEqual({ ok: true, state: 'started' });
    expect(fake.created).toEqual(['miner']);
  });

  it('the abandoned start creates nothing when its Engine call finally answers after the deadline', async () => {
    vi.useFakeTimers();
    const fake = hangingEngine('ranger');
    const handle = createBodyHelper({
      roster,
      engine: fake.engine,
      cap: 40,
      template: TEMPLATE,
      audit: () => undefined,
      requestDeadlineMs: 1000,
    });
    const first = handle(req('start', 'ranger'));
    await vi.advanceTimersByTimeAsync(1000);
    expect(await first).toEqual({ ok: false, code: 'refused', error: ENGINE_TIMEOUT });
    // The hung inspect answers late, with no container: the abandoned start must not create one.
    fake.release(null);
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.created).toEqual([]);
  });
});
