import { describe, expect, it } from 'vitest';
import {
  bodyFixture,
  createFakeEngine,
  type FakeContainer,
  type FakeEngine,
  hostFixture,
} from './fake-engine.ts';
import { ALREADY_RUNNING, type BodyEngine, CAP_REFUSAL, createBodyHelper } from './service.ts';

const wiring = {
  shard: 'colo',
  uid: '1000',
  mcHost: 'velocity',
  mcPort: '25565',
  natsUrl: 'nats://nats:4222',
  natsUser: 'body',
  natsSecretHostPath: '/host/secrets/nats-body.txt',
  shardHostPath: '/host/shards/colo.yaml',
};
const limits = { nanoCpus: 1_000_000_000, memory: 512 * 1024 * 1024, pidsLimit: 256 };

/** A handler over any engine, with the audit lines it writes. */
function handleOver(engine: BodyEngine, cap = 40) {
  const audit: string[] = [];
  const handle = createBodyHelper({
    roster: { displayName: async (_owner, name) => name, lifeId: async () => 'ag_0123456789ab' },
    engine,
    cap,
    template: {
      image: 'geldar/body:test',
      wiring,
      limits,
      managed: {
        enabled: true,
        db: { host: 'db', port: '5432', role: 'body', secretHostPath: '/root/secrets/db.txt' },
        rconSecretHostPath: '/root/secrets/rcon.txt',
      },
    },
    audit: (line) => audit.push(line),
  });
  return { handle, audit };
}

function helperWith(containers: FakeContainer[], cap = 40) {
  const engine = createFakeEngine(containers);
  return { engine, ...handleOver(engine, cap) };
}

/** The same engine with a 5 ms wait before every call, so concurrent verbs overlap in the helper. */
function slowed(engine: FakeEngine, ms = 5): FakeEngine {
  const wait =
    <A extends unknown[], R>(f: (...args: A) => Promise<R>) =>
    async (...args: A): Promise<R> => {
      await new Promise((resolve) => setTimeout(resolve, ms));
      return f(...args);
    };
  return {
    ...engine,
    inspect: wait(engine.inspect),
    countCounted: wait(engine.countCounted),
    create: wait(engine.create),
    start: wait(engine.start),
    stop: wait(engine.stop),
    remove: wait(engine.remove),
    logs: wait(engine.logs),
    bodies: wait(engine.bodies),
  };
}

/** n running Bodies named body00..body(n-1), so each is a roster name the fake roster accepts. */
function bodies(n: number): FakeContainer[] {
  return Array.from({ length: n }, (_, i) =>
    bodyFixture(`body${String(i).padStart(2, '0')}`, true),
  );
}

describe('global body cap (GLOBAL-CAP)', () => {
  it('counts the 15 sovereign hosts: 24 Bodies and 15 hosts is 39, so one start is allowed and the next is refused', async () => {
    const hosts = Array.from({ length: 15 }, (_, i) => hostFixture(`p${i}`));
    const { engine, handle } = helperWith([...bodies(24), ...hosts]);
    expect(await engine.countCounted()).toBe(39);
    expect(await handle({ verb: 'start', name: 'Newcomer1', owner: 'o' })).toMatchObject({
      ok: true,
      state: 'started',
    });
    expect(await engine.countCounted()).toBe(40);
    expect(await handle({ verb: 'start', name: 'Newcomer2', owner: 'o' })).toMatchObject({
      ok: false,
      code: 'capacity',
      error: CAP_REFUSAL,
    });
  });

  it('accepts the last allowed start at 39 running and refuses the 40th with the stable reason and no container', async () => {
    const { engine, handle, audit } = helperWith(bodies(39));
    expect(await handle({ verb: 'start', name: 'Newcomer1', owner: 'o' })).toMatchObject({
      ok: true,
    });
    expect(engine.created).toEqual(['newcomer1']);
    const before = engine.containers.length;
    expect(await handle({ verb: 'start', name: 'Newcomer2', owner: 'o' })).toEqual({
      ok: false,
      code: 'capacity',
      error: 'global body cap reached',
    });
    expect(engine.containers.length).toBe(before);
    expect(audit.some((line) => line.includes('outcome=capacity'))).toBe(true);
  });

  it('writes one alert line when the count first reaches 80, not on the next starts', async () => {
    const { handle, audit } = helperWith(bodies(80), 100);
    await handle({ verb: 'start', name: 'Newcomer1', owner: 'o' });
    await handle({ verb: 'start', name: 'Newcomer2', owner: 'o' });
    const alerts = audit.filter((line) => line.startsWith('body-helper alert'));
    expect(alerts).toEqual(['body-helper alert running=80 threshold=80']);
  });

  it('a Docker error after the count check releases nothing: the failed start is removed and no slot is kept', async () => {
    const engine = createFakeEngine(bodies(38));
    const failing = {
      ...engine,
      start: async () => Promise.reject(new Error('docker start refused')),
    };
    const { handle, audit } = handleOver(failing);
    expect(await handle({ verb: 'start', name: 'Newcomer1', owner: 'o' })).toMatchObject({
      ok: false,
      code: 'failed',
    });
    expect(engine.containers.filter((c) => c.name === 'newcomer1')).toEqual([]);
    expect(await engine.countCounted()).toBe(38);
    expect(audit.filter((line) => line.includes('outcome=failed'))).toHaveLength(1);
  });
});

describe('concurrent starts (GLOBAL-CAP, serialized)', () => {
  it('four concurrent starts at 39 running: exactly one starts and three are refused with the cap reason', async () => {
    const engine = createFakeEngine(bodies(39));
    const { handle } = handleOver(slowed(engine));
    const replies = await Promise.all(
      ['Newcomer1', 'Newcomer2', 'Newcomer3', 'Newcomer4'].map((name) =>
        handle({ verb: 'start', name, owner: 'o' }),
      ),
    );
    expect(replies.filter((r) => r.ok && r.state === 'started')).toHaveLength(1);
    expect(
      replies.filter((r) => !r.ok && r.code === 'capacity' && r.error === CAP_REFUSAL),
    ).toHaveLength(3);
    expect(await engine.countCounted()).toBe(40);
    expect(engine.created).toEqual(['newcomer1']);
  });

  it('two concurrent starts of one name: one starts and the other is refused as already running', async () => {
    const engine = createFakeEngine([]);
    const { handle } = handleOver(slowed(engine));
    const replies = await Promise.all([
      handle({ verb: 'start', name: 'Newcomer1', owner: 'o' }),
      handle({ verb: 'start', name: 'Newcomer1', owner: 'o' }),
    ]);
    expect(replies.filter((r) => r.ok && r.state === 'started')).toHaveLength(1);
    expect(
      replies.filter((r) => !r.ok && r.code === 'refused' && r.error === ALREADY_RUNNING),
    ).toHaveLength(1);
    expect(engine.created).toEqual(['newcomer1']);
  });

  it('a failing create does not block the queued start: the first start fails and the second one still starts', async () => {
    const engine = createFakeEngine([]);
    const flaky = slowed({
      ...engine,
      create: async (name, config) => {
        if (name === 'newcomer1') throw new Error('docker create refused');
        return engine.create(name, config);
      },
    });
    const { handle } = handleOver(flaky);
    const [first, second] = await Promise.all([
      handle({ verb: 'start', name: 'Newcomer1', owner: 'o' }),
      handle({ verb: 'start', name: 'Newcomer2', owner: 'o' }),
    ]);
    expect(first).toMatchObject({ ok: false, code: 'failed' });
    expect(second).toMatchObject({ ok: true, state: 'started' });
    expect(engine.containers.filter((c) => c.name === 'newcomer1')).toEqual([]);
    expect(await engine.countCounted()).toBe(1);
  });
});
