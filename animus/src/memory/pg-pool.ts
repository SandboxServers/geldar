import pg from 'pg';
import { type AnimusConfig, readPostgresPassword } from '../config.ts';

/** The result of one statement. */
export interface SqlResult {
  // biome-ignore lint/suspicious/noExplicitAny: pg rows are untyped; every row is mapped below.
  rows: any[];
  rowCount: number | null;
}

/** A connection that runs one parameterised statement. */
export interface SqlClient {
  query(sql: string, params?: unknown[]): Promise<SqlResult>;
}

/** What the stores need of a `pg` pool: statements, and a connection for a transaction. */
export interface PgPool extends SqlClient {
  connect(): Promise<SqlClient & { release(): void }>;
}

/** The pool's settings: every wait is bounded, so a stuck Postgres cannot hang the Mind. */
export function poolConfig(config: AnimusConfig, password: string): pg.PoolConfig {
  return {
    host: config.postgres.host,
    port: config.postgres.port,
    user: config.postgres.user,
    database: config.postgres.database,
    password,
    max: 4,
    connectionTimeoutMillis: 10_000,
    query_timeout: 30_000,
    statement_timeout: 30_000,
    idleTimeoutMillis: 60_000,
  };
}

/** Opens a pool to the Postgres of the config; the password is read from its secret file. */
export async function openPool(config: AnimusConfig): Promise<pg.Pool> {
  const pool = new pg.Pool(poolConfig(config, await readPostgresPassword(config)));
  // An idle client dropping (a Postgres restart) must not crash the Mind; the next query reconnects.
  pool.on('error', (error) => console.error('animus: idle postgres client error', error));
  return pool;
}

/** Runs `work` in one transaction: it commits when `work` returns and rolls back when it throws. */
export async function inTransaction<T>(
  pool: PgPool,
  work: (client: SqlClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
