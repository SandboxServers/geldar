import { afterEach, describe, expect, it } from 'vitest';
import { newId } from '../ids.ts';
import { ModelError, type ModelJob } from '../ports/model.ts';
import type { ThinkerHub } from './hub.ts';
import { LocalThinkerClient } from './local-client.ts';
import { FakeThinker, MODEL, pause, startHub, until } from './thinker.fakes.ts';

let hub: ThinkerHub | undefined;
const thinkers: FakeThinker[] = [];

afterEach(async () => {
  for (const t of thinkers.splice(0)) t.close();
  await hub?.stop();
  hub = undefined;
});

async function setup(
  slots = 1,
  graceMs = 40,
): Promise<{ client: LocalThinkerClient; t: FakeThinker }> {
  hub = await startHub();
  const t = await attach(slots);
  return { client: new LocalThinkerClient(hub, { graceMs }), t };
}

async function attach(slots: number): Promise<FakeThinker> {
  const t = new FakeThinker();
  thinkers.push(t);
  await t.connect(hub as ThinkerHub);
  await t.hello([[MODEL, slots]]);
  return t;
}

function job(overrides: Partial<ModelJob> = {}): ModelJob {
  return {
    model: MODEL,
    messages: [{ role: 'user', content: 'hello' }],
    maxTokens: 100,
    temperature: 0.5,
    deadline: new Date(Date.now() + 5000),
    stablePrefixChars: 0,
    ...overrides,
  };
}

async function failure(promise: Promise<unknown>): Promise<ModelError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof ModelError) return err;
    throw err;
  }
  throw new Error('expected the call to fail');
}

describe('LocalThinkerClient', () => {
  it('sends a full job frame and returns the completion with its usage', async () => {
    const { client, t } = await setup();
    const schema = { type: 'object', properties: { a: { type: 'string' } } };
    const pending = client.complete(
      job({ responseSchema: schema, reasoning: 'on', stablePrefixChars: 12 }),
      new AbortController().signal,
    );
    const frame = await t.next('job');
    expect(frame).toMatchObject({
      model: MODEL,
      max_tokens: 100,
      temperature: 0.5,
      stop: null,
      cache_hint: { stable_prefix_chars: 12 },
      response_format: { type: 'json_schema', schema },
      reasoning: 'on',
    });
    expect(String(frame.job_id)).toMatch(/^jb_/);
    t.send({
      type: 'completion',
      job_id: frame.job_id,
      text: 'done',
      usage_reported: { prompt_tokens: 7, completion_tokens: 3 },
    });
    const done = await pending;
    expect(done).toMatchObject({
      text: 'done',
      usageReported: { promptTokens: 7, completionTokens: 3 },
      thinkerId: 'test-thinker',
    });
    expect(done.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('leaves response_format and reasoning out when the job has none', async () => {
    const { client, t } = await setup();
    void client.complete(job(), new AbortController().signal).catch(() => {});
    const frame = await t.next('job');
    expect(frame).not.toHaveProperty('response_format');
    expect(frame).not.toHaveProperty('reasoning');
  });

  it('maps a Thinker error frame to the matching ModelError code', async () => {
    const { client, t } = await setup();
    const pending = client.complete(job(), new AbortController().signal);
    const frame = await t.next('job');
    t.send({ type: 'error', job_id: frame.job_id, code: 'model_unavailable', message: 'gone' });
    expect((await failure(pending)).code).toBe('model_unavailable');
  });

  it('fails at once with no_thinker when nobody is connected, or nobody offers the model', async () => {
    hub = await startHub();
    const client = new LocalThinkerClient(hub);
    expect((await failure(client.complete(job(), new AbortController().signal))).code).toBe(
      'no_thinker',
    );
    await attach(1);
    const other = job({ model: 'qwen3:32b' });
    expect((await failure(client.complete(other, new AbortController().signal))).code).toBe(
      'no_thinker',
    );
  });

  it('fails with timeout when the deadline has already passed, without sending', async () => {
    const { client, t } = await setup();
    const past = job({ deadline: new Date(Date.now() - 1) });
    expect((await failure(client.complete(past, new AbortController().signal))).code).toBe(
      'timeout',
    );
    await pause(30);
    expect(t.received.filter((f) => f.type === 'job')).toEqual([]);
  });

  it('fails with timeout after the deadline plus the grace, and sends cancel', async () => {
    const { client, t } = await setup(1, 60);
    const started = Date.now();
    const pending = client.complete(
      job({ deadline: new Date(started + 100) }),
      new AbortController().signal,
    );
    const frame = await t.next('job');
    expect((await failure(pending)).code).toBe('timeout');
    expect(Date.now() - started).toBeGreaterThanOrEqual(150);
    expect((await t.next('cancel')).job_id).toBe(frame.job_id);
  });

  it('drops a completion that arrives after the deadline and counts it', async () => {
    const { client, t } = await setup(1, 300);
    const pending = client.complete(
      job({ deadline: new Date(Date.now() + 80) }),
      new AbortController().signal,
    );
    const frame = await t.next('job');
    await pause(120);
    t.send({ type: 'completion', job_id: frame.job_id, text: 'too late' });
    expect((await failure(pending)).code).toBe('timeout');
    expect(hub?.stats()[0]?.anomalies).toBe(1);
  });

  it('sends cancel and fails with cancelled when the signal aborts', async () => {
    const { client, t } = await setup();
    const controller = new AbortController();
    const pending = client.complete(job(), controller.signal);
    const frame = await t.next('job');
    controller.abort();
    expect((await failure(pending)).code).toBe('cancelled');
    expect((await t.next('cancel')).job_id).toBe(frame.job_id);
    // The answer that crossed the cancel is dropped, and is not held against the Thinker.
    t.send({ type: 'completion', job_id: frame.job_id, text: 'late' });
    await until(() => hub?.stats()[0]?.crossedCancel === 1, 'the crossed answer');
    expect(hub?.stats()[0]?.anomalies).toBe(0);
  });

  it('fails with cancelled and sends nothing when the signal is already aborted', async () => {
    const { client, t } = await setup();
    const controller = new AbortController();
    controller.abort();
    expect((await failure(client.complete(job(), controller.signal))).code).toBe('cancelled');
    await pause(30);
    expect(t.received.filter((f) => f.type === 'job')).toEqual([]);
  });

  it('drops a completion for a job id this connection was never issued', async () => {
    const { client, t } = await setup();
    const pending = client.complete(job(), new AbortController().signal);
    const frame = await t.next('job');
    t.send({ type: 'completion', job_id: newId('jb'), text: 'foreign' });
    await until(() => hub?.stats()[0]?.anomalies === 1, 'the foreign drop');
    t.send({ type: 'completion', job_id: frame.job_id, text: 'real' });
    expect((await pending).text).toBe('real');
  });

  it('does not let a completion for another connection settle a job', async () => {
    const { client, t } = await setup();
    const other = await attach(1);
    const pending = client.complete(job(), new AbortController().signal);
    const frame = await t.next('job');
    other.send({ type: 'completion', job_id: frame.job_id, text: 'stolen' });
    await until(() => hub?.session('local-2')?.anomalyCount === 1, 'the stolen answer drop');
    t.send({ type: 'completion', job_id: frame.job_id, text: 'mine' });
    expect((await pending).text).toBe('mine');
  });

  it('drops a duplicate completion and counts it', async () => {
    const { client, t } = await setup();
    const pending = client.complete(job(), new AbortController().signal);
    const frame = await t.next('job');
    t.send({ type: 'completion', job_id: frame.job_id, text: 'first' });
    t.send({ type: 'completion', job_id: frame.job_id, text: 'second' });
    expect((await pending).text).toBe('first');
    await until(() => hub?.stats()[0]?.anomalies === 1, 'the duplicate drop');
  });

  it('rejects a completion over 32 KiB in bytes even when it is under in characters', async () => {
    const { client, t } = await setup();
    const pending = client.complete(job(), new AbortController().signal);
    const frame = await t.next('job');
    t.send({ type: 'completion', job_id: frame.job_id, text: '€'.repeat(11_000) });
    expect((await failure(pending)).code).toBe('internal');
  });

  it('fails with internal when the Thinker disconnects mid-job', async () => {
    const { client, t } = await setup();
    const pending = client.complete(job(), new AbortController().signal);
    await t.next('job');
    t.close();
    expect((await failure(pending)).code).toBe('internal');
  });

  it('fails with internal, sending nothing, when the job is not a valid frame', async () => {
    const { client, t } = await setup();
    const bad = job({ maxTokens: 0 });
    expect((await failure(client.complete(bad, new AbortController().signal))).code).toBe(
      'internal',
    );
    await pause(30);
    expect(t.received.filter((f) => f.type === 'job')).toEqual([]);
  });
});

describe('LocalThinkerClient concurrency', () => {
  it('refuses a job above the connection max_concurrent, and frees the slot on completion', async () => {
    const { client, t } = await setup(1);
    const first = client.complete(job(), new AbortController().signal);
    const frame = await t.next('job');
    const second = client.complete(job(), new AbortController().signal);
    expect((await failure(second)).code).toBe('no_thinker');
    t.send({ type: 'completion', job_id: frame.job_id, text: 'ok' });
    await first;
    const third = client.complete(job(), new AbortController().signal);
    const next = await t.next('job');
    t.send({ type: 'completion', job_id: next.job_id, text: 'ok' });
    expect((await third).text).toBe('ok');
  });

  it('spreads jobs over connections, the least loaded first', async () => {
    const { client, t } = await setup(2);
    const other = await attach(2);
    const a = client.complete(job(), new AbortController().signal);
    const b = client.complete(job(), new AbortController().signal);
    const fa = await t.next('job').catch(() => undefined);
    const fb = await other.next('job').catch(() => undefined);
    expect(fa).toBeDefined();
    expect(fb).toBeDefined();
    t.send({ type: 'completion', job_id: fa?.job_id, text: 'a' });
    other.send({ type: 'completion', job_id: fb?.job_id, text: 'b' });
    expect([(await a).text, (await b).text]).toEqual(['a', 'b']);
  });
});
