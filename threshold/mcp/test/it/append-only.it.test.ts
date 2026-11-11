/**
 * P1-C1-05a integration: sql/0007 makes the audit tables append-only (decision 0085). On a freshly
 * migrated scratch database, an UPDATE or DELETE of a row is refused on each of receipts, thoughts,
 * suppressed_wakeups and mcp_journal, while INSERT works. geldar_mcp cannot change mcp_journal.
 * TRUNCATE is allowed, and it runs last because it clears the rows the other cases use. Skipped
 * unless GELDAR_IT=1 (integrationEnabled).
 */
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { integrationEnabled } from '../live/gate.ts';
import {
  createScratchDatabase,
  dropScratchDatabase,
  freshSuffix,
  migrateScratch,
  scratchPool,
  seedPlayer,
} from './scratch-db.ts';

/** Each audit table with a text column to change in the UPDATE case. */
const AUDIT_TABLES = [
  { table: 'receipts', column: 'detail' },
  { table: 'thoughts', column: 'wake_reason' },
  { table: 'suppressed_wakeups', column: 'reason' },
  { table: 'mcp_journal', column: 'text' },
] as const;

describe.skipIf(!integrationEnabled())('append-only audit tables against a real Postgres', () => {
  let database = '';
  let admin: Pool | undefined;
  let lifeId = '';

  beforeAll(async () => {
    database = await createScratchDatabase();
    admin = scratchPool(database);
    await migrateScratch(admin);
    lifeId = (await seedPlayer(admin, freshSuffix())).lifeId;
    await admin.query(
      `INSERT INTO thoughts (thought_id, life_id, at) VALUES ('th_ao', $1, now())`,
      [lifeId],
    );
    await admin.query(
      `INSERT INTO receipts (receipt_id, action_id, life_id, kind, phase, detail)
       VALUES ('rc_ao', 'ac_ao', $1, 'k', 'prepared', 'first')`,
      [lifeId],
    );
    await admin.query(
      `INSERT INTO suppressed_wakeups (life_id, at, reason) VALUES ($1, now(), 'quiet')`,
      [lifeId],
    );
    await admin.query(`INSERT INTO mcp_journal (life_id, at, text) VALUES ($1, now(), 'line')`, [
      lifeId,
    ]);
  });

  afterAll(async () => {
    await admin?.end();
    if (database !== '') await dropScratchDatabase(database);
  });

  for (const { table, column } of AUDIT_TABLES) {
    it(`refuses UPDATE and DELETE on ${table} as the superuser`, async () => {
      await expect(admin?.query(`UPDATE ${table} SET ${column} = 'changed'`)).rejects.toThrow(
        /append-only/,
      );
      await expect(admin?.query(`DELETE FROM ${table}`)).rejects.toThrow(/append-only/);
    });
  }

  it('still accepts INSERT on each audit table', async () => {
    await expect(
      admin?.query(`INSERT INTO thoughts (thought_id, life_id, at) VALUES ('th_ao2', $1, now())`, [
        lifeId,
      ]),
    ).resolves.toBeDefined();
    await expect(
      admin?.query(
        `INSERT INTO receipts (receipt_id, action_id, life_id, kind, phase)
         VALUES ('rc_ao2', 'ac_ao', $1, 'k', 'committed')`,
        [lifeId],
      ),
    ).resolves.toBeDefined();
    await expect(
      admin?.query(
        `INSERT INTO suppressed_wakeups (life_id, at, reason) VALUES ($1, now(), 'again')`,
        [lifeId],
      ),
    ).resolves.toBeDefined();
    await expect(
      admin?.query(`INSERT INTO mcp_journal (life_id, at, text) VALUES ($1, now(), 'more')`, [
        lifeId,
      ]),
    ).resolves.toBeDefined();
  });

  it('refuses UPDATE and DELETE on mcp_journal as geldar_mcp, which has no such privilege', async () => {
    const mcp = scratchPool(database, 'geldar_mcp');
    try {
      await expect(mcp.query(`UPDATE mcp_journal SET text = 'changed'`)).rejects.toThrow(
        /permission denied/,
      );
      await expect(mcp.query('DELETE FROM mcp_journal')).rejects.toThrow(/permission denied/);
      await expect(
        mcp.query(`INSERT INTO mcp_journal (life_id, at, text) VALUES ($1, now(), 'mcp')`, [
          lifeId,
        ]),
      ).resolves.toBeDefined();
    } finally {
      await mcp.end();
    }
  });

  it('allows TRUNCATE on a throwaway database', async () => {
    await expect(
      admin?.query('TRUNCATE receipts, thoughts, suppressed_wakeups, mcp_journal'),
    ).resolves.toBeDefined();
  });
});
