// The roster check (0033). The helper's Postgres role (geldar_helper, migration 0038) may run one
// definer function and nothing else, so the only SQL here is that one call.

export interface RosterPort {
  /** The exact-case login name for a roster name under an owner, or null when the name is not on the roster. */
  displayName(owner: string, name: string): Promise<string | null>;
}

export interface QueryResult {
  rows: ReadonlyArray<{ name: string | null }>;
}

export type Query = (sql: string, values: readonly string[]) => Promise<QueryResult>;

export const DISPLAY_NAME_SQL = 'SELECT supervisor_player_display_name($1, $2) AS name';

export function rosterFromQuery(query: Query): RosterPort {
  return {
    async displayName(owner, name) {
      const result = await query(DISPLAY_NAME_SQL, [owner, name]);
      return result.rows[0]?.name ?? null;
    },
  };
}
