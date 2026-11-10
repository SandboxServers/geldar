import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { findPublicPorts, isComposeFile } from './loopback-ports.ts';

const path = 'compose/mcp.yml';
const text = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', path),
  'utf8',
);

describe('compose/mcp.yml', () => {
  it('is a compose file the loopback-ports check reads', () => {
    expect(isComposeFile(path)).toBe(true);
  });

  it('passes the loopback-ports check (every published port is on 127.0.0.1)', () => {
    expect(findPublicPorts(path, text)).toEqual([]);
  });
});
