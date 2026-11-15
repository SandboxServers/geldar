import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Pool, PoolClient } from 'pg';
import { scramVerifier } from './scram.ts';

/** The migration that a database created before the runner already has (decision D-P0-11). */
export const BASELINE_VERSION = '0001';

/** The advisory lock that keeps two runners from migrating the same database at once. */
const LOCK_KEY = 7201;

/** One file in sql/ whose name starts with a number, such as 0002_sovereign_mcp.sql. */
export interface MigrationFile {
  version: string;
  name: string;
  path: string;
}

/** What one run did, or would do with --dry-run. */
export interface MigrationReport {
  baselined: boolean;
  applied: string[];
}

/** The migration files in sql/, in name order. A name that starts with a digit must be `NNNN_name.sql`. */
export async function listMigrations(sqlDir: string): Promise<MigrationFile[]> {
  const names = (await readdir(sqlDir)).filter((name) => /^[0-9]/.test(name)).sort();
  const files: MigrationFile[] = names.map((name) => {
    const match = /^([0-9]{4})_[^/\\]+\.sql$/.exec(name);
    if (!match) throw new Error(`migration file name must be NNNN_name.sql: ${name}`);
    return { version: match[1] as string, name, path: join(sqlDir, name) };
  });
  const versions = new Set(files.map((file) => file.version));
  if (versions.size !== files.length) throw new Error('two migration files share a version');
  return files;
}

/**
 * The files still to apply. A database with `agents` but no `schema_migrations` predates the
 * runner: it is baselined at 0001, so only the later files run.
 */
export function pendingMigrations(
  files: readonly MigrationFile[],
  applied: ReadonlySet<string>,
): MigrationFile[] {
  return files.filter((file) => !applied.has(file.version));
}

/** True when the database predates the runner: it has the schema but no ledger. */
export function needsBaseline(hasLedger: boolean, hasAgents: boolean): boolean {
  return !hasLedger && hasAgents;
}

async function tableExists(client: PoolClient, name: string): Promise<boolean> {
  const result = await client.query<{ present: boolean }>(
    'SELECT to_regclass($1) IS NOT NULL AS present',
    [`public.${name}`],
  );
  return result.rows[0]?.present === true;
}

async function appliedVersions(client: PoolClient): Promise<Set<string>> {
  const result = await client.query<{ version: string }>('SELECT version FROM schema_migrations');
  return new Set(result.rows.map((row) => row.version));
}

const RECORD_SQL = 'INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT DO NOTHING';

/**
 * Applies the pending migrations, one transaction each, in name order, and records each in
 * schema_migrations. With dryRun it changes nothing and reports what it would apply.
 */
export async function migrate(
  pool: Pool,
  options: { sqlDir: string; dryRun: boolean; log: (line: string) => void },
): Promise<MigrationReport> {
  const files = await listMigrations(options.sqlDir);
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
    const hasLedger = await tableExists(client, 'schema_migrations');
    const hasAgents = await tableExists(client, 'agents');
    const baselined = needsBaseline(hasLedger, hasAgents);
    const applied = hasLedger ? await appliedVersions(client) : new Set<string>();
    if (baselined) applied.add(BASELINE_VERSION);
    const pending = pendingMigrations(files, applied);

    if (options.dryRun) {
      if (baselined) options.log(`baseline: ${BASELINE_VERSION} (schema exists, no ledger)`);
      for (const file of pending) options.log(`would apply ${file.name}`);
      if (pending.length === 0) options.log('nothing to apply');
      return { baselined, applied: pending.map((file) => file.version) };
    }

    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
    if (baselined) {
      await client.query(RECORD_SQL, [BASELINE_VERSION]);
      options.log(`baseline: recorded ${BASELINE_VERSION}`);
    }
    for (const file of pending) {
      const sql = await readFile(file.path, 'utf8');
      await applyOne(client, file, sql);
      options.log(`applied ${file.name}`);
    }
    if (pending.length === 0) options.log('nothing to apply');
    return { baselined, applied: pending.map((file) => file.version) };
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => undefined);
    client.release();
  }
}

async function applyOne(client: PoolClient, file: MigrationFile, sql: string): Promise<void> {
  await client.query('BEGIN');
  try {
    await client.query(sql);
    await client.query(RECORD_SQL, [file.version]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw new Error(`migration ${file.name} failed and was rolled back: ${errorText(error)}`);
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The only roles this tool sets a password for: the MCP's login (decision 0026), the Glass's
 * read-only login (wave 6 item 10, migration 0005), the register service, and the body helper and
 * supervisor logins (C7-03c2). Any other role is refused before connecting.
 */
const PASSWORD_ROLES: ReadonlySet<string> = new Set([
  'geldar_mcp',
  'geldar_glass',
  'geldar_register',
  'geldar_helper',
  'geldar_supervisor',
]);

/**
 * Reads a password file as UTF-8, without a leading byte-order mark and one trailing newline.
 * Windows editors add the mark; Postgres would take it as part of the password. A password that
 * starts or ends with whitespace is refused: the MCP server trims its password file, so such a
 * password would authenticate differently there.
 */
export async function readPasswordFile(path: string): Promise<string> {
  const text = (await readFile(path, 'utf8')).replace(/^\uFEFF/, '').replace(/\r?\n$/, '');
  if (/^\s|\s$/.test(text)) {
    throw new Error(
      'the password must not start or end with whitespace: remove the extra spaces or tabs from the password file',
    );
  }
  return text;
}

/**
 * The statement that sets a role's login password to a SCRAM verifier. The CLI's allowlist sits
 * in setRolePassword; the integration test uses this builder for a throwaway role.
 */
export function passwordStatement(
  role: string,
  verifier: string,
  escapeLiteral: (value: string) => string,
): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(role)) throw new Error(`not a plain role name: ${role}`);
  return `ALTER ROLE ${role} WITH LOGIN PASSWORD ${escapeLiteral(verifier)}`;
}

/** The part of a pg Client that the login probe uses. */
export interface ProbeClient {
  connect(): Promise<unknown>;
  end(): Promise<unknown>;
}

/** SQLSTATE codes that mean the server refused the login: a wrong password (28P01) or no pg_hba entry (28000). */
const LOGIN_REFUSED: ReadonlySet<string> = new Set(['28P01', '28000']);

/**
 * Login-first probe (C7-03c2): true when `role` logs in with `password` through `makeClient`.
 * False only for a refused login (LOGIN_REFUSED). Any other failure, such as a refused connection
 * or a timeout, is rethrown: the caller must not run ALTER ROLE on a database it could not reach.
 */
export async function probeLogin(
  makeClient: (config: {
    user: string;
    password: string;
    connectionTimeoutMillis: number;
  }) => ProbeClient,
  role: string,
  password: string,
): Promise<boolean> {
  const probe = makeClient({ user: role, password, connectionTimeoutMillis: 5000 });
  try {
    await probe.connect();
    return true;
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
    if (typeof code === 'string' && LOGIN_REFUSED.has(code)) return false;
    throw error;
  } finally {
    await probe.end().catch(() => undefined);
  }
}

/**
 * The database the login probe reaches (C7-03c2): PGDATABASE, the same one the migrate verb's pool uses.
 * Throws when it is unset or empty, before any connection is made.
 */
export function probeDatabase(env: Readonly<Record<string, string | undefined>>): string {
  const database = env.PGDATABASE;
  if (database === undefined || database === '') {
    throw new Error(
      '--set-role-password needs PGDATABASE: the login probe must reach the database the migrate verb uses',
    );
  }
  return database;
}

/**
 * The loginWorks check for setRolePassword (C7-03c2): the probe client is built with `database`, so the
 * probe reaches the same database as the pool.
 */
export function loginProbeOn(
  database: string,
  makeClient: (config: {
    user: string;
    password: string;
    connectionTimeoutMillis: number;
    database: string;
  }) => ProbeClient,
): (role: string, password: string) => Promise<boolean> {
  return (role, password) =>
    probeLogin((config) => makeClient({ ...config, database }), role, password);
}

/**
 * The loginWorks check the cli passes to setRolePassword (C7-03c2): PGDATABASE is read by probeDatabase, so an unset
 * PGDATABASE throws here, before makeClient is called and before any connection.
 */
export function loginProbeFromEnv(
  env: Readonly<Record<string, string | undefined>>,
  makeClient: (config: {
    user: string;
    password: string;
    connectionTimeoutMillis: number;
    database: string;
  }) => ProbeClient,
): (role: string, password: string) => Promise<boolean> {
  return loginProbeOn(probeDatabase(env), makeClient);
}

/**
 * Sets the password of a role in PASSWORD_ROLES and lets it log in. The client computes a
 * SCRAM-SHA-256 verifier and sends only that: the plaintext never reaches the server or the log.
 * With dryRun
 * it checks the password and reports, and connects to nothing.
 */
export async function setRolePassword(
  pool: Pool,
  role: string,
  password: string,
  options: {
    dryRun: boolean;
    log: (line: string) => void;
    /** Login-first probe (C7-03c2): true when the role already logs in with this password. */
    loginWorks?: (role: string, password: string) => Promise<boolean>;
  },
): Promise<void> {
  if (!PASSWORD_ROLES.has(role)) {
    throw new Error(`only ${[...PASSWORD_ROLES].join(' or ')} takes a password here`);
  }
  if (password.length === 0) throw new Error('the password file is empty');
  const verifier = scramVerifier(password);
  if (options.dryRun) {
    options.log(`dry run: the password of ${role} would be set; nothing was run`);
    return;
  }
  if (options.loginWorks !== undefined && (await options.loginWorks(role, password))) {
    options.log(
      `password already set for role ${role}: the file's password logs in; nothing changed`,
    );
    return;
  }
  const client = await pool.connect();
  try {
    const sql = passwordStatement(role, verifier, (value) => client.escapeLiteral(value));
    await client.query(sql);
    options.log(`password set for role ${role}`);
  } finally {
    client.release();
  }
}
