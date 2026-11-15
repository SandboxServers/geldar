// The roster check (0033) and the managed life id (0063). The helper's Postgres role (geldar_helper,
// migration 0038) may run two definer functions and nothing else, so the only SQL here is those calls.

export interface RosterPort {
  /** The exact-case login name for a roster name under an owner, or null when the name is not on the roster. */
  displayName(owner: string, name: string): Promise<string | null>;
}

/**
 * The roster port with the managed life id. rosterFromQuery returns this type, so the existing RosterPort
 * fakes in other test files keep compiling without a change (BH-1 deviation, see the report).
 */
export interface RosterLifePort extends RosterPort {
  /**
   * The managed life id for a roster name under an owner, or null when the name is not on the roster or the
   * id is not of the form ag_ plus 1 to 12 lower-case letters or digits. The helper never computes the id.
   */
  lifeId(owner: string, name: string): Promise<string | null>;
}

export interface QueryResult {
  rows: ReadonlyArray<{ name?: string | null; id?: string | null }>;
}

export type Query = (sql: string, values: readonly string[]) => Promise<QueryResult>;

export const DISPLAY_NAME_SQL = 'SELECT supervisor_player_display_name($1, $2) AS name';
export const LIFE_ID_SQL = 'SELECT supervisor_player_life_id($1, $2) AS id';

/** The helper's own check on an id from SQL, stricter than the house regex (no underscore in the id part). */
export const LIFE_ID_PATTERN = /^ag_[a-z0-9]{1,12}$/;

export function rosterFromQuery(query: Query): RosterLifePort {
  return {
    async displayName(owner, name) {
      const result = await query(DISPLAY_NAME_SQL, [owner, name]);
      return result.rows[0]?.name ?? null;
    },
    async lifeId(owner, name) {
      const result = await query(LIFE_ID_SQL, [owner, name]);
      const id = result.rows[0]?.id ?? null;
      if (id === null || !LIFE_ID_PATTERN.test(id)) return null;
      return id;
    },
  };
}
