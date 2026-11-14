import type { FlagQuery } from './admin.ts';

/** SQLSTATE the owner-id definer functions raise for a banned or unknown owner (migration 0036). */
const REFUSED_STATE = '42501';

/**
 * The owner refused the read (a banned owner, C7-04b-5). It is thrown instead of an empty list or a null
 * player, so a refusal never reads as "no agents" or as a missing player.
 */
export class OwnerRefusedError extends Error {
  constructor() {
    super('owner refused');
    this.name = 'OwnerRefusedError';
  }
}

export interface OwnerAgentLoaders {
  /** The owner's agents, each stamped with the owner id the definer function was asked for. */
  readonly listAgents: (ownerId: string) => Promise<Record<string, unknown>[]>;
  /** One of the owner's agents, or null when the player is unknown or belongs to another owner. */
  readonly agents: (ownerId: string, playerId: string) => Promise<Record<string, unknown> | null>;
}

function sqlState(err: unknown): string | undefined {
  if (typeof err !== 'object' || err === null || !('code' in err)) return undefined;
  return String(err.code);
}

async function readRows(
  db: FlagQuery,
  text: string,
  values: unknown[],
): Promise<Record<string, unknown>[]> {
  try {
    return (await db.query(text, values)).rows;
  } catch (err) {
    if (sqlState(err) === REFUSED_STATE) throw new OwnerRefusedError();
    throw err;
  }
}

/** The account-view agent: the body and credits are not database facts here, so the view leaves them unset. */
function agentOf(ownerId: string, row: Record<string, unknown>): Record<string, unknown> {
  return {
    playerId: row.player_id,
    ownerId,
    displayName: row.display_name,
    status: row.status,
    publicCamera: row.public_camera === true,
    thoughtsDelayedPublic: row.thoughts_delayed_public === true,
  };
}

/** The agent loaders of the owner API, over the migration 0036 definer functions (owner id, read only). */
export function ownerAgentLoaders(db: FlagQuery): OwnerAgentLoaders {
  return {
    listAgents: async (ownerId) => {
      const rows = await readRows(db, 'SELECT * FROM register_owner_list_players($1)', [ownerId]);
      return rows.map((row) => agentOf(ownerId, row));
    },
    agents: async (ownerId, playerId) => {
      const rows = await readRows(db, 'SELECT * FROM register_owner_get_player($1, $2)', [
        ownerId,
        playerId,
      ]);
      const row = rows[0];
      return row === undefined ? null : agentOf(ownerId, row);
    },
  };
}
