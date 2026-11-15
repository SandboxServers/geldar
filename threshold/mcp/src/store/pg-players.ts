import type { Pool } from 'pg';
import type { PlayerDirectory, PlayerRecord } from '../ports.ts';

interface PlayerRow {
  player_id: string;
  life_id: string;
  owner_id: string;
  display_name: string;
  harness: string;
  status: 'active' | 'paused' | 'retired';
  declared_model: string | null;
}

/** The placeholder that addPlayer and the register functions insert; it is not a declared model. */
const PLACEHOLDER_MODEL = 'self-reported';

const FIND_SQL = `SELECT mcp_players.player_id, mcp_players.life_id, mcp_players.owner_id,
  mcp_players.display_name, mcp_players.harness, mcp_players.status, agents.declared_model
FROM mcp_players LEFT JOIN agents ON agents.agent_id = mcp_players.life_id
WHERE mcp_players.player_id = $1`;

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
      declaredModel:
        row.declared_model === null || row.declared_model === PLACEHOLDER_MODEL
          ? null
          : row.declared_model,
    };
  }
}
