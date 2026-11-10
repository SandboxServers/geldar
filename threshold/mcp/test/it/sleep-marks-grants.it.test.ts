/**
 * WM-02 fix round 2 (F5): migration 0004 narrows the grant on mcp_sleep_marks to three columns, so
 * geldar_mcp can upsert its mark but cannot rewrite the life_id that keys it. Skipped unless
 * GELDAR_IT=1 (integrationEnabled). The case runs on a scratch database and drops it afterwards.
 */
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PgAgentStore } from '../../src/store/pg-agents.ts';
import { integrationEnabled } from '../live/gate.ts';
import {
  createScratchDatabase,
  dropScratchDatabase,
  freshSuffix,
  migrateScratch,
  scratchPool,
  seedPlayer,
} from './scratch-db.ts';

describe.skipIf(!integrationEnabled())('the sleep mark grant after migration 0004', () => {
  let database = '';
  let admin: Pool;
  let mcp: Pool;

  beforeAll(async () => {
    database = await createScratchDatabase();
    admin = scratchPool(database);
    await migrateScratch(admin);
    mcp = scratchPool(database, 'geldar_mcp');
  });

  afterAll(async () => {
    await mcp?.end().catch(() => undefined);
    await admin?.end().catch(() => undefined);
    if (database !== '') await dropScratchDatabase(database).catch(() => undefined);
  });

  it('upserts the sleep day, the cursor and the timestamp as geldar_mcp', async () => {
    const seeded = await seedPlayer(admin, freshSuffix());
    const store = new PgAgentStore(mcp);
    await store.write(seeded.lifeId, { lastSleepDay: 3, cursor: 4 });
    await store.write(seeded.lifeId, { lastSleepDay: 5, cursor: 9 });
    expect(await store.read(seeded.lifeId), 'the mark as last written').toEqual({
      lastSleepDay: 5,
      cursor: 9,
    });
  });

  it('refuses an UPDATE of life_id, even to its own value', async () => {
    const seeded = await seedPlayer(admin, freshSuffix());
    await new PgAgentStore(mcp).write(seeded.lifeId, { lastSleepDay: 2, cursor: 1 });
    await expect(
      mcp.query('UPDATE mcp_sleep_marks SET life_id = life_id WHERE life_id = $1', [seeded.lifeId]),
    ).rejects.toThrow(/permission denied/);
  });
});
