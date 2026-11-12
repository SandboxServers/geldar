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
const REGISTER_READS_FILE = join(SQL_DIR, 'test', 'check-schema-register-reads.sql');
const KINO_FUNCTIONS_FILE = join(SQL_DIR, 'test', 'check-schema-kino-functions.sql');
const GLASS_JOURNAL_FILE = join(SQL_DIR, 'test', 'check-schema-glass-journal.sql');

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
      await client.query(readFileSync(REGISTER_READS_FILE, 'utf8'));
      await client.query(readFileSync(KINO_FUNCTIONS_FILE, 'utf8'));
      await client.query(readFileSync(GLASS_JOURNAL_FILE, 'utf8'));
    } finally {
      await client.end();
    }
    const passed = notices.filter((text) => text.startsWith('schema check passed'));
    // One NOTICE per check block, in file order; a missing, extra or reordered block fails.
    const expected = [
      /^schema check passed: \d+ tables, pgvector \S+$/,
      /^schema check passed: \d+ mcp tables, role geldar_mcp$/,
      /^schema check passed: role geldar_glass reads its Glass tables and columns and writes none$/,
      /^schema check passed: append-only triggers on 4 audit tables, geldar_mcp cannot change mcp_journal$/,
      /^schema check passed: role geldar_register and mcp_identities$/,
      /^schema check passed: register role reads through functions and the sign-up gates refuse$/,
      /^schema check passed: Kino definer functions answer for the named identity and refuse the rest$/,
    ];
    expect(passed, 'one NOTICE per check block that passed').toHaveLength(expected.length);
    expected.forEach((pattern, index) => {
      expect(passed[index], `check block ${index + 1}`).toMatch(pattern);
    });
  });
});
