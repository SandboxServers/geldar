import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Pool } from 'pg';
import { afterEach, describe, expect, it } from 'vitest';
import { passwordStatement, readPasswordFile, setRolePassword } from './migrate.ts';
import { scramVerifier } from './scram.ts';

/** A pool that records every statement it runs and every connect. */
function fakePool(): { pool: Pool; sent: string[]; connects: { count: number } } {
  const sent: string[] = [];
  const connects = { count: 0 };
  const client = {
    query: async (text: string) => {
      sent.push(text);
      return { rows: [] };
    },
    escapeLiteral: (value: string) => `'${value.replaceAll("'", "''")}'`,
    release: () => undefined,
  };
  const pool = {
    connect: async () => {
      connects.count += 1;
      return client;
    },
  };
  return { pool: pool as unknown as Pool, sent, connects };
}

const QUIET = { dryRun: false, log: (): void => undefined };

describe('setRolePassword', () => {
  it('sends a SCRAM-SHA-256 verifier, never the plaintext password', async () => {
    const { pool, sent } = fakePool();
    await setRolePassword(pool, 'geldar_mcp', 'hunter2-secret', QUIET);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatch(/^ALTER ROLE geldar_mcp WITH LOGIN PASSWORD 'SCRAM-SHA-256\$4096:/);
    expect(sent[0]).not.toContain('hunter2-secret');
  });

  it('with dry-run, checks the password, reports, and runs nothing', async () => {
    const { pool, sent, connects } = fakePool();
    const lines: string[] = [];
    await setRolePassword(pool, 'geldar_mcp', 'hunter2-secret', {
      dryRun: true,
      log: (line) => lines.push(line),
    });
    expect(connects.count, 'no connection').toBe(0);
    expect(sent, 'no statement').toEqual([]);
    expect(lines[0]).toContain('dry run');
  });

  it('sends a SCRAM-SHA-256 verifier for geldar_glass, the Glass reader', async () => {
    const { pool, sent } = fakePool();
    await setRolePassword(pool, 'geldar_glass', 'hunter2-secret', QUIET);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatch(/^ALTER ROLE geldar_glass WITH LOGIN PASSWORD 'SCRAM-SHA-256\$4096:/);
    expect(sent[0]).not.toContain('hunter2-secret');
  });

  it('sends a SCRAM-SHA-256 verifier for geldar_register, the register service (C2-08c)', async () => {
    const { pool, sent } = fakePool();
    await setRolePassword(pool, 'geldar_register', 'hunter2-secret', QUIET);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatch(
      /^ALTER ROLE geldar_register WITH LOGIN PASSWORD 'SCRAM-SHA-256\$4096:/,
    );
    expect(sent[0]).not.toContain('hunter2-secret');
  });

  it('refuses any role but the three, before connecting', async () => {
    for (const role of ['postgres', 'geldar_historian', 'geldar_glass_admin']) {
      const { pool, sent, connects } = fakePool();
      await expect(setRolePassword(pool, role, 'hunter2-secret', QUIET)).rejects.toThrow(
        'only geldar_mcp or geldar_glass or geldar_register',
      );
      expect(connects.count, role).toBe(0);
      expect(sent, role).toEqual([]);
    }
  });

  it('refuses an empty password', async () => {
    const { pool, connects } = fakePool();
    await expect(setRolePassword(pool, 'geldar_mcp', '', QUIET)).rejects.toThrow('empty');
    expect(connects.count).toBe(0);
  });
});

/**
 * The password-file table. threshold/mcp/src/main.test.ts holds the same rows for the server's
 * reader: both must agree. `null` means the input is refused.
 */
const PASSWORD_FILE_TABLE: ReadonlyArray<readonly [string, string | null]> = [
  ['﻿pencil\r\n', 'pencil'],
  ['pencil\n', 'pencil'],
  ['pencil', 'pencil'],
  ['pen cil\n', 'pen cil'],
  ['﻿pencil', 'pencil'],
  ['pencil\r\n\r\n', null],
  [' pencil\n', null],
  ['﻿ pencil', null],
  ['pencil \n', null],
  ['pencil\t', null],
];

describe('readPasswordFile', () => {
  const dirs: string[] = [];
  afterEach(async () => {
    for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
  });

  async function fileWith(content: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'geldar-pw-'));
    dirs.push(dir);
    const path = join(dir, 'password');
    await writeFile(path, content, 'utf8');
    return path;
  }

  it('strips a UTF-8 byte-order mark and one trailing CRLF', async () => {
    expect(await readPasswordFile(await fileWith('\uFEFFpencil\r\n'))).toBe('pencil');
  });

  it('strips one trailing LF and keeps everything else', async () => {
    expect(await readPasswordFile(await fileWith('pen cil\n'))).toBe('pen cil');
  });

  it('strips a byte-order mark alone, with no newline', async () => {
    expect(await readPasswordFile(await fileWith('﻿pencil'))).toBe('pencil');
  });

  it('strips only one trailing CRLF: a second one is refused as trailing whitespace', async () => {
    await expect(readPasswordFile(await fileWith('pencil\r\n\r\n'))).rejects.toThrow('whitespace');
  });

  it('refuses a leading space', async () => {
    await expect(readPasswordFile(await fileWith(' pencil\n'))).rejects.toThrow('whitespace');
  });

  it('refuses a space left after the byte-order mark is stripped', async () => {
    await expect(readPasswordFile(await fileWith('﻿ pencil'))).rejects.toThrow('whitespace');
  });

  it('refuses a trailing space', async () => {
    await expect(readPasswordFile(await fileWith('pencil \n'))).rejects.toThrow('whitespace');
  });

  it('refuses a trailing tab', async () => {
    await expect(readPasswordFile(await fileWith('pencil\t'))).rejects.toThrow('whitespace');
  });

  it('reads the password file the way the server does, row for row', async () => {
    for (const [input, expected] of PASSWORD_FILE_TABLE) {
      const read = readPasswordFile(await fileWith(input));
      if (expected === null) {
        await expect(read, JSON.stringify(input)).rejects.toThrow('whitespace');
      } else {
        await expect(read, JSON.stringify(input)).resolves.toBe(expected);
      }
    }
  });
});

describe('passwordStatement', () => {
  const SALT = Buffer.alloc(16, 7);
  const PASSWORD = 'hunter2-secret';
  const quote = (value: string): string => `'${value.replaceAll("'", "''")}'`;

  it('never contains the plaintext password', () => {
    const verifier = scramVerifier(PASSWORD, SALT);
    const sql = passwordStatement('geldar_mcp', verifier, quote);
    expect(sql).not.toContain(PASSWORD);
  });

  it('uses the SCRAM-SHA-256$4096:<salt>$<StoredKey>:<ServerKey> format', () => {
    const verifier = scramVerifier(PASSWORD, SALT);
    const sql = passwordStatement('geldar_mcp', verifier, quote);
    const base64 = '[A-Za-z0-9+/]+=*';
    const format = new RegExp(
      `^ALTER ROLE geldar_mcp WITH LOGIN PASSWORD 'SCRAM-SHA-256\\$4096:${base64}\\$${base64}:${base64}'$`,
    );
    expect(sql).toMatch(format);
    expect(sql).toBe(`ALTER ROLE geldar_mcp WITH LOGIN PASSWORD '${verifier}'`);
  });

  it('refuses a role name that is not plain', () => {
    expect(() => passwordStatement('geldar_mcp; DROP TABLE x', 'v', quote)).toThrow('not a plain');
  });
});
