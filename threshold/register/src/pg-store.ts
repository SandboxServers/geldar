import pg from 'pg';
import type { MintRequest, NewPlayerRequest, OwnerRecord, PlayerRow, Store } from './store.ts';

export interface PgStoreOptions {
  readonly shard: string;
  readonly startCredits: number;
}

const hex = (h: string): Buffer => Buffer.from(h, 'hex');

/** The store over Postgres, connected as geldar_register (migrations 0008 and 0009). */
export class PgStore implements Store {
  private readonly pool: pg.Pool;
  private readonly options: PgStoreOptions;
  constructor(connectionString: string, options: PgStoreOptions) {
    this.pool = new pg.Pool({ connectionString, max: 4 });
    this.options = options;
  }

  async findOwner(identityHash: string): Promise<OwnerRecord | null> {
    const r = await this.pool.query(
      'SELECT owner_id, banned_at IS NOT NULL AS banned FROM mcp_identities WHERE identity_hash = $1',
      [hex(identityHash)],
    );
    const row = r.rows[0];
    return row ? { ownerId: String(row.owner_id), banned: row.banned === true } : null;
  }

  async countNewOwnersSince(sinceMs: number): Promise<number> {
    const r = await this.pool.query(
      'SELECT count(*)::int AS n FROM mcp_identities WHERE created_at >= $1',
      [new Date(sinceMs)],
    );
    return Number(r.rows[0]?.n ?? 0);
  }

  async createOwner(
    identity: { identityHash: string; provider: string; display: string },
    ownerId: string,
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('INSERT INTO mcp_owners (owner_id, display) VALUES ($1, $2)', [
        ownerId,
        identity.display,
      ]);
      await client.query(
        'INSERT INTO mcp_identities (identity_hash, provider, owner_id) VALUES ($1, $2, $3)',
        [hex(identity.identityHash), identity.provider, ownerId],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async listPlayers(ownerId: string): Promise<PlayerRow[]> {
    const r = await this.pool.query(
      'SELECT player_id, display_name, harness, status FROM mcp_players WHERE owner_id = $1 ORDER BY player_id',
      [ownerId],
    );
    return r.rows.map((row) => ({
      playerId: String(row.player_id),
      name: String(row.display_name),
      harness: String(row.harness),
      status: String(row.status),
    }));
  }

  async createPlayer(q: NewPlayerRequest): Promise<'ok' | 'cap' | 'taken'> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO agents (agent_id, name, life_seq, game_account, shard, mode, owner, harness,
           declared_model, model_config, tier, personality_seed)
         VALUES ($1, $2, 1, $1, $3, 'sovereign', $4, $5, 'self-reported', 'declared:unverified', 'sovereign', NULL)`,
        [q.lifeId, q.name, this.options.shard, q.ownerId, q.harness],
      );
      // The owner cap trigger (0006) refuses the row past the owner's player_cap.
      await client.query(
        `INSERT INTO mcp_players (player_id, owner_id, life_id, display_name, harness, status)
         VALUES ($1, $2, $3, $4, $5, 'active')`,
        [q.playerId, q.ownerId, q.lifeId, q.name, q.harness],
      );
      await client.query(
        'INSERT INTO mcp_budget (life_id, credits, accrued_at) VALUES ($1, $2, now())',
        [q.lifeId, this.options.startCredits],
      );
      await client.query('SELECT register_mint_token($1, $2, $3, $4)', [
        hex(q.identityHash),
        q.playerId,
        q.tokenId,
        q.tokenHash,
      ]);
      await client.query('COMMIT');
      return 'ok';
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      const code = (error as { code?: string }).code;
      if (code === '23514') return 'cap';
      if (code === '23505') return 'taken';
      throw error;
    } finally {
      client.release();
    }
  }

  async mintToken(q: MintRequest): Promise<boolean> {
    try {
      await this.pool.query('SELECT register_mint_token($1, $2, $3, $4)', [
        hex(q.identityHash),
        q.playerId,
        q.tokenId,
        q.tokenHash,
      ]);
      return true;
    } catch (error) {
      if ((error as { code?: string }).code === '42501') return false;
      throw error;
    }
  }

  async retirePlayer(ownerId: string, playerId: string): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const r = await client.query(
        `UPDATE mcp_players SET status = 'retired'
         WHERE player_id = $1 AND owner_id = $2 AND status <> 'retired' RETURNING player_id`,
        [playerId, ownerId],
      );
      if (r.rows.length === 0) {
        await client.query('ROLLBACK');
        return false;
      }
      await client.query(
        'UPDATE mcp_tokens SET revoked_at = now() WHERE player_id = $1 AND revoked_at IS NULL',
        [playerId],
      );
      await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
