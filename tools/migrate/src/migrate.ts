import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Pool, PoolClient } from 'pg';

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
    `SELECT EXISTS (SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = $1) AS present`,
    [name],
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
 * Sets the password of a role and lets it log in. The value is escaped with the driver's
 * escapeLiteral (ALTER ROLE takes no parameters) and is never logged.
 */
export async function setRolePassword(
  pool: Pool,
  role: string,
  password: string,
  log: (line: string) => void,
): Promise<void> {
  if (!/^[a-z_][a-z0-9_]*$/.test(role)) throw new Error(`role name is not allowed: ${role}`);
  if (password.length === 0) throw new Error('the password file is empty');
  const client = await pool.connect();
  try {
    const sql = `ALTER ROLE ${role} WITH LOGIN PASSWORD ${client.escapeLiteral(password)}`;
    await client.query(sql);
    log(`password set for role ${role}`);
  } finally {
    client.release();
  }
}
