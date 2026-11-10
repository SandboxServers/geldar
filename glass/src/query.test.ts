import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  getThought,
  listAgents,
  listReceipts,
  listThoughts,
  type SqlClient,
  streamStartCursor,
  thoughtsAfter,
} from './query.ts';

/** The five tables migration 0005 grants to geldar_glass, and nothing else. */
const ALLOWED_TABLES = ['thoughts', 'actions', 'receipts', 'intents', 'agents'];
const SRC_DIR = dirname(fileURLToPath(import.meta.url));
const WRITE_WORDS = /\b(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|TRUNCATE|GRANT|REVOKE|COPY)\b/i;
const SQL_WORD = /\b(SELECT|INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|TRUNCATE|GRANT|REVOKE|COPY)\b/i;

/** Every source file in glass/src that is not a test. */
function sourceFiles(): { name: string; text: string }[] {
  return readdirSync(SRC_DIR)
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .map((name) => ({ name, text: readFileSync(join(SRC_DIR, name), 'utf8') }));
}

/** The template literals in the sources that look like SQL. */
function sqlStatements(): { file: string; sql: string }[] {
  const found: { file: string; sql: string }[] = [];
  for (const { name, text } of sourceFiles()) {
    for (const match of text.matchAll(/`([^`]*)`/g)) {
      const sql = match[1] ?? '';
      if (SQL_WORD.test(sql)) found.push({ file: name, sql });
    }
  }
  return found;
}

type Call = { text: string; values: unknown[] };

function recordingDb(): { db: SqlClient; calls: Call[] } {
  const calls: Call[] = [];
  const db: SqlClient = {
    query: vi.fn(async (text: string, values: unknown[]) => {
      calls.push({ text, values });
      return { rows: [] };
    }),
  };
  return { db, calls };
}

describe('the Glass SQL allowlist', () => {
  it('finds the statements, all of them SELECT and none of a write verb', () => {
    const statements = sqlStatements();
    expect(statements.length).toBeGreaterThanOrEqual(6);
    for (const { file, sql } of statements) {
      expect(sql.trimStart(), file).toMatch(/^SELECT\b/i);
      expect(WRITE_WORDS.test(sql), `${file}: ${sql.slice(0, 40)}`).toBe(false);
    }
  });

  it('every statement names only the five allowlisted tables', () => {
    for (const { file, sql } of sqlStatements()) {
      const tables = [...sql.matchAll(/\b(?:FROM|JOIN)\s+([a-z_][a-z0-9_]*)/gi)].map((m) =>
        (m[1] ?? '').toLowerCase(),
      );
      // `SELECT now()` names no table; every other statement has a FROM and names one.
      if (/\bFROM\b/i.test(sql)) expect(tables.length, `${file} names a table`).toBeGreaterThan(0);
      for (const table of tables) {
        expect(ALLOWED_TABLES, `${file} reads ${table}`).toContain(table);
      }
    }
  });

  it('no statement is built from text: every query call passes a literal and interpolates nothing', () => {
    for (const { name, text } of sourceFiles()) {
      // A call whose first argument is not a template literal, such as a variable or a concatenation.
      expect(text, name).not.toMatch(/\.query\(\s*[^\s`]/);
    }
    for (const { file, sql } of sqlStatements()) {
      expect(sql, file).not.toContain('${');
    }
  });

  it('a hostile filter value travels as a parameter and never reaches the SQL text', async () => {
    const hostile = "x' OR 1=1; DROP TABLE thoughts; --";
    const clean = recordingDb();
    const dirty = recordingDb();
    await listThoughts(clean.db, { limit: 5, outcome: 'parsed' });
    await listThoughts(dirty.db, { limit: 5, outcome: 'parsed', lifeId: hostile, tier: hostile });
    expect(dirty.calls[0]?.text).toBe(clean.calls[0]?.text);
    expect(dirty.calls[0]?.text).not.toContain('DROP');
    expect(dirty.calls[0]?.values).toEqual(expect.arrayContaining([hostile]));
  });

  it('a hostile id, action id or cursor is a parameter in every statement that takes one', async () => {
    const hostile = "'; DELETE FROM agents; --";
    const { db, calls } = recordingDb();
    await getThought(db, hostile);
    await listReceipts(db, hostile);
    await thoughtsAfter(db, { at: '2026-11-10 00:00:00+00', id: hostile }, 10);
    await listAgents(db);
    await streamStartCursor(db);
    for (const call of calls) expect(call.text).not.toContain('DELETE');
    expect(calls[0]?.values).toEqual([hostile]);
    expect(calls[1]?.values).toEqual([hostile]);
    expect(calls[2]?.values).toEqual(['2026-11-10 00:00:00+00', hostile, 10]);
  });
});
