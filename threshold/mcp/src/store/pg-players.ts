import type { Pool } from 'pg';
import type { PlayerDirectory, PlayerRecord } from '../ports.ts';

interface PlayerRow {
  player_id: string;
  life_id: string;
  owner_id: string;
  display_name: string;
  harness: string;
  status: 'active' | 'paused' | 'retired';
}

const FIND_SQL = `SELECT player_id, life_id, owner_id, display_name, harness, status
FROM mcp_players WHERE player_id = $1`;

/** Sovereign players from `mcp_players`, looked up by launcher id. */
export class PgPlayerDirectory implements PlayerDirectory {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async find(playerId: string): Promise<PlayerRecord | null> {
    const { rows } = await this.pool.query<PlayerRow>(FIND_SQL, [playerId]);
    const row = rows[0];
    if (row === undefined) return null;
    return {
      playerId: row.player_id,
      lifeId: row.life_id,
      ownerId: row.owner_id,
      displayName: row.display_name,
      harness: row.harness,
      status: row.status,
    };
  }
}
