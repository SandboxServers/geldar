import { describe, expect, it } from 'vitest';
import { findMcpTokens } from './mcp-token.ts';

const token = `gmcp-${'ab'.repeat(32)}`;

describe('findMcpTokens', () => {
  it('reports a bearer token by path and line', () => {
    const text = ['# notes', `curl -H "Authorization: Bearer ${token}"`].join('\n');
    expect(findMcpTokens('docs/x.md', text)).toEqual(['docs/x.md:2']);
  });

  it('reports every line that holds a token, inside a longer line too', () => {
    const text = [token, 'plain', `token=${token};`].join('\n');
    expect(findMcpTokens('a.env.txt', text)).toEqual(['a.env.txt:1', 'a.env.txt:3']);
  });

  it('passes the prefix alone, a 63-character hex run and a string in upper case', () => {
    const text = [
      'gmcp-',
      `gmcp-${'ab'.repeat(31)}a`,
      `gmcp-${'AB'.repeat(32)}`,
    ].join('\n');
    expect(findMcpTokens('a.md', text)).toEqual([]);
  });

  it('passes a file with no token', () => {
    expect(findMcpTokens('a.md', '# nothing here\n')).toEqual([]);
  });
});
