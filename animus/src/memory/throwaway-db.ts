/** The dev database name, which is also the config default for POSTGRES_DB (config.ts). */
export const DEV_DATABASE = 'geldar';

/**
 * Throws unless `database` is a throwaway database. TRUNCATE clears every life's rows, so an
 * integration test that truncates must never run against the dev database or its config default.
 */
export function assertThrowawayDatabase(database: string, devDatabase = DEV_DATABASE): void {
  if (database === '' || database === DEV_DATABASE || database === devDatabase) {
    throw new Error(
      `refusing to TRUNCATE in database "${database}": run this test on a throwaway database only`,
    );
  }
}

/** Asserts the database the pool is connected to, before the test writes anything. */
export async function assertConnectedToThrowaway(pool: {
  query: (sql: string) => Promise<{ rows: { db: string }[] }>;
}): Promise<void> {
  const { rows } = await pool.query('SELECT current_database() AS db');
  assertThrowawayDatabase(rows[0]?.db ?? '');
}
