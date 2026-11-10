/**
 * WM-RG integration: sql/test/check-schema.sql against a freshly migrated scratch database. Skipped
 * unless GELDAR_IT=1 (integrationEnabled). The check is plain SQL with no psql meta-commands: it
 * raises an exception naming the missing table, trigger, grant or receipts rule, and it ends with
 * a NOTICE per block that passed. The file runs as one simple-protocol query on one connection,
 * because its pg_temp probe function lives in that session.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client, type Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { integrationEnabled } from '../live/gate.ts';
import {
  adminConfig,
  createScratchDatabase,
  dropScratchDatabase,
  migrateScratch,
  SQL_DIR,
  scratchPool,
} from './scratch-db.ts';

const CHECK_FILE = join(SQL_DIR, 'test', 'check-schema.sql');

describe.skipIf(!integrationEnabled())('sql/test/check-schema.sql against a real Postgres', () => {
  let database = '';
  let pool: Pool | undefined;

  beforeAll(async () => {
    database = await createScratchDatabase();
    pool = scratchPool(database);
    await migrateScratch(pool);
  });

  afterAll(async () => {
    await pool?.end();
    if (database !== '') await dropScratchDatabase(database);
  });

  it('runs to the end on a freshly migrated database', async () => {
    const check = readFileSync(CHECK_FILE, 'utf8');
    const client = new Client(adminConfig(database));
    const notices: string[] = [];
    client.on('notice', (message) => notices.push(message.message ?? ''));
    await client.connect();
    try {
      // A failed check rejects here with its schema check message; a passing one returns.
      await client.query(check);
    } finally {
      await client.end();
    }
    const passed = notices.filter((text) => text.startsWith('schema check passed'));
    expect(passed, 'one NOTICE per check block that passed').toHaveLength(3);
  });
});
