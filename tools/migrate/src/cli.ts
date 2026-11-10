#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { migrate, setRolePassword } from './migrate.ts';

const USAGE = `usage: node tools/migrate/src/cli.ts [--dry-run] [--sql-dir <dir>]
       node tools/migrate/src/cli.ts --set-role-password geldar_mcp --password-file <file>

Connects with the standard PG* variables (PGHOST, PGPORT, PGUSER, PGDATABASE, PGPASSWORD).
Applies the sql/NNNN_*.sql files that are not yet recorded in schema_migrations.`;

const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_SQL_DIR = resolve(here, '..', '..', '..', 'sql');
const VALUE_FLAGS = new Set(['--sql-dir', '--set-role-password', '--password-file']);

interface Options {
  dryRun: boolean;
  sqlDir: string;
  role?: string;
  passwordFile?: string;
}

function parseArgs(argv: readonly string[]): Options {
  const options: Options = { dryRun: false, sqlDir: DEFAULT_SQL_DIR };
  const queue = [...argv];
  while (queue.length > 0) {
    const arg = queue.shift() as string;
    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (!VALUE_FLAGS.has(arg)) throw new Error(`unknown argument: ${arg}\n${USAGE}`);
    const value = queue.shift();
    if (value === undefined || value.startsWith('--')) throw new Error(`${arg} needs a value`);
    if (arg === '--sql-dir') options.sqlDir = resolve(value);
    else if (arg === '--set-role-password') options.role = value;
    else options.passwordFile = resolve(value);
  }
  if (options.role !== undefined && options.passwordFile === undefined) {
    throw new Error('--set-role-password needs --password-file');
  }
  if (options.role === undefined && options.passwordFile !== undefined) {
    throw new Error('--password-file needs --set-role-password');
  }
  return options;
}

async function main(argv: readonly string[]): Promise<void> {
  const options = parseArgs(argv);
  const log = (line: string): void => console.log(line);
  const pool = new Pool();
  try {
    if (options.role !== undefined && options.passwordFile !== undefined) {
      // The file holds the password only; its trailing newline is not part of it.
      const password = (await readFile(options.passwordFile, 'utf8')).replace(/\r?\n$/, '');
      await setRolePassword(pool, options.role, password, log);
      return;
    }
    await migrate(pool, { sqlDir: options.sqlDir, dryRun: options.dryRun, log });
  } finally {
    await pool.end();
  }
}

// Only the command line runs the tool; tests import the functions above.
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
