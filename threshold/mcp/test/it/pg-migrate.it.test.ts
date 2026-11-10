/**
 * WM-02 integration: the migration runner against a real Postgres. Skipped unless GELDAR_IT=1
 * (integrationEnabled). Each case creates its own scratch database and drops it, even on failure.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Pool } from 'pg';
import { afterEach, describe, expect, it } from 'vitest';
import { listMigrations } from '../../../../tools/migrate/src/migrate.ts';
import { integrationEnabled } from '../live/gate.ts';
import {
  createScratchDatabase,
  dropScratchDatabase,
  migrateScratch,
  SQL_DIR,
  scratchPool,
} from './scratch-db.ts';

describe.skipIf(!integrationEnabled())('migrations against a real Postgres', () => {
  const databases: string[] = [];
  const pools: Pool[] = [];

  afterEach(async () => {
    for (const pool of pools.splice(0)) await pool.end().catch(() => undefined);
    for (const name of databases.splice(0)) await dropScratchDatabase(name).catch(() => undefined);
  });

  /** A fresh scratch database and a pool on it; both are cleaned up after the case. */
  async function scratch(): Promise<{ name: string; pool: Pool }> {
    const name = await createScratchDatabase();
    databases.push(name);
    const pool = scratchPool(name);
    pools.push(pool);
    return { name, pool };
  }

  it('migrates a fresh database to the newest file and records every version', async () => {
    const { pool } = await scratch();
    const files = (await listMigrations(SQL_DIR)).map((file) => file.version);
    const applied = await migrateScratch(pool);
    const recorded = await pool.query<{ version: string }>(
      'SELECT version FROM schema_migrations ORDER BY version',
    );
    expect(applied, 'the versions the first run applied').toEqual(files);
    expect(
      recorded.rows.map((row) => row.version),
      'the ledger after the first run',
    ).toEqual(files);
  });

  it('baselines a database that has only 0001 and applies the later files', async () => {
    const { pool } = await scratch();
    // The schema of a database created before the runner: 0001 applied, no ledger.
    await pool.query(readFileSync(join(SQL_DIR, '0001_init.sql'), 'utf8'));
    const applied = await migrateScratch(pool);
    const recorded = await pool.query<{ version: string }>(
      'SELECT version FROM schema_migrations ORDER BY version',
    );
    expect(applied, 'the versions applied to a baselined database').not.toContain('0001');
    expect(applied, 'the versions applied to a baselined database').toContain('0002');
    expect(
      recorded.rows.map((row) => row.version),
      'the ledger after the baseline run',
    ).toContain('0001');
  });

  it('does nothing on a second run', async () => {
    const { pool } = await scratch();
    await migrateScratch(pool);
    const before = await pool.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM schema_migrations',
    );
    const again = await migrateScratch(pool);
    const after = await pool.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM schema_migrations',
    );
    expect(again, 'the versions a rerun applied').toEqual([]);
    expect(after.rows[0]?.n, 'the ledger row count after a rerun').toBe(before.rows[0]?.n);
  });
});
