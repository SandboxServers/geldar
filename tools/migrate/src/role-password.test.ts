import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Pool } from 'pg';
import { afterEach, describe, expect, it } from 'vitest';
import { readPasswordFile, setRolePassword } from './migrate.ts';

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

  it('refuses any role but geldar_mcp, before connecting', async () => {
    const { pool, sent, connects } = fakePool();
    await expect(setRolePassword(pool, 'postgres', 'hunter2-secret', QUIET)).rejects.toThrow(
      'only geldar_mcp',
    );
    expect(connects.count).toBe(0);
    expect(sent).toEqual([]);
  });

  it('refuses an empty password', async () => {
    const { pool, connects } = fakePool();
    await expect(setRolePassword(pool, 'geldar_mcp', '', QUIET)).rejects.toThrow('empty');
    expect(connects.count).toBe(0);
  });
});

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
    expect(await readPasswordFile(await fileWith('﻿pencil\r\n'))).toBe('pencil');
  });

  it('strips one trailing LF and keeps everything else', async () => {
    expect(await readPasswordFile(await fileWith('pen cil\n'))).toBe('pen cil');
  });
});
