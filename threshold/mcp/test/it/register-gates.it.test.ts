/**
 * C2-R5 integration: the register definer functions (0010, 0011) and the MCP's banned-owner lookup
 * against a real database. Skipped unless GELDAR_IT=1. The SQL gates that one DO block cannot
 * reach live here: the lifetime cap under parallel creates, the identity row lock against a
 * concurrent ban (F17), and RESOLVE_SQL's owner_banned clause (F15).
 */
import { randomBytes } from 'node:crypto';
import type { ClientConfig, Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PgTokenStore } from '../../src/store/pg-tokens.ts';
import { integrationEnabled } from '../live/gate.ts';
import {
  adminConfig,
  createScratchDatabase,
  dropScratchDatabase,
  freshSuffix,
  insertToken,
  migrateScratch,
  scratchPool,
  seedPlayer,
} from './scratch-db.ts';

describe.skipIf(!integrationEnabled())('register gates against a real database', () => {
  let database = '';
  let admin: Pool;
  let register: Pool;
  let mcp: Pool;

  beforeAll(async () => {
    database = await createScratchDatabase();
    admin = scratchPool(database);
    await migrateScratch(admin);
    register = scratchPool(database, 'geldar_register');
    mcp = scratchPool(database, 'geldar_mcp');
  });

  afterAll(async () => {
    await register?.end().catch(() => undefined);
    await mcp?.end().catch(() => undefined);
    await admin?.end().catch(() => undefined);
    if (database !== '') await dropScratchDatabase(database).catch(() => undefined);
  });

  async function identityFor(ownerId: string, cap = 50): Promise<Buffer> {
    const hash = randomBytes(32);
    await admin.query(
      'INSERT INTO mcp_owners (owner_id, display, player_cap) VALUES ($1, $1, $2) ON CONFLICT DO NOTHING',
      [ownerId, cap],
    );
    await admin.query(
      "INSERT INTO mcp_identities (identity_hash, provider, owner_id) VALUES ($1, 'github', $2)",
      [hash, ownerId],
    );
    return hash;
  }

  const create = (pool: Pool, hash: Buffer, n: string) =>
    pool.query('SELECT register_create_player($1, $2, $3, $4, $5, $6, $7, $8)', [
      hash,
      `ag-gate-${n}`,
      `ag_gate_${n}`,
      'gate',
      'it-on',
      'phaseit',
      `tk_gate_${n}`,
      randomBytes(32),
    ]);

  it('12 parallel creates for one owner make exactly 10 players', async () => {
    const hash = await identityFor(`gate-own-${freshSuffix()}`);
    const suffix = freshSuffix();
    const results = await Promise.allSettled(
      Array.from({ length: 12 }, (_, i) => create(register, hash, `${suffix}${i}`)),
    );
    const failed = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(results.length - failed.length, 'creates that succeeded').toBe(10);
    expect(failed.map((r) => (r.reason as { code?: string }).code)).toEqual(['54000', '54000']);
  });

  it('a mint waits for a concurrent ban and then refuses (identity row lock)', async () => {
    const owner = `gate-own-${freshSuffix()}`;
    const hash = await identityFor(owner);
    const suffix = freshSuffix();
    await create(register, hash, suffix);
    const banner = await admin.connect();
    try {
      await banner.query('BEGIN');
      await banner.query('UPDATE mcp_identities SET banned_at = now() WHERE identity_hash = $1', [
        hash,
      ]);
      let settled = false;
      const mint = register
        .query('SELECT register_mint_token($1, $2, $3, $4)', [
          hash,
          `ag-gate-${suffix}`,
          `tk_race_${suffix}`,
          randomBytes(32),
        ])
        .then(
          () => 'minted',
          (error: { code?: string }) => error.code,
        )
        .finally(() => {
          settled = true;
        });
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(settled, 'the mint must wait for the ban transaction').toBe(false);
      await banner.query('COMMIT');
      expect(await mint).toBe('42501');
    } finally {
      banner.release();
    }
  });

  describe('the MCP lookup of a banned owner', () => {
    const listen = (): ClientConfig => ({
      ...adminConfig(database),
      options: '-c role=geldar_mcp',
    });

    it('resolves a live token, then refuses it and explains token_revoked once the identity is banned', async () => {
      const seeded = await seedPlayer(admin, freshSuffix());
      const hash = randomBytes(32);
      await insertToken(admin, seeded.playerId, hash, '1 day');
      await admin.query(
        "INSERT INTO mcp_identities (identity_hash, provider, owner_id) VALUES ($1, 'github', $2)",
        [randomBytes(32), seeded.ownerId],
      );
      const store = new PgTokenStore(mcp, { 'it-on': true }, listen());
      expect((await store.resolve(hash, Date.now()))?.player.playerId).toBe(seeded.playerId);
      await admin.query('UPDATE mcp_identities SET banned_at = now() WHERE owner_id = $1', [
        seeded.ownerId,
      ]);
      // a fresh store: the first one holds the hit in its 5 s cache
      const fresh = new PgTokenStore(mcp, { 'it-on': true }, listen());
      expect(await fresh.resolve(hash, Date.now())).toBeNull();
      expect(await fresh.explainMiss(hash, Date.now())).toBe('token_revoked');
    });
  });
});
