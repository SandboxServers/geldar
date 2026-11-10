import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { listMigrations } from './migrate.ts';

const SQL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'sql');

// 0001 predates the ledger and is applied, so it cannot be edited to insert its row. The runner
// records it, and 0002 creates schema_migrations with its row. Every later file inserts its own.
const PREDATES_LEDGER = new Set(['0001']);

/**
 * The SQL without its comments: each `-- line` and each `/* block *\/`, so an insert that is
 * commented out does not count. One alternation, so the first comment opener wins.
 */
export function withoutComments(sql: string): string {
  return sql.replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, ' ');
}

/** The versions a migration's `INSERT INTO schema_migrations (version) VALUES (...)` names. */
export function ledgerVersions(sql: string): string[] {
  const statements = withoutComments(sql).matchAll(
    /INSERT INTO schema_migrations\s*\(version\)\s*VALUES\s*([^;]*);/gi,
  );
  return [...statements].flatMap((match) =>
    [...(match[1] ?? '').matchAll(/'(\d{4})'/g)].map((tuple) => tuple[1] ?? ''),
  );
}

/** True when a migration's SQL inserts its own version into schema_migrations. */
export function hasOwnRow(version: string, sql: string): boolean {
  return ledgerVersions(sql).includes(version);
}

describe('the migration ledger', () => {
  it('every migration inserts its own schema_migrations row', async () => {
    const missing: string[] = [];
    for (const file of await listMigrations(SQL_DIR)) {
      if (PREDATES_LEDGER.has(file.version)) continue;
      const sql = await readFile(file.path, 'utf8');
      if (!hasOwnRow(file.version, sql)) missing.push(file.name);
    }
    expect(missing, 'migrations without their own schema_migrations row').toEqual([]);
  });

  it('fails a migration whose only row is commented out', () => {
    const line = "INSERT INTO schema_migrations (version) VALUES ('0005') ON CONFLICT DO NOTHING;";
    expect(hasOwnRow('0005', `-- ${line}\nCREATE TABLE t (x INT);`)).toBe(false);
    expect(hasOwnRow('0005', `/* ${line} */\nCREATE TABLE t (x INT);`)).toBe(false);
    expect(hasOwnRow('0005', `${line}\nCREATE TABLE t (x INT);`)).toBe(true);
  });

  it('a block opener inside a line comment does not hide a live insert', () => {
    const line = "INSERT INTO schema_migrations (version) VALUES ('0005');";
    expect(hasOwnRow('0005', `-- note /* \n${line}\n*/`)).toBe(true);
  });

  it('reads the versions from a multi-row insert', () => {
    expect(
      ledgerVersions("INSERT INTO schema_migrations (version) VALUES ('0001'), ('0002');"),
    ).toEqual(['0001', '0002']);
  });

  it('finds no row in a file that only mentions the table', () => {
    expect(
      ledgerVersions('-- schema_migrations is written later\nCREATE TABLE t (x INT);'),
    ).toEqual([]);
  });
});
