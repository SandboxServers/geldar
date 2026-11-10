import { describe, expect, it } from 'vitest';
import { parseTokenFile } from './client.ts';

const TOKEN = `gmcp-${'ab12'.repeat(16)}`;

describe('parseTokenFile: the bearer in a mcp-tokens token file', () => {
  it('takes the value after GELDAR_MCP_TOKEN= that mcp-tokens writes (LF)', () => {
    expect(parseTokenFile(`GELDAR_MCP_TOKEN=${TOKEN}\n`)).toBe(TOKEN);
  });

  it('ignores a byte-order mark and CRLF line ends from a Windows editor', () => {
    expect(parseTokenFile(`﻿GELDAR_MCP_TOKEN=${TOKEN}\r\n`)).toBe(TOKEN);
  });

  it('accepts a bare token with no variable line', () => {
    expect(parseTokenFile(`${TOKEN}\n`)).toBe(TOKEN);
  });

  it('never returns the variable name as part of the bearer', () => {
    expect(parseTokenFile(`GELDAR_MCP_TOKEN=${TOKEN}`)).not.toContain('GELDAR_MCP_TOKEN');
  });

  it('refuses an empty file without echoing anything', () => {
    expect(() => parseTokenFile('\n  \n')).toThrow('the token file holds no token');
  });
});
