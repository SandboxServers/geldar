import { describe, expect, it } from 'vitest';
import { type GlobalCap, globalBodyCapFromEnv } from './config.ts';
import { bodyFixture, createFakeEngine, type FakeContainer, hostFixture } from './fake-engine.ts';
import { CAP_REFUSAL, createBodyHelper } from './service.ts';

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

function helperWith(containers: FakeContainer[], cap: GlobalCap = { ok: true, cap: 40 }) {
  const engine = createFakeEngine(containers);
  const audit: string[] = [];
  const handle = createBodyHelper({
    roster: { displayName: async (_owner, name) => name },
    engine,
    cap,
    template: { image: 'geldar/body:test', wiring, limits },
    audit: (line) => audit.push(line),
  });
  return { engine, audit, handle };
}

/** n running Bodies named body-0..body-(n-1), so each is a roster name the fake roster accepts. */
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

  it('writes one alert line when the count first reaches 30, not on the next starts', async () => {
    const { handle, audit } = helperWith(bodies(30));
    await handle({ verb: 'start', name: 'Newcomer1', owner: 'o' });
    await handle({ verb: 'start', name: 'Newcomer2', owner: 'o' });
    const alerts = audit.filter((line) => line.startsWith('body-helper alert'));
    expect(alerts).toEqual(['body-helper alert running=30 threshold=30']);
  });

  it('refuses every start with a config error when the cap is invalid, and creates nothing', async () => {
    const bad = globalBodyCapFromEnv({ GELDAR_GLOBAL_BODY_CAP: '0' });
    expect(bad.ok).toBe(false);
    const { engine, handle } = helperWith([], bad);
    expect(await handle({ verb: 'start', name: 'Newcomer1', owner: 'o' })).toMatchObject({
      ok: false,
      code: 'cap_config',
    });
    expect(engine.created).toEqual([]);
  });

  it('a Docker error after the count check releases nothing: the failed start is removed and no slot is kept', async () => {
    const engine = createFakeEngine(bodies(38));
    const failing = {
      ...engine,
      start: async () => Promise.reject(new Error('docker start refused')),
    };
    const audit: string[] = [];
    const handle = createBodyHelper({
      roster: { displayName: async (_o, name) => name },
      engine: failing,
      cap: { ok: true, cap: 40 },
      template: { image: 'geldar/body:test', wiring, limits },
      audit: (line) => audit.push(line),
    });
    expect(await handle({ verb: 'start', name: 'Newcomer1', owner: 'o' })).toMatchObject({
      ok: false,
      code: 'failed',
    });
    expect(engine.containers.filter((c) => c.name === 'newcomer1')).toEqual([]);
    expect(await engine.countCounted()).toBe(38);
    expect(audit.filter((line) => line.includes('outcome=failed'))).toHaveLength(1);
  });
});
