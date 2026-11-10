import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LocalThinker, ThinkerOptions } from '../src/thinker.ts';
import { type FakeMind, type FakeOllama, until } from './thinker.fakes.ts';
import { answer, type Rig, startRig } from './thinker.fixture.ts';

let rig: Rig;
let mind: FakeMind;
let ollama: FakeOllama;
let logs: string[];
let launch: Rig['launch'];

beforeEach(async () => {
  rig = await startRig();
  ({ mind, ollama, logs, launch } = rig);
});

afterEach(async () => {
  await rig.close();
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

  it('retries once without thinking when the reasoning leaves no answer text', async () => {
    ollama.handler = (req, res) =>
      ollama.reply(res, req.body.think === true ? { message: { content: '' } } : answer);
    await ready();
    mind.push(mind.job({ reasoning: 'on', max_tokens: 1200 }));
    const done = await mind.next('completion');
    expect(done).toMatchObject({ type: 'completion', text: '{"ok":true}' });
    expect(ollama.requests.map((r) => r.body.think)).toEqual([true, false]);
    expect(ollama.requests[1]?.body.options).toMatchObject({ num_predict: 1200 });
  });

  it('answers internal, not an empty completion, when the retry is empty too', async () => {
    ollama.handler = (_r, res) => ollama.reply(res, { message: { content: '  ' } });
    await ready();
    mind.push(mind.job({ reasoning: 'on' }));
    const failed = await mind.next('error');
    expect(failed).toMatchObject({ code: 'internal', message: 'Ollama gave no answer text' });
    expect(ollama.requests).toHaveLength(2);
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
