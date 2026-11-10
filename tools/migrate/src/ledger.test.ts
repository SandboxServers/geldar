import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { listMigrations } from './migrate.ts';

const SQL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'sql');

// 0001 predates the ledger and is applied, so it cannot be edited to insert its row. The runner
// records it, and 0002 creates schema_migrations with its row. Every later file inserts its own.
const PREDATES_LEDGER = new Set(['0001']);

/** The versions a migration's `INSERT INTO schema_migrations (version) VALUES (...)` names. */
export function ledgerVersions(sql: string): string[] {
  const statements = sql.matchAll(
    /INSERT INTO schema_migrations\s*\(version\)\s*VALUES\s*([^;]*);/gi,
  );
  return [...statements].flatMap((match) =>
    [...(match[1] ?? '').matchAll(/'(\d{4})'/g)].map((tuple) => tuple[1] ?? ''),
  );
}

describe('the migration ledger', () => {
  it('every migration inserts its own schema_migrations row', async () => {
    const missing: string[] = [];
    for (const file of await listMigrations(SQL_DIR)) {
      if (PREDATES_LEDGER.has(file.version)) continue;
      const sql = await readFile(file.path, 'utf8');
      if (!ledgerVersions(sql).includes(file.version)) missing.push(file.name);
    }
    expect(missing, 'migrations without their own schema_migrations row').toEqual([]);
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
