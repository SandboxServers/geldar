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
    thinker: 'steven-home',
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
    const hello = { ...frame('hello'), thinker: 'steven-home' };
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
});
