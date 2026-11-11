/** The shared CI database. The CI Postgres is named geldar, which is also the config default for POSTGRES_DB (config.ts). */
export const SHARED_DATABASE = 'geldar';

/** The opt-in for the shared CI database. The CI integration job sets it; a developer machine never does. */
export const SHARED_DB_OPT_IN = 'GELDAR_IT_ALLOW_SHARED_DB';

/** A scratch database made by a test helper (threshold/mcp/test/it/scratch-db.ts): geldar_it_ and lower-case hex. */
const SCRATCH_DATABASE = /^geldar_it_[0-9a-f]+$/;

/**
 * Throws unless `database` may be truncated. TRUNCATE clears every life's rows, so an integration
 * test that truncates must never run against a real database. This is an allowlist: a scratch
 * database (geldar_it_<hex>) is always allowed, and the shared CI database name is allowed only
 * when `sharedAllowed` is set. Every other name is refused: the dev database, a config default,
 * an empty name, and a name with a space or an upper-case letter.
 */
export function assertThrowawayDatabase(
  database: string,
  sharedAllowed = process.env[SHARED_DB_OPT_IN] === '1',
): void {
  const allowed =
    SCRATCH_DATABASE.test(database) || (database === SHARED_DATABASE && sharedAllowed);
  if (!allowed) {
    throw new Error(
      `refusing to TRUNCATE in database "${database}": run this test on a throwaway database only`,
    );
  }
}

/** Asserts the database the pool is connected to, before the test writes anything. */
export async function assertConnectedToThrowaway(
  pool: { query: (sql: string) => Promise<{ rows: { db: string }[] }> },
  sharedAllowed = process.env[SHARED_DB_OPT_IN] === '1',
): Promise<void> {
  const { rows } = await pool.query('SELECT current_database() AS db');
  assertThrowawayDatabase(rows[0]?.db ?? '', sharedAllowed);
}
