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

  it('let the MCP closed values through on logs, and the credential deny rule still wins', () => {
    createLogger({
      name: 'mcp',
      extraKeys: ['tool', 'status', 'duration_ms', 'api_token'],
      write: () => {},
    });
    // None of the three MCP names matches the credential deny rule.
    expect(hasForbiddenSegment('tool')).toBe(false);
    expect(hasForbiddenSegment('status')).toBe(false);
    expect(hasForbiddenSegment('duration_ms')).toBe(false);
    const logged = filterAttributes(
      { tool: 'look', status: 429, duration_ms: 3, api_token: 'secret' },
      'log',
    );
    expect(logged.attributes).toEqual({ tool: 'look', status: 429, duration_ms: 3 });
    expect(logged.dropped).toEqual([{ key: 'api_token', reason: 'forbidden' }]);
    // extraKeys are log-only: the same names stay off spans.
    expect(filterAttributes({ tool: 'look', status: 429 }, 'trace').attributes).toEqual({});
  });
});
