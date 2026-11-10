import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
// The server's reader lives in threshold/mcp; the golden table holds both readers to one rule.
import { pepperBytes } from '../../../threshold/mcp/src/main.ts';
import { PEPPER_FILE, readPepper } from './secret-files.ts';

const KEY = '0123456789abcdef0123456789abcdef'; // exactly 32 bytes

/**
 * Each row: the pepper file's text, and the key both readers must produce from it (null: refused).
 * The CLI and the server must agree on every row, trailing space included.
 */
const GOLDEN: Array<[label: string, file: string, key: string | null]> = [
  ['plain', KEY, KEY],
  ['trailing LF', `${KEY}\n`, KEY],
  ['trailing CRLF', `${KEY}\r\n`, KEY],
  ['trailing space is kept', `${KEY} `, `${KEY} `],
  ['31 bytes with LF is refused', `${KEY.slice(0, 31)}\n`, null],
  ['32 bytes with LF is accepted', `${KEY}\n`, KEY],
];

const dirs: string[] = [];

afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe('pepper byte-order mark', () => {
  it('refuses a file that starts with a UTF-8 byte-order mark, in the CLI and the server', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mcp-tokens-pepper-'));
    dirs.push(dir);
    await writeFile(join(dir, PEPPER_FILE), `﻿${KEY}\n`);
    await expect(readPepper(dir)).rejects.toThrow('byte-order mark');
    expect(() => pepperBytes(`﻿${KEY}\n`)).toThrow('byte-order mark');
  });
});

describe('pepper golden table', () => {
  it.each(GOLDEN)('reads %s the same way in the CLI and the server', async (_label, file, key) => {
    const dir = await mkdtemp(join(tmpdir(), 'mcp-tokens-pepper-'));
    dirs.push(dir);
    await writeFile(join(dir, PEPPER_FILE), file);
    if (key === null) {
      await expect(readPepper(dir)).rejects.toThrow('too short');
      expect(() => pepperBytes(file)).toThrow('shorter than 32 bytes');
      return;
    }
    expect(await readPepper(dir)).toBe(key);
    expect(pepperBytes(file).equals(Buffer.from(key, 'utf8'))).toBe(true);
  });
});
