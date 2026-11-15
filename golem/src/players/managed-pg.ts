/**
 * The only module of golem/src that imports `pg` (BODY-HOST design, decisions 0260 and 0261): the
 * database port of the managed player host. It connects as the narrow role `geldar_body_host`, which
 * holds EXECUTE on one function, `player_host_config(life_id)`, and no table grants. It imports
 * nothing from RCON or the whitelist: the managed host has no RCON path, and the import-graph test in
 * managed-main.test.ts walks from managed-main.ts through this file to prove it.
 */
import pg from 'pg';

/** The connection options of the host database: the role is the narrow one from the environment. */
export interface HostDbOptions {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

/** The database port of the host: one query, `player_host_config(life_id)`, and a close. */
export interface HostDb {
  /** The JSON row of the life, or null when the function answers NULL. */
  hostConfig(lifeId: string): Promise<unknown>;
  close(): Promise<void>;
}

/** The longest a read, a statement or the close of the host database may take (no stall at boot). */
const DB_TIMEOUT_MS = 5_000;

/**
 * Closes the client, or gives up after DB_TIMEOUT_MS. The client's own error text is never read or
 * logged: it can carry a connection string.
 */
function endClient(client: pg.Client): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, DB_TIMEOUT_MS);
  });
  return Promise.race([client.end().then(() => undefined), timeout]).finally(() =>
    clearTimeout(timer),
  );
}

/**
 * The pg adapter of HostDb: a single client, with no pool, opened for one read. The client has
 * timeouts on the connect, the query and the statement, and a no-op 'error' listener, so an idle
 * socket the server drops cannot crash the process as an unhandled event.
 */
export async function openPgHostDb(options: HostDbOptions): Promise<HostDb> {
  const client = new pg.Client({
    host: options.host,
    port: options.port,
    database: options.database,
    user: options.user,
    password: options.password,
    connectionTimeoutMillis: DB_TIMEOUT_MS,
    query_timeout: DB_TIMEOUT_MS,
    statement_timeout: DB_TIMEOUT_MS,
  });
  client.on('error', () => undefined);
  await client.connect();
  return {
    async hostConfig(lifeId) {
      const result = await client.query('SELECT player_host_config($1) AS cfg', [lifeId]);
      return result.rows[0]?.cfg ?? null;
    },
    close: () => endClient(client),
  };
}
