/** The dev database name, which is also the config default for POSTGRES_DB (config.ts). */
export const DEV_DATABASE = 'geldar';

/** The opt-in env var that allows the shared CI database (named geldar). Never set on a dev machine. */
export const SHARED_DB_OPT_IN = 'GELDAR_IT_ALLOW_SHARED_DB';

/**
 * Throws unless `database` is a throwaway database. TRUNCATE clears every life's rows, so an
 * integration test that truncates must never run against the dev database or its config default.
 * The one exception is the disposable CI Postgres, whose database is named geldar: the CI
 * integration job sets GELDAR_IT_ALLOW_SHARED_DB=1 and only then are those names allowed. A
 * developer machine never sets it, so the dev database stays refused there. An empty name is
 * always refused.
 */
export function assertThrowawayDatabase(
  database: string,
  devDatabase = DEV_DATABASE,
  sharedAllowed = process.env[SHARED_DB_OPT_IN] === '1',
): void {
  const isDevName = database === DEV_DATABASE || database === devDatabase;
  if (database === '' || (isDevName && !sharedAllowed)) {
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
  assertThrowawayDatabase(rows[0]?.db ?? '', DEV_DATABASE, sharedAllowed);
}
