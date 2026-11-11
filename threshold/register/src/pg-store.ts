import pg from 'pg';
import type { MintRequest, NewPlayerRequest, OwnerRecord, PlayerRow, Store } from './store.ts';

export interface PgStoreOptions {
  readonly shard: string;
}

const hex = (h: string): Buffer => Buffer.from(h, 'hex');

/** The store over Postgres, connected as geldar_register (migrations 0008 to 0010). */
export class PgStore implements Store {
  private readonly pool: pg.Pool;
  private readonly options: PgStoreOptions;
  constructor(connectionString: string, options: PgStoreOptions) {
    this.pool = new pg.Pool({ connectionString, max: 4 });
    this.options = options;
  }

  async findOwner(identityHash: string): Promise<OwnerRecord | null> {
    // The role reads no table (0012): the owner of the named identity comes from a definer function.
    const r = await this.pool.query('SELECT owner_id, banned FROM register_find_owner($1)', [
      hex(identityHash),
    ]);
    const row = r.rows[0];
    return row ? { ownerId: String(row.owner_id), banned: row.banned === true } : null;
  }

  async createOwner(
    identity: { identityHash: string; provider: string; display: string },
    ownerId: string,
  ): Promise<void> {
    // One definer function writes the owner and its identity (0011); the role has no direct insert.
    await this.pool.query('SELECT register_create_owner($1, $2, $3, $4)', [
      hex(identity.identityHash),
      identity.provider,
      ownerId,
      identity.display,
    ]);
  }

  async setPublicCamera(identityHash: string, playerId: string, value: boolean): Promise<boolean> {
    const r = await this.pool.query('SELECT register_set_public_camera($1, $2, $3) AS ok', [
      hex(identityHash),
      playerId,
      value,
    ]);
    return r.rows[0]?.ok === true;
  }

  async setThoughtsDelayedPublic(
    identityHash: string,
    playerId: string,
    value: boolean,
  ): Promise<boolean> {
    const r = await this.pool.query(
      'SELECT register_set_thoughts_delayed_public($1, $2, $3) AS ok',
      [hex(identityHash), playerId, value],
    );
    return r.rows[0]?.ok === true;
  }

  async listPlayers(identityHash: string): Promise<PlayerRow[]> {
    const r = await this.pool.query(
      'SELECT player_id, display_name, harness, status FROM register_list_players($1)',
      [hex(identityHash)],
    );
    return r.rows.map((row) => ({
      playerId: String(row.player_id),
      name: String(row.display_name),
      harness: String(row.harness),
      status: String(row.status),
    }));
  }

  async createPlayer(q: NewPlayerRequest): Promise<'ok' | 'cap' | 'limit' | 'taken'> {
    try {
      // One definer function writes the life, the player, the budget and the token (0010).
      await this.pool.query('SELECT register_create_player($1, $2, $3, $4, $5, $6, $7, $8)', [
        hex(q.identityHash),
        q.playerId,
        q.lifeId,
        q.name,
        q.harness,
        this.options.shard,
        q.tokenId,
        q.tokenHash,
      ]);
      return 'ok';
    } catch (error) {
      const { code, message } = error as { code?: string; message?: string };
      // The cap trigger (0006) says "is at the cap"; any other check violation is a real error.
      if (code === '23514' && String(message).includes('is at the cap')) return 'cap';
      if (code === '54000') return 'limit';
      if (code === '23505') return 'taken';
      throw error;
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

  async retirePlayer(identityHash: string, playerId: string): Promise<boolean> {
    try {
      const r = await this.pool.query('SELECT register_retire_player($1, $2) AS ok', [
        hex(identityHash),
        playerId,
      ]);
      return r.rows[0]?.ok === true;
    } catch (error) {
      if ((error as { code?: string }).code === '42501') return false;
      throw error;
    }
  }
}
