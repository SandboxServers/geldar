import { describe, expect, it } from 'vitest';
import { attributeDropCount, filterAttributes } from '../src/attributes.ts';

describe('attribute allow-list', () => {
  it('keeps allow-listed correlation ids on traces and logs', () => {
    const { attributes, dropped } = filterAttributes(
      { life_id: 'lf_1', thought_id: 'th_1', 'geldar.action_id': 'ac_1', outcome: 'ok' },
      'trace',
    );
    expect(attributes).toEqual({
      life_id: 'lf_1',
      thought_id: 'th_1',
      'geldar.action_id': 'ac_1',
      outcome: 'ok',
    });
    expect(dropped).toEqual([]);
  });

  it('refuses life, player, agent and token attributes on metrics', () => {
    const { attributes, dropped } = filterAttributes(
      { life_id: 'lf_1', player_id: 'p_1', agent_name: 'Ada', token: 'x', outcome: 'ok' },
      'metric',
    );
    expect(attributes).toEqual({ outcome: 'ok' });
    expect(dropped).toEqual(
      expect.arrayContaining([
        { key: 'life_id', reason: 'identity' },
        { key: 'player_id', reason: 'identity' },
        { key: 'agent_name', reason: 'identity' },
        { key: 'token', reason: 'identity' },
      ]),
    );
  });

  it('drops unknown keys and counts them', () => {
    const before = attributeDropCount();
    const { attributes, dropped } = filterAttributes({ zzz_free_text: 'hi', life_id: 'lf' }, 'log');
    expect(attributes).toEqual({ life_id: 'lf' });
    expect(dropped).toEqual([{ key: 'zzz_free_text', reason: 'unknown' }]);
    expect(attributeDropCount() - before).toBe(1);
  });

  it('drops forbidden key names in every scope, including content siblings', () => {
    const input = {
      life_id: 'lf',
      auth_token: 'abc',
      'user.email': 'a@example.test',
      'geldar.content.password': 'hunter2',
      cookie: 'session=1',
      authorization: 'Bearer x',
      client_secret: 's',
    };
    for (const scope of ['trace', 'log', 'metric'] as const) {
      const { attributes, dropped } = filterAttributes(input, scope);
      expect(attributes).not.toHaveProperty('auth_token');
      expect(attributes).not.toHaveProperty('user.email');
      expect(attributes).not.toHaveProperty('geldar.content.password');
      expect(dropped.filter((d) => d.reason === 'forbidden').length).toBeGreaterThanOrEqual(5);
    }
  });

  it('does not treat token counts as the forbidden token key', () => {
    const { attributes } = filterAttributes({ 'gen_ai.usage.input_tokens': 12 }, 'trace');
    expect(attributes).toEqual({ 'gen_ai.usage.input_tokens': 12 });
  });

  it.each([
    'accessToken',
    'apiKey',
    'api_key',
    'authtoken',
    'emailAddress',
    'passwd',
    'pass_word',
    'bearer',
    'credential',
    'jwt',
    'privateKey',
    'sessionId',
  ])('drops camelCase and joined forbidden form %s as forbidden', (key) => {
    const { attributes, dropped } = filterAttributes({ [key]: 'x' }, 'log');
    expect(attributes).toEqual({});
    expect(dropped).toEqual([{ key, reason: 'forbidden' }]);
  });

  it('keeps plural gen_ai usage token counts and does not call them forbidden', () => {
    const { attributes, dropped } = filterAttributes(
      {
        'gen_ai.usage.input_tokens': 12,
        'gen_ai.usage.output_tokens': 3,
        'gen_ai.usage.total_tokens': 15,
      },
      'trace',
    );
    expect(attributes).toEqual({
      'gen_ai.usage.input_tokens': 12,
      'gen_ai.usage.output_tokens': 3,
    });
    expect(dropped).toEqual([{ key: 'gen_ai.usage.total_tokens', reason: 'unknown' }]);
  });

  it('drops null and undefined values silently', () => {
    const { attributes, dropped } = filterAttributes({ life_id: undefined, shard: null }, 'log');
    expect(attributes).toEqual({});
    expect(dropped).toEqual([]);
  });
});
