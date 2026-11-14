import { afterEach, describe, expect, it, vi } from 'vitest';
import { bodyFixture, createFakeEngine, type FakeContainer } from './fake-engine.ts';
import {
  type BodyEngine,
  CAP_REFUSAL,
  type ContainerState,
  createBodyHelper,
  ENGINE_TIMEOUT,
  REQUEST_DEADLINE_MS,
} from './service.ts';
import { sweepStrays } from './sweep.ts';

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

type Call = 'countCounted' | 'create' | 'start' | 'stop' | 'remove';

/** An Engine whose named calls wait at a gate until the test opens it. Every call is logged when it is made. */
function gatedEngine(hold: Call[], seed: FakeContainer[] = []) {
  const fake = createFakeEngine(seed);
  const calls: string[] = [];
  let open: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    open = () => resolve();
  });
  const gated =
    <A extends unknown[], R>(call: Call, run: (...args: A) => Promise<R>) =>
    async (...args: A): Promise<R> => {
      calls.push(call);
      if (hold.includes(call)) await gate;
      return run(...args);
    };
  const engine: BodyEngine = {
    inspect: async (name) => {
      calls.push('inspect');
      return fake.inspect(name);
    },
    countCounted: gated('countCounted', fake.countCounted),
    create: gated('create', fake.create),
    start: gated('start', fake.start),
    stop: gated('stop', fake.stop),
    remove: gated('remove', fake.remove),
    logs: fake.logs,
  };
  return { engine, fake, calls, release: () => open() };
}

/** Lets every microtask of a released Engine call and its cleanup run. */
async function flush(): Promise<void> {
  for (let i = 0; i < 50; i++) await Promise.resolve();
}

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

const accepted = (audit: string[]) => audit.some((line) => line.includes('outcome=accepted'));

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
    expect(await first).toEqual({ ok: false, code: 'timeout', error: ENGINE_TIMEOUT });
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
    expect(await first).toEqual({ ok: false, code: 'timeout', error: ENGINE_TIMEOUT });
    // The hung inspect answers late, with no container: the abandoned start must not create one.
    fake.release(null);
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.created).toEqual([]);
  });

  // Each row holds one Engine call past the deadline. After the release the abandoned start may clean up what it
  // made, but it makes no other Engine call, leaves nothing running, and audits no `accepted` line.
  // `left` is how many containers remain after the release: a stopped Body the helper did not create by this run stays.
  const rows: { name: string; hold: Call; seed: FakeContainer[]; calls: string[]; left: number }[] =
    [
      {
        name: 'countCounted',
        hold: 'countCounted',
        seed: [],
        calls: ['inspect', 'countCounted'],
        left: 0,
      },
      {
        name: 'countCounted with a stopped Body of the name',
        hold: 'countCounted',
        seed: [bodyFixture('ranger', false)],
        calls: ['inspect', 'countCounted'],
        left: 1,
      },
      {
        name: 'remove',
        hold: 'remove',
        seed: [bodyFixture('ranger', false)],
        calls: ['inspect', 'countCounted', 'remove'],
        left: 0,
      },
      {
        name: 'create',
        hold: 'create',
        seed: [],
        calls: ['inspect', 'countCounted', 'create', 'remove'],
        left: 0,
      },
      {
        name: 'start',
        hold: 'start',
        seed: [],
        calls: ['inspect', 'countCounted', 'create', 'start', 'remove'],
        left: 0,
      },
    ];
  it.each(rows)(
    'a hung $name past the deadline: no later Engine call runs, nothing is left',
    async (row) => {
      vi.useFakeTimers();
      const gate = gatedEngine([row.hold], row.seed);
      const audit: string[] = [];
      const handle = createBodyHelper({
        roster,
        engine: gate.engine,
        cap: 40,
        template: TEMPLATE,
        audit: (line) => audit.push(line),
        requestDeadlineMs: 1000,
      });
      const first = handle(req('start', 'ranger'));
      await vi.advanceTimersByTimeAsync(1000);
      expect(await first).toEqual({ ok: false, code: 'timeout', error: ENGINE_TIMEOUT });
      gate.release();
      await flush();
      expect(gate.calls).toEqual(row.calls);
      expect(gate.fake.containers.filter((c) => c.running)).toEqual([]);
      expect(gate.fake.containers.length).toBe(row.left);
      expect(accepted(audit)).toBe(false);
    },
  );

  it('a start in flight at the deadline holds its cap slot: a queued start is refused, then the slot frees', async () => {
    vi.useFakeTimers();
    const gate = gatedEngine(['start']);
    const handle = createBodyHelper({
      roster,
      engine: gate.engine,
      cap: 1,
      template: TEMPLATE,
      audit: () => undefined,
      requestDeadlineMs: 1000,
    });
    const first = handle(req('start', 'ranger'));
    await vi.advanceTimersByTimeAsync(1000);
    expect(await first).toEqual({ ok: false, code: 'timeout', error: ENGINE_TIMEOUT });
    // The ranger start is still in flight and not yet running: the queued start must still see the slot taken.
    const second = handle(req('start', 'miner'));
    expect(await second).toEqual({ ok: false, code: 'capacity', error: CAP_REFUSAL });
    gate.release();
    await flush();
    const running = gate.fake.containers.filter((c) => c.running);
    expect(running).toEqual([]);
    expect(await handle(req('start', 'miner'))).toEqual({ ok: true, state: 'started' });
    expect(gate.fake.containers.filter((c) => c.running).length).toBe(1);
  });

  it('a start that finishes before the deadline leaves no timer behind', async () => {
    vi.useFakeTimers();
    const audit: string[] = [];
    const handle = createBodyHelper({
      roster,
      engine: createFakeEngine(),
      cap: 40,
      template: TEMPLATE,
      audit: (line) => audit.push(line),
      requestDeadlineMs: 1000,
    });
    expect(await handle(req('start', 'ranger'))).toEqual({ ok: true, state: 'started' });
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(5000);
    expect(audit.some((line) => line.includes('engine_timeout'))).toBe(false);
  });

  it('a hung stop is answered engine timeout at the deadline, and the next queued start runs', async () => {
    vi.useFakeTimers();
    const gate = gatedEngine(['stop'], [bodyFixture('ranger', true)]);
    const handle = createBodyHelper({
      roster,
      engine: gate.engine,
      cap: 40,
      template: TEMPLATE,
      audit: () => undefined,
      requestDeadlineMs: 1000,
    });
    const stopping = handle(req('stop', 'ranger'));
    const starting = handle(req('start', 'miner'));
    await vi.advanceTimersByTimeAsync(1000);
    expect(await stopping).toEqual({ ok: false, code: 'timeout', error: ENGINE_TIMEOUT });
    expect(await starting).toEqual({ ok: true, state: 'started' });
    expect(gate.fake.created).toEqual(['miner']);
    gate.release();
    await flush();
  });

  it('the sweep lists a Body whose stop timed out while it still runs, and stops once the stop lands', async () => {
    vi.useFakeTimers();
    const gate = gatedEngine(['stop'], [bodyFixture('ranger', true)]);
    const stopTimeouts = new Set<string>();
    const audit: string[] = [];
    const handle = createBodyHelper({
      roster,
      engine: gate.engine,
      cap: 40,
      template: TEMPLATE,
      audit: (line) => audit.push(line),
      requestDeadlineMs: 1000,
      stopTimeouts,
    });
    const stopping = handle(req('stop', 'ranger'));
    await vi.advanceTimersByTimeAsync(1000);
    expect(await stopping).toEqual({ ok: false, code: 'timeout', error: ENGINE_TIMEOUT });
    const sweep = () =>
      sweepStrays({ engine: gate.fake, roster, audit: (line) => audit.push(line), stopTimeouts });
    await sweep();
    expect(audit).toContain('body-helper stop_timed_out name=ranger outcome=report_only');
    gate.release();
    await flush();
    expect(gate.fake.containers[0]?.running).toBe(false);
    audit.length = 0;
    await sweep();
    expect(audit.some((line) => line.includes('stop_timed_out'))).toBe(false);
  });
});
