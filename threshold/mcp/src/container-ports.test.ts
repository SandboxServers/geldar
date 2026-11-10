import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { containerPorts } from './cli.ts';
import { pepperBytes } from './main.ts';

const KEY = 'container-ports-pepper-0123456789abcdef';

let dir = '';
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'container-ports-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** The pepper as the container reads it: the real port, then the same bytes pepperBytes keeps. */
async function pepperFrom(text: string): Promise<Buffer> {
  const file = join(dir, 'pepper.txt');
  writeFileSync(file, text);
  return pepperBytes(await containerPorts('phase0').readSecret(file));
}

describe('containerPorts pepper', () => {
  it.each([
    ['a trailing space', `${KEY} `, `${KEY} `],
    ['a trailing CRLF', `${KEY}\r\n`, KEY],
    ['a trailing LF', `${KEY}\n`, KEY],
    ['a leading space', ` ${KEY}`, ` ${KEY}`],
  ])('keeps the pepper bytes the CLI keeps for %s', async (_name, text, expected) => {
    expect((await pepperFrom(text)).equals(Buffer.from(expected, 'utf8'))).toBe(true);
  });
});
