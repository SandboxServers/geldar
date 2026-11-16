import { describe, expect, it } from 'vitest';
import { attributeDropCount, filterAttributes, hasForbiddenSegment } from '../src/attributes.ts';
import { createLogger } from '../src/logger.ts';

describe('forbidden credential names', () => {
  it.each([
    'refresh_token',
    'sessionToken',
    'refreshToken',
    'apiToken',
    'refreshtoken',
    'apitoken',
    'idtoken',
    'pwd',
    'user.pwd',
    'db_pwd',
  ])('drops %s in every scope', (key) => {
    expect(hasForbiddenSegment(key)).toBe(true);
    expect(filterAttributes({ [key]: 'x' }, 'trace').attributes).toEqual({});
    expect(filterAttributes({ [key]: 'x' }, 'log').attributes).toEqual({});
  });

  it('keeps token counts, which are not credentials', () => {
    expect(hasForbiddenSegment('gen_ai.usage.input_tokens')).toBe(false);
  });
});

describe('stdout drops', () => {
  it('does not count forbidden names dropped from the stdout line in attributeDropCount', () => {
    const before = attributeDropCount();
    const { attributes, dropped } = filterAttributes(
      { password: 'hunter2', free_text: 'kept' },
      'stdout',
    );
    expect(dropped).toEqual([{ key: 'password', reason: 'forbidden' }]);
    expect(attributes).toEqual({ free_text: 'kept' });
    expect(attributeDropCount()).toBe(before);
  });
});

describe('logger extraKeys', () => {
  it('reach log records but never span attributes', () => {
    createLogger({ name: 'svc', extraKeys: ['custom_field'], write: () => {} });
    expect(filterAttributes({ 'geldar.custom_field': 'x' }, 'log').attributes).toEqual({
      'geldar.custom_field': 'x',
    });
    expect(filterAttributes({ 'geldar.custom_field': 'x' }, 'trace').attributes).toEqual({});
  });
});
