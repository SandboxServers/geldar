import { describe, expect, it } from 'vitest';
import { filterAttributes } from '../src/attributes.ts';

const GENAI_KEYS = [
  'gen_ai.provider.name',
  'gen_ai.conversation.id',
  'gen_ai.agent.name',
  'gen_ai.response.finish_reasons',
  'gen_ai.tool.call.id',
  'gen_ai.usage.cache_read.input_tokens',
  'gen_ai.usage.cache_creation.input_tokens',
];
const RUN_KEYS = [
  'harness',
  'run_number',
  'run_kind',
  'exit_code',
  'turns',
  'cost_usd',
  'duration_s',
  'fails',
  'limit_kind',
  'timing',
  'turn_index',
];
const PROMPT_KEYS = [
  'prompt.sha256',
  'prompt.template_version',
  'prompt.goals_bytes',
  'prompt.handoff_bytes',
  'prompt.words_chars',
  'prompt.identity_bytes',
  'prompt.cut',
];
const NEW_KEYS = [...GENAI_KEYS, ...RUN_KEYS, ...PROMPT_KEYS];
// `harness` is already a metric key (METRIC_KEYS); the card adds it to the trace and log scopes only.
const TRACE_ONLY_KEYS = NEW_KEYS.filter((key) => key !== 'harness');

describe('Mind span and log keys', () => {
  it.each(['trace', 'log'] as const)('keeps every new key in the %s scope', (scope) => {
    for (const key of NEW_KEYS) {
      const kept = filterAttributes({ [key]: 1 }, scope);
      expect(kept.dropped, key).toEqual([]);
      expect(kept.attributes, key).toEqual({ [key]: 1 });
    }
  });

  it('keeps the same keys behind the geldar. prefix', () => {
    for (const key of NEW_KEYS) {
      expect(filterAttributes({ [`geldar.${key}`]: 1 }, 'trace').dropped, key).toEqual([]);
    }
  });

  it('does not accept the new keys as metric labels', () => {
    for (const key of TRACE_ONLY_KEYS) {
      expect(filterAttributes({ [key]: 1 }, 'metric').dropped, key).toEqual([
        { key, reason: 'unknown' },
      ]);
    }
    // `harness` stays a metric label, as before.
    expect(filterAttributes({ harness: 'claude' }, 'metric').dropped).toEqual([]);
  });

  it('keeps http.response.status_code as a number in trace and log scope only', () => {
    const key = 'http.response.status_code';
    for (const scope of ['trace', 'log'] as const) {
      const kept = filterAttributes({ [key]: 401 }, scope);
      expect(kept.dropped, scope).toEqual([]);
      expect(kept.attributes, scope).toEqual({ [key]: 401 });
    }
    expect(filterAttributes({ [key]: 401 }, 'metric').dropped).toEqual([
      { key, reason: 'unknown' },
    ]);
  });

  it('keeps token counts and drops a credential-named key', () => {
    const result = filterAttributes(
      { 'gen_ai.usage.output_tokens': 5, 'geldar.mind_auth_token': 'x' },
      'trace',
    );
    expect(result.attributes).toEqual({ 'gen_ai.usage.output_tokens': 5 });
    expect(result.dropped).toEqual([{ key: 'geldar.mind_auth_token', reason: 'forbidden' }]);
  });

  it('still caps content text over 32 KiB and marks it', () => {
    const key = 'geldar.content.assistant_text';
    const { attributes } = filterAttributes({ [key]: 'a'.repeat(40 * 1024) }, 'trace');
    expect(Buffer.byteLength(String(attributes[key]))).toBeLessThanOrEqual(33 * 1024);
    expect(attributes[`${key}.bytes`]).toBe(40 * 1024);
    expect(attributes[`${key}.truncated`]).toBe(true);
  });
});
