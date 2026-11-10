import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ollamaChat, ollamaWarm } from '../src/ollama.ts';
import {
  DEFAULT_BACKOFF_INITIAL_MS,
  DEFAULT_BACKOFF_MAX_MS,
  jitteredDelay,
  LocalThinker,
  type ThinkerOptions,
} from '../src/thinker.ts';
import { FakeMind, FakeOllama, pin, until } from './thinker.fakes.ts';

let mind: FakeMind;
let ollama: FakeOllama;
let thinker: LocalThinker | undefined;
const logs: string[] = [];

beforeEach(async () => {
  logs.length = 0;
  mind = new FakeMind();
  ollama = new FakeOllama();
  await Promise.all([mind.start(), ollama.start()]);
});

afterEach(async () => {
  await thinker?.stop();
  thinker = undefined;
  await Promise.all([mind.stop(), ollama.stop()]);
});

function launch(overrides: Partial<ThinkerOptions> = {}): LocalThinker {
  thinker = new LocalThinker({
    wsUrl: mind.url,
    models: [pin()],
    chat: ollamaChat(ollama.url),
    version: '1.2.3',
    backoffInitialMs: 30,
    backoffMaxMs: 120,
    log: (line) => logs.push(line),
    ...overrides,
  });
  thinker.start();
  return thinker;
}

describe('reconnect backoff', () => {
  it('starts at 250 ms and caps at 5 s by default, with jitter between half and all of each step', () => {
    expect(DEFAULT_BACKOFF_INITIAL_MS).toBe(250);
    expect(DEFAULT_BACKOFF_MAX_MS).toBe(5000);
    expect(jitteredDelay(250, () => 0)).toBe(125);
    expect(jitteredDelay(250, () => 0.999999)).toBe(249);
    expect(jitteredDelay(5000, () => 0.5)).toBe(3750);
  });

  it('doubles each failed attempt up to the cap, and logs each with its delay', async () => {
    launch({ wsUrl: 'ws://127.0.0.1:1/v1/thinker/stream', random: () => 1 });
    await until(() => logs.filter((l) => l.startsWith('reconnecting')).length >= 4, 'four retries');
    expect(logs.filter((l) => l.startsWith('reconnecting')).slice(0, 4)).toEqual([
      'reconnecting in 30 ms',
      'reconnecting in 60 ms',
      'reconnecting in 120 ms',
      'reconnecting in 120 ms',
    ]);
    expect(logs.some((l) => l.startsWith('connecting to ws://'))).toBe(true);
    expect(logs.some((l) => l.startsWith('connection failed'))).toBe(true);
  });

  it('applies the jitter to the delay', async () => {
    launch({ wsUrl: 'ws://127.0.0.1:1/v1/thinker/stream', random: () => 0 });
    await until(() => logs.some((l) => l.startsWith('reconnecting')), 'a retry');
    expect(logs.find((l) => l.startsWith('reconnecting'))).toBe('reconnecting in 15 ms');
  });

  it('logs the connect, the hello, the welcome and the close with its reason', async () => {
    const t = launch();
    await mind.next('hello');
    await until(() => t.welcomes === 1, 'the welcome');
    mind.push({ type: 'drain', reconnect_after_seconds: 0 });
    await until(() => logs.some((l) => l.startsWith('closed (')), 'the close');
    expect(logs.some((l) => l.startsWith('connecting to ws://'))).toBe(true);
    expect(logs.some((l) => l.startsWith('connected; sending hello'))).toBe(true);
    expect(logs.some((l) => l.startsWith('welcomed; accepted 1'))).toBe(true);
    expect(logs.find((l) => l.startsWith('closed ('))).toMatch(
      /code 1000, reason "drain"\) \(was welcomed\)/,
    );
  });
});

const answer = { message: { content: '{"ok":true}' }, prompt_eval_count: 12, eval_count: 5 };

function launchWarm(overrides: Partial<ThinkerOptions> = {}): LocalThinker {
  return launch({ warm: ollamaWarm(ollama.url), ...overrides });
}

describe('connection', () => {
  it('sends hello with the advertised models, then serves after welcome and heartbeats', async () => {
    launch({ heartbeatMs: 40 });
    const hello = await mind.next('hello');
    expect(hello).toEqual({
      type: 'hello',
      thinker_version: '1.2.3',
      models: [{ name: 'qwen3:8b', max_concurrent: 1, max_tokens: 2048 }],
    });
    const beat = await mind.next('heartbeat');
    expect(beat.load).toEqual({ 'qwen3:8b': 0 });
  });

  it('closes and reconnects when no welcome arrives in time', async () => {
    mind.autoWelcome = false;
    launch({ helloTimeoutMs: 50 });
    await until(() => mind.connections >= 2, 'a second connection');
  });

  it('ignores a job that arrives before welcome', async () => {
    mind.autoWelcome = false;
    const t = launch();
    await mind.next('hello');
    mind.push(mind.job());
    await until(() => t.droppedFrames === 1, 'the early job to be dropped');
    expect(ollama.requests).toHaveLength(0);
  });

  it('drains: closes, then reconnects after the given delay', async () => {
    launch();
    await mind.next('hello');
    const before = Date.now();
    mind.push({ type: 'drain', reconnect_after_seconds: 0 });
    await until(() => mind.connections === 2, 'the reconnect');
    expect(Date.now() - before).toBeLessThan(2000);
    expect(mind.frames.filter((f) => f.type === 'hello')).toHaveLength(2);
  });

  it('waits the whole drain delay before reconnecting', async () => {
    launch();
    await mind.next('hello');
    mind.push({ type: 'drain', reconnect_after_seconds: 1 });
    await new Promise((r) => setTimeout(r, 400));
    expect(mind.connections).toBe(1);
    await until(() => mind.connections === 2, 'the reconnect after the delay');
  });

  it('sends goodbye{shutdown} on stop', async () => {
    const t = launch();
    await mind.next('hello');
    await until(() => t.welcomes === 1, 'the welcome');
    await t.stop();
    expect(await mind.next('goodbye')).toEqual({ type: 'goodbye', reason: 'shutdown' });
  });

  it('drops an invalid inbound frame, counts it, and keeps serving', async () => {
    ollama.handler = (_r, res) => ollama.reply(res, answer);
    const t = launch();
    await mind.next('hello');
    await until(() => t.welcomes === 1, 'the welcome');
    mind.push('not json');
    mind.push({ type: 'job', job_id: 'nope' });
    mind.push({ type: 'cancel', job_id: 'jb_01HZXY0000000000000000AAAA', extra: 1 });
    await until(() => t.droppedFrames === 3, 'three dropped frames');
    mind.push(mind.job());
    expect((await mind.next('completion')).text).toBe('{"ok":true}');
  });

  it('escapes and cuts a hostile property name in the log line of a dropped frame', async () => {
    const hostile = `evil\n${'z'.repeat(2000)}`;
    const t = launch();
    await mind.next('hello');
    await until(() => t.welcomes === 1, 'the welcome');
    mind.push(mind.job({ [hostile]: 1 }));
    await until(() => t.droppedFrames === 1, 'the dropped frame');
    const line = logs.find((l) => l.startsWith('dropped an inbound frame'));
    expect(line).toBeDefined();
    expect(line?.includes('\n')).toBe(false);
    expect(line?.length ?? Infinity).toBeLessThan(300);
  });
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

describe('jobs', () => {
  async function ready(overrides: Partial<ThinkerOptions> = {}): Promise<LocalThinker> {
    const t = launch(overrides);
    await mind.next('hello');
    await until(() => t.welcomes === 1, 'the welcome');
    return t;
  }

  it('round-trips a job, passing format, think and options to Ollama', async () => {
    ollama.handler = (_r, res) => ollama.reply(res, answer);
    await ready();
    const schema = { type: 'object', properties: { a: { type: 'string' } } };
    mind.push(
      mind.job({
        response_format: { type: 'json_schema', schema },
        reasoning: 'on',
        stop: ['END'],
        temperature: 0.2,
        max_tokens: 77,
      }),
    );
    const done = await mind.next('completion');
    expect(done).toEqual({
      type: 'completion',
      job_id: 'jb_01HZXY0000000000000000AAAA',
      text: '{"ok":true}',
      usage_reported: { prompt_tokens: 12, completion_tokens: 5 },
    });
    const sent = ollama.requests[0];
    expect(sent?.path).toBe('/api/chat');
    expect(sent?.body).toEqual({
      model: 'qwen3:8b',
      messages: [{ role: 'user', content: 'hi' }],
      stream: false,
      think: true,
      format: schema,
      keep_alive: '30m',
      options: { num_ctx: 8192, temperature: 0.2, num_predict: 77, stop: ['END'] },
    });
  });

  it('sends think false and no format when the job has neither', async () => {
    ollama.handler = (_r, res) => ollama.reply(res, answer);
    await ready();
    mind.push(mind.job());
    await mind.next('completion');
    const body = ollama.requests[0]?.body ?? {};
    expect(body.think).toBe(false);
    expect('format' in body).toBe(false);
    expect((body.options as Record<string, unknown>).stop).toBeUndefined();
  });

  it('answers timeout and aborts the HTTP call when the deadline passes mid-call', async () => {
    ollama.handler = () => {};
    await ready();
    mind.push(mind.job({ deadline: new Date(Date.now() + 1000).toISOString() }));
    const err = await mind.next('error');
    expect(err.code).toBe('timeout');
    await until(() => ollama.requests[0]?.aborted === true, 'Ollama to see the abort');
  });

  it('sends the timeout before the deadline, so the Mind does not refuse it as late', async () => {
    ollama.handler = () => {};
    await ready();
    const deadline = Date.now() + 1000;
    mind.push(mind.job({ deadline: new Date(deadline).toISOString() }));
    expect((await mind.next('error')).code).toBe('timeout');
    expect(Date.now()).toBeLessThan(deadline);
  });

  it('answers timeout without calling Ollama when the deadline already passed', async () => {
    let calls = 0;
    await ready({
      chat: async () => {
        calls += 1;
        return { text: '{}', promptTokens: 1, completionTokens: 1 };
      },
    });
    mind.push(mind.job({ deadline: new Date(Date.now() - 1000).toISOString() }));
    expect((await mind.next('error')).code).toBe('timeout');
    expect(calls).toBe(0);
    expect(ollama.requests).toHaveLength(0);
  });

  it('counts the 32 KiB cap in bytes, not characters', async () => {
    ollama.handler = (_r, res) =>
      ollama.reply(res, { ...answer, message: { content: 'é'.repeat(20_000) } });
    await ready();
    mind.push(mind.job());
    expect(await mind.next('error')).toMatchObject({
      code: 'internal',
      message: 'output too large',
    });
  });

  it('aborts the Ollama call on cancel and sends nothing for that job', async () => {
    ollama.handler = () => {};
    await ready();
    mind.push(mind.job());
    await until(() => ollama.requests.length === 1, 'the Ollama call');
    mind.push({ type: 'cancel', job_id: 'jb_01HZXY0000000000000000AAAA' });
    await until(() => ollama.requests[0]?.aborted === true, 'Ollama to see the abort');
    await new Promise((r) => setTimeout(r, 100));
    expect(mind.frames.some((f) => f.type === 'error' || f.type === 'completion')).toBe(false);
  });

  it('refuses a job above the advertised max_tokens, without calling Ollama', async () => {
    ollama.handler = () => {};
    await ready();
    mind.push(mind.job({ max_tokens: 2049 }));
    expect(await mind.next('error')).toMatchObject({
      code: 'internal',
      message: expect.stringMatching(/^bad_request/),
    });
    expect(ollama.requests).toHaveLength(0);
  });

  it('answers busy for a second concurrent job on a one-slot model', async () => {
    ollama.handler = () => {};
    await ready();
    mind.push(mind.job());
    await until(() => ollama.requests.length === 1, 'the first call');
    mind.push(mind.job({ job_id: 'jb_01HZXY0000000000000000BBBB' }));
    const err = await mind.next('error');
    expect(err).toMatchObject({
      job_id: 'jb_01HZXY0000000000000000BBBB',
      code: 'internal',
      message: 'busy',
    });
    expect(ollama.requests).toHaveLength(1);
  });

  it('answers model_unavailable for a model it does not serve', async () => {
    await ready();
    mind.push(mind.job({ model: 'other:1b' }));
    expect((await mind.next('error')).code).toBe('model_unavailable');
    expect(ollama.requests).toHaveLength(0);
  });

  it('turns an output over 32 KiB into error internal', async () => {
    ollama.handler = (_r, res) =>
      ollama.reply(res, { ...answer, message: { content: 'x'.repeat(32_769) } });
    await ready();
    mind.push(mind.job());
    expect(await mind.next('error')).toMatchObject({
      code: 'internal',
      message: 'output too large',
    });
    expect(mind.frames.some((f) => f.type === 'completion')).toBe(false);
  });

  it('turns a full context window into error internal, not a completion', async () => {
    ollama.handler = (_r, res) => ollama.reply(res, { ...answer, prompt_eval_count: 8192 });
    await ready();
    mind.push(mind.job());
    expect(await mind.next('error')).toMatchObject({
      code: 'internal',
      message: 'context overflow',
    });
    expect(mind.frames.some((f) => f.type === 'completion')).toBe(false);
  });

  it('maps an unknown model in Ollama to model_unavailable', async () => {
    ollama.handler = (_r, res) => ollama.reply(res, { error: 'not found' }, 404);
    await ready();
    mind.push(mind.job());
    expect((await mind.next('error')).code).toBe('model_unavailable');
  });

  it('never logs prompt or completion text', async () => {
    ollama.handler = (_r, res) =>
      ollama.reply(res, { ...answer, message: { content: 'SECRET-COMPLETION' } });
    await ready();
    mind.push(mind.job({ messages: [{ role: 'user', content: 'SECRET-PROMPT' }] }));
    await mind.next('completion');
    expect(logs.join('\n')).not.toMatch(/SECRET/);
    expect(logs.some((l) => l.includes('jb_01HZXY0000000000000000AAAA'))).toBe(true);
  });
});
