import { afterEach, describe, expect, it } from 'vitest';
import type { ThinkerHub } from './hub.ts';
import { FakeThinker, MODEL, pause, startHub, until } from './thinker.fakes.ts';

let hub: ThinkerHub | undefined;
const thinkers: FakeThinker[] = [];

afterEach(async () => {
  for (const t of thinkers.splice(0)) t.close();
  await hub?.stop();
  hub = undefined;
});

async function connected(): Promise<FakeThinker> {
  const t = new FakeThinker();
  thinkers.push(t);
  await t.connect(hub as ThinkerHub);
  return t;
}

describe('ThinkerHub handshake', () => {
  it('welcomes with the configured name and only the models the Mind pins', async () => {
    hub = await startHub();
    const t = await connected();
    const welcome = await t.hello([
      [MODEL, 2],
      ['unpinned:1b', 4],
    ]);
    expect(welcome.thinker).toBe('test-thinker');
    expect(welcome.accepted_models).toEqual([MODEL]);
    expect(hub.stats()).toMatchObject([{ id: 'local-1', state: 'ready', models: [MODEL] }]);
  });

  it('gives each connection its own identity and never reads one from a frame', async () => {
    hub = await startHub();
    const a = await connected();
    const b = await connected();
    await a.hello();
    // A hello that asserts who it is fails the strict schema and is dropped.
    b.send({ type: 'hello', thinker: 'local-1', thinker_version: '1.0.0', models: [] });
    await until(() => hub?.session('local-2')?.droppedFrames === 1, 'the forged hello drop');
    expect(hub.session('local-2')?.state).toBe('awaiting_hello');
    expect(hub.stats().map((s) => s.id)).toEqual(['local-1', 'local-2']);
  });

  it('closes a connection that sends no hello in time', async () => {
    hub = await startHub({ helloTimeoutMs: 80 });
    const t = await connected();
    expect(await t.closed()).toBe(1008);
  });

  it('closes a connection that sends a second hello', async () => {
    hub = await startHub();
    const t = await connected();
    await t.hello();
    t.send({
      type: 'hello',
      thinker_version: '1.0.0',
      models: [{ name: MODEL, max_concurrent: 1, max_tokens: 1 }],
    });
    expect(await t.closed()).toBe(1008);
  });

  it('refuses any frame before the hello', async () => {
    hub = await startHub();
    const t = await connected();
    t.send({ type: 'heartbeat', load: {} });
    await until(() => hub?.session('local-1')?.droppedFrames === 1, 'the early frame drop');
    expect(hub.session('local-1')?.state).toBe('awaiting_hello');
  });

  it('refuses a connection that carries an Origin header', async () => {
    hub = await startHub();
    const t = new FakeThinker();
    await expect(t.connect(hub, { Origin: 'http://page.example' })).rejects.toThrow();
    expect(hub.stats()).toEqual([]);
  });
});

describe('ThinkerHub frames', () => {
  it('drops non-JSON, invalid and colo-only frames and counts each', async () => {
    hub = await startHub();
    const t = await connected();
    await t.hello();
    t.send('not json');
    t.send({ type: 'heartbeat' });
    t.send({ type: 'job', job_id: 'jb_x' });
    t.send({ type: 'cancel', job_id: 'jb_01J0000000000000000000000A' });
    await until(() => hub?.session('local-1')?.droppedFrames === 4, 'four drops');
    expect(hub.stats()[0]?.state).toBe('ready');
  });

  it('closes a connection that sends a frame over 1 MiB and counts it', async () => {
    hub = await startHub();
    const t = await connected();
    await t.hello();
    const session = hub.session('local-1');
    t.send(JSON.stringify({ type: 'heartbeat', load: {}, pad: 'x'.repeat(1024 * 1024) }));
    expect(await t.closed()).toBe(1009);
    expect(session?.droppedFrames).toBe(1);
  });
});

describe('ThinkerHub liveness', () => {
  it('marks a connection down when its heartbeat is older than 45 s, and up again on a heartbeat', async () => {
    let now = 1_000_000;
    hub = await startHub({ now: () => now });
    const t = await connected();
    await t.hello();
    expect(hub.pick(MODEL)).toBeDefined();
    now += 44_000;
    expect(hub.pick(MODEL)).toBeDefined();
    now += 2000;
    expect(hub.pick(MODEL)).toBeUndefined();
    t.send({ type: 'heartbeat', load: { [MODEL]: 0 } });
    await until(() => hub?.pick(MODEL) !== undefined, 'the heartbeat to revive the connection');
  });

  it('does not offer a Thinker that said goodbye', async () => {
    hub = await startHub();
    const t = await connected();
    await t.hello();
    t.send({ type: 'goodbye', reason: 'shutdown' });
    await until(() => hub?.session('local-1')?.leaving === true, 'the goodbye');
    expect(hub.pick(MODEL)).toBeUndefined();
  });

  it('sends drain and closes every connection on stop', async () => {
    hub = await startHub();
    const t = await connected();
    await t.hello();
    await hub.stop();
    expect((await t.next('drain')).reconnect_after_seconds).toBe(5);
    expect(await t.closed()).toBe(1001);
    await pause(10);
    expect(hub.stats()).toEqual([]);
  });
});
