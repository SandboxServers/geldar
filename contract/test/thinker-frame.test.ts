import { describe, expect, it } from 'vitest';
import { MAX_COMPLETION_TEXT, validateThinkerFrame } from '../src/index.ts';

const jobId = 'jb_01HZX3V9Q4M2K8R7T6Y5W4E3D2';

/** One example per frame from Appendix H, with valid IDs and dates. */
const examples: Record<string, unknown> = {
  hello: {
    type: 'hello',
    thinker_version: '1.4.2',
    models: [
      { name: 'qwen3-32b', max_concurrent: 12, max_tokens: 1024 },
      { name: 'qwen3-8b', max_concurrent: 32, max_tokens: 1024 },
    ],
  },
  heartbeat: { type: 'heartbeat', load: { 'qwen3-32b': 7, 'qwen3-8b': 19 } },
  completion: {
    type: 'completion',
    job_id: jobId,
    text: '{ "reasoning": "the bread is in the chest" }',
    usage_reported: { prompt_tokens: 3412, completion_tokens: 288 },
  },
  error: { type: 'error', job_id: jobId, code: 'timeout', message: 'no reply before the deadline' },
  goodbye: { type: 'goodbye', reason: 'schedule' },
  welcome: {
    type: 'welcome',
    thinker: 'thinker-home',
    accepted_models: ['qwen3-32b', 'qwen3-8b'],
    server_time: '2026-11-08T21:00:00Z',
  },
  job: {
    type: 'job',
    job_id: jobId,
    model: 'qwen3-32b',
    messages: [
      { role: 'system', content: 'You are Kestrel.' },
      { role: 'user', content: 'What do you do next?' },
    ],
    max_tokens: 600,
    temperature: 0.7,
    stop: null,
    deadline: '2026-11-08T21:14:05Z',
    cache_hint: { stable_prefix_chars: 2180 },
  },
  cancel: { type: 'cancel', job_id: jobId },
  drain: { type: 'drain', reconnect_after_seconds: 300 },
};

/** A deep copy of one example that a test can break in one place. */
function frame(name: string): Record<string, unknown> {
  return structuredClone(examples[name]) as Record<string, unknown>;
}

/** A job frame with one field replaced. */
function jobWith(field: string, value: unknown): Record<string, unknown> {
  return { ...frame('job'), [field]: value };
}

/** A hello frame whose first model has one field replaced. */
function helloWith(field: string, value: unknown): Record<string, unknown> {
  const hello = frame('hello') as { models: Record<string, unknown>[] };
  hello.models[0] = { ...hello.models[0], [field]: value };
  return hello;
}

/** A hello frame with the given number of models, each valid. */
function helloWithModels(count: number): Record<string, unknown> {
  const models = Array.from({ length: count }, (_, index) => ({
    name: `model-${index}`,
    max_concurrent: 1,
    max_tokens: 1,
  }));
  return { ...frame('hello'), models };
}

/** A job frame with the given number of messages, each valid. */
function jobWithMessages(count: number): Record<string, unknown> {
  return jobWith(
    'messages',
    Array.from({ length: count }, () => ({ role: 'user', content: 'hi' })),
  );
}

describe('validateThinkerFrame', () => {
  it.each(Object.keys(examples))('accepts the Appendix H %s frame', (name) => {
    const result = validateThinkerFrame(examples[name]);
    expect(result.ok).toBe(true);
  });

  it('accepts a completion whose text is exactly MAX_COMPLETION_TEXT characters', () => {
    const completion = { ...frame('completion'), text: 'a'.repeat(MAX_COMPLETION_TEXT) };
    expect(validateThinkerFrame(completion).ok).toBe(true);
  });

  it('rejects a completion with 32769-character text', () => {
    const completion = { ...frame('completion'), text: 'a'.repeat(32769) };
    const result = validateThinkerFrame(completion);
    expect(result.ok).toBe(false);
  });

  it('rejects an error with an unknown code', () => {
    const error = { ...frame('error'), code: 'oops' };
    expect(validateThinkerFrame(error).ok).toBe(false);
  });

  it('rejects a hello that carries a thinker field', () => {
    const hello = { ...frame('hello'), thinker: 'thinker-home' };
    const result = validateThinkerFrame(hello);
    expect(result.ok).toBe(false);
  });

  it('rejects a job with no fields besides its type', () => {
    const result = validateThinkerFrame({ type: 'job' });
    expect(result.ok).toBe(false);
  });

  it('rejects a frame whose type is not one of the nine', () => {
    const result = validateThinkerFrame({ type: 'ping' });
    expect(result.ok).toBe(false);
  });

  it('rejects a job with more than 64 messages', () => {
    const message = { role: 'user', content: 'hi' };
    const job = { ...frame('job'), messages: Array.from({ length: 65 }, () => message) };
    expect(validateThinkerFrame(job).ok).toBe(false);
  });

  it('rejects a heartbeat with a negative load', () => {
    const heartbeat = { ...frame('heartbeat'), load: { 'qwen3-8b': -1 } };
    expect(validateThinkerFrame(heartbeat).ok).toBe(false);
  });

  it('rejects a welcome that is not an object', () => {
    expect(validateThinkerFrame('welcome').ok).toBe(false);
  });

  it('names the frame types in one error when the type is unknown or missing', () => {
    const expected = [
      '/type must be one of hello, heartbeat, completion, error, goodbye, welcome, job, cancel, drain',
    ];
    expect(validateThinkerFrame({ type: 'ping' })).toEqual({ ok: false, errors: expected });
    expect(validateThinkerFrame({ thinker_version: '1.4.2' })).toEqual({
      ok: false,
      errors: expected,
    });
    expect(validateThinkerFrame('welcome')).toEqual({ ok: false, errors: expected });
  });

  it('reports only the job frame errors for a job with a bad deadline', () => {
    const result = validateThinkerFrame(jobWith('deadline', 'soon'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toMatch(/^\/deadline /);
    expect(
      result.errors.every((error) => !/required property '(models|thinker_version)'/.test(error)),
    ).toBe(true);
  });

  it('reports hello errors first for a hello with a bad thinker_version', () => {
    const hello = examples.hello as Record<string, unknown>;
    const result = validateThinkerFrame({ ...hello, thinker_version: 'v1' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toMatch(/^\/thinker_version /);
    expect(result.errors.every((error) => error.startsWith('/thinker_version '))).toBe(true);
  });
});

describe('thinker frame bounds', () => {
  const rejects: [string, Record<string, unknown>][] = [
    ['hello with 0 models', helloWithModels(0)],
    ['hello with 17 models', helloWithModels(17)],
    ['hello with max_concurrent 0', helloWith('max_concurrent', 0)],
    ['hello with max_concurrent 257', helloWith('max_concurrent', 257)],
    ['hello with max_tokens 0', helloWith('max_tokens', 0)],
    ['hello with max_tokens 32769', helloWith('max_tokens', 32769)],
    ['job with 0 messages', jobWithMessages(0)],
    ['job with temperature 2.1', jobWith('temperature', 2.1)],
    ['job with temperature -0.1', jobWith('temperature', -0.1)],
    ['job with max_tokens 0', jobWith('max_tokens', 0)],
    ['job with stop as a bare string', jobWith('stop', 'x')],
    ['job with a deadline that is not a date-time', jobWith('deadline', 'not-a-date')],
    ['job with a job_id missing its ID', jobWith('job_id', 'jb_')],
    ['drain with 86401 seconds', { ...frame('drain'), reconnect_after_seconds: 86401 }],
    ['drain with -1 seconds', { ...frame('drain'), reconnect_after_seconds: -1 }],
    ['error with a 201-character message', { ...frame('error'), message: 'a'.repeat(201) }],
    ['goodbye with an unknown reason', { ...frame('goodbye'), reason: 'crash' }],
    [
      'welcome with a server_time that is not a date-time',
      { ...frame('welcome'), server_time: 'yesterday' },
    ],
    ['welcome with an empty thinker name', { ...frame('welcome'), thinker: '' }],
    ['welcome with a 65-character thinker name', { ...frame('welcome'), thinker: 'a'.repeat(65) }],
    ['heartbeat with a fractional load', { ...frame('heartbeat'), load: { 'qwen3-8b': 1.5 } }],
    ['job with a stop array holding a number', jobWith('stop', [1])],
  ];

  it.each(rejects)('rejects %s', (_name, value) => {
    expect(validateThinkerFrame(value).ok).toBe(false);
  });

  const accepts: [string, Record<string, unknown>][] = [
    ['hello with 16 models', helloWithModels(16)],
    ['job with 64 messages', jobWithMessages(64)],
    ['error with a 200-character message', { ...frame('error'), message: 'a'.repeat(200) }],
    ['job with an empty stop array', jobWith('stop', [])],
    ['job with a stop array of one string', jobWith('stop', ['x'])],
    [
      'job without cache_hint',
      (() => {
        const job = frame('job');
        delete job.cache_hint;
        return job;
      })(),
    ],
    ['hello with an uppercase Ollama tag', helloWith('name', 'qwen3:32b-q4_K_M')],
    ['welcome with a 64-character thinker name', { ...frame('welcome'), thinker: 'a'.repeat(64) }],
  ];

  it.each(accepts)('accepts %s', (_name, value) => {
    expect(validateThinkerFrame(value).ok).toBe(true);
  });
});
