import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type FakeMind, type FakeOllama, pin, until } from './thinker.fakes.ts';
import { answer, type Rig, startRig } from './thinker.fixture.ts';

let rig: Rig;
let mind: FakeMind;
let ollama: FakeOllama;
let logs: string[];
let launch: Rig['launch'];
let launchWarm: Rig['launchWarm'];

beforeEach(async () => {
  rig = await startRig();
  ({ mind, ollama, logs, launch, launchWarm } = rig);
});

afterEach(async () => {
  await rig.close();
});
describe('warm-up', () => {
  it('loads each pinned model, one at a time, before it sends hello', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    ollama.warmHandler = async (_r, res) => {
      await gate;
      ollama.reply(res, { message: { content: '' } });
    };
    launchWarm({ models: [pin('qwen3:8b'), pin('qwen3:32b')] });
    await until(() => ollama.requests.length === 1, 'the first warm-up');
    await new Promise((r) => setTimeout(r, 50));
    expect(ollama.requests).toHaveLength(1);
    expect(mind.frames).toHaveLength(0);
    release();
    const hello = await mind.next('hello');
    expect(ollama.requests.map((r) => r.body.model)).toEqual(['qwen3:8b', 'qwen3:32b']);
    expect(ollama.requests[0]?.body).toMatchObject({
      keep_alive: '30m',
      think: false,
      options: { num_ctx: 8192, num_predict: 1, temperature: 0 },
    });
    expect((hello.models as { name: string }[]).map((m) => m.name)).toEqual([
      'qwen3:8b',
      'qwen3:32b',
    ]);
    expect(logs).toEqual(
      expect.arrayContaining([
        'warming qwen3:8b',
        expect.stringMatching(/^warm qwen3:8b in \d+ ms$/),
        'warming qwen3:32b',
        expect.stringMatching(/^warm qwen3:32b in \d+ ms$/),
      ]),
    );
  });

  it('does not advertise a model whose warm-up fails, and says why', async () => {
    ollama.warmHandler = (req, res) => {
      if (req.body.model === 'qwen3:32b') ollama.reply(res, { error: 'no memory' }, 500);
      else ollama.reply(res, { message: { content: '' } });
    };
    launchWarm({ models: [pin('qwen3:8b'), pin('qwen3:32b')] });
    const hello = await mind.next('hello');
    expect((hello.models as { name: string }[]).map((m) => m.name)).toEqual(['qwen3:8b']);
    expect(logs).toContain('warm failed qwen3:32b: Ollama answered 500');
  });

  it('advertises nothing while no model is warm, and retries the warm-up with backoff', async () => {
    let attempts = 0;
    ollama.warmHandler = (_r, res) => {
      attempts += 1;
      if (attempts === 1) ollama.reply(res, { error: 'loading' }, 503);
      else ollama.reply(res, { message: { content: '' } });
    };
    launchWarm();
    const hello = await mind.next('hello');
    expect(attempts).toBe(2);
    expect(hello.models).toEqual([{ name: 'qwen3:8b', max_concurrent: 1, max_tokens: 2048 }]);
    expect(logs).toContain('no pinned model warmed; advertising nothing and retrying');
    expect(logs.some((l) => l.startsWith('reconnecting in'))).toBe(true);
  });

  it('gives up on a warm-up that outlives the warm timeout, and sends no hello', async () => {
    ollama.warmHandler = () => {};
    launchWarm({ warmTimeoutMs: 80 });
    await until(
      () => logs.includes('warm failed qwen3:8b: no answer within 80 ms'),
      'the warm timeout',
    );
    expect(mind.frames).toHaveLength(0);
  });

  it('warms once per process: a dial that fails after the warm-up does not warm again', async () => {
    mind.autoWelcome = false;
    launchWarm({ helloTimeoutMs: 40 });
    await until(() => mind.connections >= 3, 'three dial attempts');
    expect(ollama.requests.filter((r) => r.body.model === 'qwen3:8b')).toHaveLength(1);
  });

  it('does not cache a partial warm-up: the next dial warms the missing model and advertises it', async () => {
    let failing = true;
    ollama.warmHandler = (req, res) => {
      if (req.body.model === 'qwen3:32b' && failing) ollama.reply(res, { error: 'no memory' }, 500);
      else ollama.reply(res, { message: { content: '' } });
    };
    launchWarm({ models: [pin('qwen3:8b'), pin('qwen3:32b')] });
    await mind.next('hello');
    failing = false;
    mind.push({ type: 'drain', reconnect_after_seconds: 0 });
    await until(
      () => mind.frames.filter((f) => f.type === 'hello').length === 2,
      'the second hello',
    );
    const second = mind.frames.filter((f) => f.type === 'hello')[1];
    expect((second as { models: { name: string }[] }).models.map((m) => m.name)).toEqual([
      'qwen3:8b',
      'qwen3:32b',
    ]);
    expect(ollama.requests.filter((r) => r.body.model === 'qwen3:32b')).toHaveLength(2);
  });

  it('warms only the run tier model when it is named, and advertises only that one', async () => {
    launchWarm({ models: [pin('qwen3:8b'), pin('qwen3:32b')], warmNames: ['qwen3:32b'] });
    const hello = await mind.next('hello');
    expect(ollama.requests.map((r) => r.body.model)).toEqual(['qwen3:32b']);
    expect((hello.models as { name: string }[]).map((m) => m.name)).toEqual(['qwen3:32b']);
  });

  it('re-checks the digests before each dial and advertises only the models that still match', async () => {
    mind.autoWelcome = false;
    let matching = ['qwen3:8b', 'qwen3:32b'];
    launchWarm({
      models: [pin('qwen3:8b'), pin('qwen3:32b')],
      helloTimeoutMs: 40,
      recheck: async () => matching,
    });
    await until(() => mind.frames.filter((f) => f.type === 'hello').length === 1, 'first hello');
    matching = ['qwen3:8b'];
    await until(() => mind.frames.filter((f) => f.type === 'hello').length === 2, 'second hello');
    const hellos = mind.frames.filter((f) => f.type === 'hello');
    expect(hellos[1]?.models).toEqual([{ name: 'qwen3:8b', max_concurrent: 1, max_tokens: 2048 }]);
    expect(ollama.requests.filter((r) => r.body.model === 'qwen3:32b')).toHaveLength(1);
  });
});

/** The one-token warm and ping calls the fake Ollama has received (num_predict 1). */
const warmCalls = (): (typeof ollama.requests)[number][] =>
  ollama.requests.filter(
    (r) => (r.body.options as { num_predict?: number } | undefined)?.num_predict === 1,
  );

describe('keep-alive', () => {
  afterEach(() => vi.restoreAllMocks());

  it('sends a one-token call to each advertised model on a timer, with the pin keep_alive', async () => {
    launchWarm({ keepAlivePingMs: 20 });
    await mind.next('hello');
    await until(() => warmCalls().length >= 3, 'the warm-up and two pings');
    expect(
      warmCalls().every((r) => r.body.model === 'qwen3:8b' && r.body.keep_alive === '30m'),
    ).toBe(true);
  });

  it('logs a failed ping and keeps pinging', async () => {
    ollama.warmHandler = (_req, res) => {
      if (warmCalls().length === 1) ollama.reply(res, { message: { content: '' } });
      else ollama.reply(res, { error: 'busy' }, 500);
    };
    launchWarm({ keepAlivePingMs: 20 });
    await mind.next('hello');
    await until(
      () => logs.includes('keep-alive ping failed qwen3:8b: Ollama answered 500'),
      'a failed ping',
    );
    await until(() => warmCalls().length >= 3, 'a ping after the failure');
  });

  it('stop() aborts a ping in flight and sends no more pings', async () => {
    ollama.warmHandler = (_req, res) => {
      if (warmCalls().length > 1) return;
      ollama.reply(res, { message: { content: '' } });
    };
    const t = launchWarm({ keepAlivePingMs: 20 });
    await mind.next('hello');
    await until(() => warmCalls().length === 2, 'a ping that hangs');
    await t.stop();
    await until(() => warmCalls()[1]?.aborted === true, 'the ping aborted by stop()');
    await new Promise((r) => setTimeout(r, 100));
    expect(warmCalls()).toHaveLength(2);
  });

  it('sends no ping after stop(): the timer is cleared', async () => {
    const t = launchWarm({ keepAlivePingMs: 20 });
    await mind.next('hello');
    await until(() => warmCalls().length >= 2, 'a ping');
    await t.stop();
    const settled = warmCalls().length;
    await new Promise((r) => setTimeout(r, 100));
    expect(warmCalls()).toHaveLength(settled);
  });

  it('stop() clears the ping interval itself, not only the sends it guards', async () => {
    const sets = vi.spyOn(globalThis, 'setInterval');
    const clears = vi.spyOn(globalThis, 'clearInterval');
    const t = launchWarm({ keepAlivePingMs: 20 });
    const index = sets.mock.calls.findIndex(([, ms]) => ms === 20);
    const timer = sets.mock.results[index]?.value;
    expect(timer).toBeDefined();
    await t.stop();
    expect(clears).toHaveBeenCalledWith(timer);
  });

  describe('keep-warm set (hardware: one chat model fits in VRAM with the embedder)', () => {
    const both = [pin('qwen3:32b'), pin('qwen3:8b')];
    const chatPings = (name: string): number =>
      warmCalls().filter((r) => r.body.model === name).length;
    const UNSET =
      'run_tier is not set: not keeping both chat models warm (they cannot both fit in VRAM)';

    it('run_tier strong: after hello, pings only the strong model and the embedder', async () => {
      let embeds = 0;
      launchWarm({
        models: both,
        keepWarmNames: ['qwen3:32b'],
        keepAlivePingMs: 20,
        pingEmbedder: async () => {
          embeds += 1;
        },
      });
      await mind.next('hello');
      const eight = chatPings('qwen3:8b');
      const strong = chatPings('qwen3:32b');
      await until(
        () => embeds >= 2 && chatPings('qwen3:32b') >= strong + 2,
        'strong and embedder pings',
      );
      expect(chatPings('qwen3:8b')).toBe(eight);
    });

    it('run_tier fast: after hello, pings only the fast model and the embedder', async () => {
      let embeds = 0;
      launchWarm({
        models: both,
        keepWarmNames: ['qwen3:8b'],
        keepAlivePingMs: 20,
        pingEmbedder: async () => {
          embeds += 1;
        },
      });
      await mind.next('hello');
      const strong = chatPings('qwen3:32b');
      const fast = chatPings('qwen3:8b');
      await until(
        () => embeds >= 2 && chatPings('qwen3:8b') >= fast + 2,
        'fast and embedder pings',
      );
      expect(chatPings('qwen3:32b')).toBe(strong);
    });

    it('run_tier unset: pings no chat model, pings the embedder, and logs the warning once', async () => {
      let embeds = 0;
      launchWarm({
        models: both,
        keepWarmNames: [],
        keepWarmWarning: UNSET,
        keepAlivePingMs: 20,
        pingEmbedder: async () => {
          embeds += 1;
        },
      });
      await mind.next('hello');
      const before = warmCalls().length;
      await until(() => embeds >= 3, 'three embedder pings');
      expect(warmCalls()).toHaveLength(before);
      expect(logs.filter((l) => l === UNSET)).toHaveLength(1);
    });

    it('a failed embedder ping is logged and the pings go on', async () => {
      let embeds = 0;
      launchWarm({
        keepAlivePingMs: 20,
        pingEmbedder: async () => {
          embeds += 1;
          throw new Error('embedder down');
        },
      });
      await mind.next('hello');
      await until(
        () =>
          logs.filter((l) => l === 'keep-alive ping failed embedder: unexpected failure').length >=
          2,
        'two logged embedder failures',
      );
      expect(embeds).toBeGreaterThanOrEqual(2);
    });

    it('does not re-warm a chat model the run tier does not keep', async () => {
      ollama.handler = (_req, res) => ollama.reply(res, answer);
      launchWarm({
        models: both,
        keepWarmNames: ['qwen3:32b'],
        coldAfterIdleMs: 0,
        slowFirstTokenMs: 0,
      });
      await mind.next('hello');
      const before = chatPings('qwen3:8b');
      mind.push(mind.job());
      await mind.next('completion');
      await new Promise((r) => setTimeout(r, 100));
      expect(chatPings('qwen3:8b')).toBe(before);
    });
  });

  it('re-warms a model after a slow job that follows an idle spell, and logs why', async () => {
    ollama.handler = (_req, res) => ollama.reply(res, answer);
    launchWarm({ coldAfterIdleMs: 0, slowFirstTokenMs: 0 });
    await mind.next('hello');
    mind.push(mind.job());
    await mind.next('completion');
    await until(() => warmCalls().length === 2, 're-warm after the job');
    expect(logs.some((l) => l.startsWith('cold start: job '))).toBe(true);
  });

  it('does not re-warm after a fast job on a recently used model', async () => {
    ollama.handler = (_req, res) => ollama.reply(res, answer);
    launchWarm();
    await mind.next('hello');
    mind.push(mind.job());
    await mind.next('completion');
    expect(warmCalls()).toHaveLength(1);
  });
});
