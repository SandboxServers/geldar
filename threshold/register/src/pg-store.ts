import pg from 'pg';
import {
  SESSION_CAP_MS,
  SESSION_IDLE_MS,
  type SessionRow,
  type SessionStore,
} from './session-store.ts';
import type { MintRequest, NewPlayerRequest, OwnerRecord, PlayerRow, Store } from './store.ts';
import type { IssuedToken } from './tokens-service.ts';

export interface PgStoreOptions {
  readonly shard: string;
}

const hex = (h: string): Buffer => Buffer.from(h, 'hex');

/** The store over Postgres, connected as geldar_register (migrations 0008 to 0010). */
export class PgStore implements Store, SessionStore {
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
    if (!row) return null;
    // A tombstone (0039) has owner_id NULL. It is refused like a ban: never a session, and never the string 'null'.
    if (row.owner_id === null || row.owner_id === undefined) return { ownerId: '', banned: true };
    return { ownerId: String(row.owner_id), banned: row.banned === true };
  }

  async createOwner(
    identity: { identityHash: string; provider: string; display: string },
    ownerId: string,
    termsVersion: string,
    ownsJava?: boolean,
  ): Promise<void> {
    // One transaction (C7-08): the owner and identity (0011) and the consent row (0022) commit together
    // or not at all. The role has no direct insert on owners or identities.
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT register_create_owner($1, $2, $3, $4)', [
        hex(identity.identityHash),
        identity.provider,
        ownerId,
        identity.display,
      ]);
      await client.query(
        'INSERT INTO register_consents (identity_hash, terms_version) VALUES ($1, $2)',
        [hex(identity.identityHash), termsVersion],
      );
      // The Minecraft Java answer (0068) is written in this transaction too: a refused record rolls the owner back.
      if (ownsJava !== undefined) {
        const r = await client.query('SELECT register_mc_ownership_record($1, $2, NULL) AS ok', [
          hex(identity.identityHash),
          ownsJava,
        ]);
        if (r.rows[0]?.ok !== true) throw new Error('ownership record refused');
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
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
    // The two visibility flags come from the owner-keyed definer function (0036), read with the owner id.
    // register_list_players (0012) has no flags and no owner id, and this change adds no SQL.
    const flags = new Map<string, { publicCamera: boolean; thoughtsDelayedPublic: boolean }>();
    const owner = await this.findOwner(identityHash);
    if (owner !== null && !owner.banned) {
      const f = await this.pool.query(
        'SELECT player_id, public_camera, thoughts_delayed_public FROM register_owner_list_players($1)',
        [owner.ownerId],
      );
      for (const row of f.rows) {
        flags.set(String(row.player_id), {
          publicCamera: row.public_camera === true,
          thoughtsDelayedPublic: row.thoughts_delayed_public === true,
        });
      }
    }
    return r.rows.map((row) => {
      const playerId = String(row.player_id);
      const f = flags.get(playerId);
      return {
        playerId,
        name: String(row.display_name),
        harness: String(row.harness),
        status: String(row.status),
        publicCamera: f?.publicCamera ?? false,
        thoughtsDelayedPublic: f?.thoughtsDelayedPublic ?? false,
      };
    });
  }

  /** Sessions (C7-01): geldar_register reads and writes register_sessions directly (migration 0021). */
  async create(row: SessionRow): Promise<void> {
    await this.pool.query(
      'INSERT INTO register_sessions (session_hash, owner_id, identity_hash, signed_in_ms, last_seen_ms, expires_ms) VALUES ($1, $2, $3, $4, $5, $6)',
      [
        row.sessionHash,
        row.ownerId,
        hex(row.identityHash),
        row.signedInMs,
        row.lastSeenMs,
        row.expiresMs,
      ],
    );
  }

  async touch(sessionHash: Buffer, nowMs: number): Promise<SessionRow | null> {
    // One statement slides the expiry: 30 minutes on, never past the 12 hour cap. A row at or past its expiry matches nothing.
    const r = await this.pool.query(
      `UPDATE register_sessions
          SET last_seen_ms = $2, expires_ms = LEAST($2 + $3, signed_in_ms + $4)
        WHERE session_hash = $1 AND $2 < expires_ms
        RETURNING owner_id, identity_hash, signed_in_ms, last_seen_ms, expires_ms`,
      [sessionHash, nowMs, SESSION_IDLE_MS, SESSION_CAP_MS],
    );
    const row = r.rows[0];
    if (!row) return null;
    return {
      sessionHash,
      ownerId: String(row.owner_id),
      identityHash: (row.identity_hash as Buffer).toString('hex'),
      signedInMs: Number(row.signed_in_ms),
      lastSeenMs: Number(row.last_seen_ms),
      expiresMs: Number(row.expires_ms),
    };
  }

  async delete(sessionHash: Buffer): Promise<void> {
    await this.pool.query('DELETE FROM register_sessions WHERE session_hash = $1', [sessionHash]);
  }

  async sweep(nowMs: number): Promise<void> {
    await this.pool.query('DELETE FROM register_sessions WHERE expires_ms <= $1', [nowMs]);
  }

  async createPlayer(
    q: NewPlayerRequest,
  ): Promise<'ok' | 'cap' | 'limit' | 'taken' | 'name' | 'name_taken'> {
    // One transaction (ROSTER-AUTO): the agent (0010, 0012) and its roster row (0061) commit together or not
    // at all. A refused roster name rolls the agent back too, so no agent exists without its roster row.
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // One definer function writes the life, the player, the budget and the token (0010).
      await client.query('SELECT register_create_player($1, $2, $3, $4, $5, $6, $7, $8)', [
        hex(q.identityHash),
        q.playerId,
        q.lifeId,
        q.name,
        q.harness,
        this.options.shard,
        q.tokenId,
        q.tokenHash,
      ]);
      // The roster row (0061): the owner's name, lower-cased as the key, the display name as sent.
      await client.query('SELECT register_roster_add($1, $2)', [hex(q.identityHash), q.name]);
      await client.query('COMMIT');
      return 'ok';
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      const { code, message } = error as { code?: string; message?: string };
      const text = String(message);
      // The roster function names itself in its messages. Two owners racing for one new name: the second insert
      // fails on the mcp_roster key (the database's own message), so that key is the roster signal too. The agent's
      // own 23505 names the player key and stays a taken player id.
      if (text.includes('register_roster_add') || text.includes('mcp_roster_pkey')) {
        if (code === '22023') return 'name';
        if (code === '23505') return 'name_taken';
        throw error;
      }
      // The cap trigger (0006) says "is at the cap"; any other check violation is a real error.
      if (code === '23514' && text.includes('is at the cap')) return 'cap';
      if (code === '54000') return 'limit';
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

  async renewToken(
    identityHash: string,
    playerId: string,
    token: IssuedToken,
    graceUntil: Date,
  ): Promise<boolean> {
    try {
      await this.pool.query('SELECT register_renew_token($1, $2, $3, $4, $5)', [
        hex(identityHash),
        playerId,
        token.tokenId,
        token.tokenHash,
        graceUntil,
      ]);
      return true;
    } catch (error) {
      if ((error as { code?: string }).code === '42501') return false;
      throw error;
    }
  }

  async revokeTokens(identityHash: string, playerId: string): Promise<number | null> {
    try {
      const r = await this.pool.query('SELECT register_revoke_tokens($1, $2) AS n', [
        hex(identityHash),
        playerId,
      ]);
      return Number(r.rows[0]?.n ?? 0);
    } catch (error) {
      if ((error as { code?: string }).code === '42501') return null;
      throw error;
    }
  }

  async tokenInfo(
    identityHash: string,
    playerId: string,
  ): Promise<{ expiresAt: Date; lastUsedAt: Date | null } | null> {
    try {
      const r = await this.pool.query(
        'SELECT token_expires_at, token_last_used_at FROM register_token_info($1, $2)',
        [hex(identityHash), playerId],
      );
      const row = r.rows[0];
      if (!row) return null;
      return { expiresAt: row.token_expires_at, lastUsedAt: row.token_last_used_at ?? null };
    } catch (error) {
      if ((error as { code?: string }).code === '42501') return null;
      throw error;
    }
  }

  /**
   * Removes the account of the identity (register_account_delete, migration 0039). The bodies are stopped by the route
   * before this call. True when the account was removed; false when there was nothing to remove (a second delete).
   */
  async eraseAccount(identityHash: string): Promise<boolean> {
    const r = await this.pool.query('SELECT register_account_delete($1) AS ok', [
      hex(identityHash),
    ]);
    return r.rows[0]?.ok === true;
  }

  /**
   * The owner's players that the operator moved in: each live or retired player of the identity that has a
   * register_audit row 'player.set_owner' (written by the mcp-tokens player set-owner verb, one per move; the table is
   * append-only). Reads through register_list_players and the SELECT grant on register_audit (0025); no SQL is added.
   */
  async movedInPlayers(identityHash: string): Promise<{ readonly status: string }[]> {
    const r = await this.pool.query(
      `SELECT p.status FROM register_list_players($1) AS p
       WHERE EXISTS (SELECT 1 FROM register_audit a
                     WHERE a.action = 'player.set_owner' AND a.target = p.player_id)`,
      [hex(identityHash)],
    );
    return r.rows.map((row) => ({ status: String(row.status) }));
  }

  /**
   * The owner's data export (register_owner_export, migrations 0062 and 0065): the document as JSON text, or null when
   * the identity has no owner row. The text is cast in SQL, so the driver does not parse it and the route writes it as
   * it is. It runs on a dedicated client in one transaction with a 60 s statement_timeout (SET LOCAL), so a slow export
   * cannot hold the shared pool for sign-in and session touches for longer than that; the client is always released.
   */
  async exportOwnerData(identityHash: string): Promise<string | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL statement_timeout = '60s'");
      const r = await client.query('SELECT register_owner_export($1)::text AS export', [
        hex(identityHash),
      ]);
      await client.query('COMMIT');
      return r.rows[0]?.export ?? null;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
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
