import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

const SQL_TIMEOUT = '5s';

/** The rows a SQL client returns. The glass client and the test fake both fit this. */
export interface SqlClient {
  query(text: string, params: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  close?(): Promise<void>;
}

/** Runs the reads inside one READ ONLY transaction with the statement timeout; rolls back on any error. */
export async function readOnly<T>(client: SqlClient, fn: (q: SqlClient) => Promise<T>): Promise<T> {
  await client.query('BEGIN READ ONLY', []);
  try {
    await client.query(`SET LOCAL statement_timeout = '${SQL_TIMEOUT}'`, []);
    const out = await fn(client);
    await client.query('COMMIT', []);
    return out;
  } catch (err) {
    await client.query('ROLLBACK', []).catch(() => undefined);
    throw err;
  }
}

/**
 * The glass reader: the geldar_glass role, the password read from a file here and never logged. The connection is
 * opened on the first query, dropped on any error (the next query reconnects) and closed by `close`.
 */
export function createGlassClient(env: Record<string, string | undefined>): SqlClient {
  const passwordFile =
    env.GELDAR_GLASS_PG_PASSWORD_FILE ?? join('compose', 'secrets', 'postgres-glass.txt');
  let client: pg.Client | null = null;
  const drop = (c: pg.Client): void => {
    if (client === c) client = null;
    c.end().catch(() => undefined);
  };
  const open = async (): Promise<pg.Client> => {
    const next = new pg.Client({
      host: '127.0.0.1',
      port: Number(env.GELDAR_GLASS_PG_PORT ?? 5432),
      user: 'geldar_glass',
      database: env.GELDAR_GLASS_PG_DB ?? 'geldar',
      password: readFileSync(passwordFile, 'utf8').trim(),
      connectionTimeoutMillis: 10_000,
    });
    // A dropped connection (a Postgres restart) is an 'error' event, not a crash: the next query reconnects.
    next.on('error', () => drop(next));
    try {
      await next.connect();
    } catch (err) {
      drop(next);
      throw err;
    }
    return next;
  };
  return {
    async query(text, params) {
      if (client === null) client = await open();
      const current = client;
      try {
        const res = await current.query(text, params);
        return { rows: res.rows as Record<string, unknown>[] };
      } catch (err) {
        drop(current);
        throw err;
      }
    },
    async close() {
      const current = client;
      client = null;
      if (current !== null) await current.end();
    },
  };
}
