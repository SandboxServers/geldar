import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type BodyEngine,
  CAP_REFUSAL,
  type ContainerState,
  createBodyHelper,
  ENGINE_TIMEOUT,
} from './service.ts';

// The deadline for the admit one-shot (BH-3). The admit runs before the create, so a hung admit past the deadline must
// create nothing, and its cap slot (pendingStarts) must stay held until the admit settles, then be released.

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
  managed: {
    enabled: true,
    db: { host: 'db', port: '5432', role: 'body', secretHostPath: '/root/secrets/db.txt' },
    rconSecretHostPath: '/root/secrets/rcon.txt',
  },
};

const roster = { displayName: async () => 'Name', lifeId: async () => 'ag_0123456789ab' };
const req = (verb: string, name: string) => ({ verb, name, owner: 'own-a' });

/** An Engine whose first admit (runOneShot) is held until the test releases it with an exit code; later admits exit 0. */
function holdAdmitEngine() {
  const created: string[] = [];
  let admits = 0;
  let release: (code: number) => void = () => undefined;
  const engine: BodyEngine = {
    async inspect(): Promise<ContainerState | null> {
      return null;
    },
    async countCounted() {
      return 0;
    },
    runOneShot() {
      admits++;
      if (admits > 1) return Promise.resolve(0);
      return new Promise<number>((resolve) => {
        release = resolve;
      });
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
  return { engine, created, admits: () => admits, release: (code: number) => release(code) };
}

/** Lets every microtask of a released admit and its cleanup run. */
async function flush(): Promise<void> {
  for (let i = 0; i < 50; i++) await Promise.resolve();
}

describe('body helper: the admit one-shot and the deadline', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('an admit that hangs past the deadline creates nothing, and its slot is held until the admit settles', async () => {
    vi.useFakeTimers();
    const fake = holdAdmitEngine();
    const handle = createBodyHelper({
      roster,
      engine: fake.engine,
      cap: 1,
      template: TEMPLATE,
      audit: () => undefined,
      requestDeadlineMs: 1000,
    });
    const first = handle(req('start', 'ranger'));
    await vi.advanceTimersByTimeAsync(1000);
    expect(await first).toEqual({ ok: false, code: 'timeout', error: ENGINE_TIMEOUT });
    // The admit is still held, so the abandoned start has taken no create and still holds its cap slot.
    expect(fake.created).toEqual([]);
    const second = await handle(req('start', 'miner'));
    expect(second).toMatchObject({ ok: false, error: CAP_REFUSAL });
    // The admit settles after the deadline: the abandoned run makes no create and gives its slot back.
    fake.release(0);
    await flush();
    expect(fake.created).toEqual([]);
    expect(await handle(req('start', 'vale'))).toEqual({ ok: true, state: 'started' });
    expect(fake.created).toEqual(['vale']);
    expect(fake.admits()).toBe(2);
  });
});
