/**
 * Fix packet B item 5 integration: the database enforces an owner's cap (migration 0006), so a
 * write that skips the CLI is refused too. Skipped unless GELDAR_IT=1 (integrationEnabled). Each
 * case makes its own owner with a random suffix; afterAll drops the scratch database.
 */
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createScratchDatabase,
  dropScratchDatabase,
  freshSuffix,
  migrateScratch,
  scratchPool,
} from '../../../threshold/mcp/test/it/scratch-db.ts';
import { integrationEnabled } from '../../../threshold/mcp/test/live/gate.ts';

describe.skipIf(!integrationEnabled())('the owner cap in the database', () => {
  let database = '';
  let pool: Pool | undefined;

  function db(): Pool {
    if (pool === undefined) throw new Error('the scratch database is not set up');
    return pool;
  }

  /** An owner with the given cap, and a life and player for each status in `statuses`. */
  async function owner(
    cap: number,
    statuses: string[],
  ): Promise<{ ownerId: string; ids: string[] }> {
    const suffix = freshSuffix();
    const ownerId = `it-cap-${suffix}`;
    await db().query('INSERT INTO mcp_owners (owner_id, display, player_cap) VALUES ($1, $1, $2)', [
      ownerId,
      cap,
    ]);
    const ids: string[] = [];
    for (const [i, status] of statuses.entries()) {
      const tag = `${suffix}${i}`;
      const lifeId = `ag_cap_${tag}`;
      await db().query(
        `INSERT INTO agents (agent_id, name, life_seq, game_account, shard, mode, owner, harness,
           declared_model, model_config, tier, personality_seed)
         VALUES ($1, 'Cap', 1, $1, 'phaseit', 'sovereign', $2, 'it-on', 'self-reported',
           'declared:unverified', 'sovereign', NULL)`,
        [lifeId, ownerId],
      );
      const playerId = `ag-cap-${tag}`;
      await db().query(
        `INSERT INTO mcp_players (player_id, owner_id, life_id, display_name, harness, status)
         VALUES ($1, $2, $3, 'Cap', 'it-on', $4)`,
        [playerId, ownerId, lifeId, status],
      );
      ids.push(playerId);
    }
    return { ownerId, ids };
  }

  /** Adds an active player to an owner, bypassing the CLI; returns the error text if refused. */
  async function addActive(ownerId: string): Promise<string | undefined> {
    const suffix = freshSuffix();
    const lifeId = `ag_cap_${suffix}`;
    await db().query(
      `INSERT INTO agents (agent_id, name, life_seq, game_account, shard, mode, owner, harness,
         declared_model, model_config, tier, personality_seed)
       VALUES ($1, 'Cap', 1, $1, 'phaseit', 'sovereign', $2, 'it-on', 'self-reported',
         'declared:unverified', 'sovereign', NULL)`,
      [lifeId, ownerId],
    );
    try {
      await db().query(
        `INSERT INTO mcp_players (player_id, owner_id, life_id, display_name, harness, status)
         VALUES ($1, $2, $3, 'Cap', 'it-on', 'active')`,
        [`ag-cap-${suffix}`, ownerId, lifeId],
      );
      return undefined;
    } catch (error) {
      return (error as Error).message;
    }
  }

  beforeAll(async () => {
    database = await createScratchDatabase();
    pool = scratchPool(database);
    await migrateScratch(pool);
  });

  afterAll(async () => {
    await pool?.end();
    if (database !== '') await dropScratchDatabase(database);
  });

  it('refuses a direct insert past the cap', async () => {
    const made = await owner(1, ['active']);
    const refused = await addActive(made.ownerId);
    expect(refused).toMatch(/is at the cap of 1 sovereign players/);
  });

  it('does not count retired players', async () => {
    const made = await owner(1, ['retired']);
    expect(await addActive(made.ownerId)).toBeUndefined();
  });

  it('refuses re-activating a retired player past the cap', async () => {
    const made = await owner(1, ['active', 'retired']);
    const [, retired] = made.ids as [string, string];
    await expect(
      db().query("UPDATE mcp_players SET status = 'active' WHERE player_id = $1", [retired]),
    ).rejects.toThrow(/is at the cap of 1/);
  });

  it('lets a paused player resume and retire without a cap error', async () => {
    const made = await owner(1, ['active']);
    const [only] = made.ids as [string];
    await db().query("UPDATE mcp_players SET status = 'paused' WHERE player_id = $1", [only]);
    await db().query("UPDATE mcp_players SET status = 'active' WHERE player_id = $1", [only]);
    await db().query("UPDATE mcp_players SET status = 'retired' WHERE player_id = $1", [only]);
    expect(await addActive(made.ownerId)).toBeUndefined();
  });
});
