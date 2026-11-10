/**
 * Scratch databases for the Wave M integration cases. Each run creates its own database with a
 * random name, migrates it with the repo's runner and drops it at the end, so no case depends on
 * another case or on the state of the dev database. The cases are gated by integrationEnabled().
 *
 * Connection: POSTGRES_HOST and POSTGRES_PORT (the names threshold/mcp/src/config.ts reads), the
 * geldar admin login and its password from compose/secrets/postgres.txt (the file eventsink's
 * integration test reads). The geldar_mcp role is reached with `SET ROLE` on the admin connection,
 * so no geldar_mcp password is read or changed; the role is cluster-wide and must not be altered.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Pool, type PoolConfig } from 'pg';
import { migrate } from '../../../../tools/migrate/src/migrate.ts';

export const SQL_DIR = fileURLToPath(new URL('../../../../sql', import.meta.url));

/** The connection settings for one database, read from the environment and the secret file. */
export function adminConfig(database: string): PoolConfig {
  return {
    host: process.env.POSTGRES_HOST ?? '127.0.0.1',
    port: Number(process.env.POSTGRES_PORT ?? 5432),
    user: 'geldar',
    password: readFileSync(
      new URL('../../../../compose/secrets/postgres.txt', import.meta.url),
      'utf8',
    ).trim(),
    database,
  };
}

/** A pool on one database; with `role`, every connection starts as that role (SET ROLE). */
export function scratchPool(database: string, role?: string): Pool {
  const options = role === undefined ? {} : { options: `-c role=${role}` };
  return new Pool({ ...adminConfig(database), max: 10, ...options });
}

/** A short random id: lower-case hex, safe in an identifier and in an id regex. */
export function freshSuffix(): string {
  return randomBytes(5).toString('hex');
}

/** Creates an empty database with a random name. The name is generated here, never from input. */
export async function createScratchDatabase(): Promise<string> {
  const name = `geldar_it_${randomBytes(6).toString('hex')}`;
  const admin = new Pool({ ...adminConfig('postgres'), max: 1 });
  try {
    await admin.query(`CREATE DATABASE ${name}`);
  } finally {
    await admin.end();
  }
  return name;
}

/** Drops a scratch database and any connection still open to it. */
export async function dropScratchDatabase(name: string): Promise<void> {
  const admin = new Pool({ ...adminConfig('postgres'), max: 1 });
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  } finally {
    await admin.end();
  }
}

/** Runs the repo's migration runner against a database; returns what it applied. */
export async function migrateScratch(pool: Pool): Promise<string[]> {
  const report = await migrate(pool, { sqlDir: SQL_DIR, dryRun: false, log: () => undefined });
  return report.applied;
}

export interface SeededPlayer {
  ownerId: string;
  playerId: string;
  lifeId: string;
}

/**
 * One owner, one sovereign player with its life and a full budget. Every id carries `suffix`, so
 * the rows of one case never collide with another case's rows.
 */
export async function seedPlayer(
  pool: Pool,
  suffix: string,
  options: { status?: string; harness?: string } = {},
): Promise<SeededPlayer> {
  const ownerId = `it-own-${suffix}`;
  const playerId = `ag-it-${suffix}`;
  const lifeId = `ag_it_${suffix}`;
  const harness = options.harness ?? 'it-on';
  await pool.query('INSERT INTO mcp_owners (owner_id, display, player_cap) VALUES ($1, $1, 3)', [
    ownerId,
  ]);
  await pool.query(
    `INSERT INTO agents (agent_id, name, life_seq, game_account, shard, mode, owner, harness,
       declared_model, model_config, tier, personality_seed)
     VALUES ($1, 'It', 1, $1, 'phaseit', 'sovereign', $2, $3, 'self-reported',
       'declared:unverified', 'sovereign', NULL)`,
    [lifeId, ownerId, harness],
  );
  await pool.query(
    `INSERT INTO mcp_players (player_id, owner_id, life_id, display_name, harness, status)
     VALUES ($1, $2, $3, 'It', $4, $5)`,
    [playerId, ownerId, lifeId, harness, options.status ?? 'active'],
  );
  await pool.query(
    'INSERT INTO mcp_budget (life_id, credits, accrued_at) VALUES ($1, 240, now())',
    [lifeId],
  );
  return { ownerId, playerId, lifeId };
}

/** One token row. `expiresIn` is a Postgres interval ('1 day', '-1 minute'); `revoked` sets revoked_at. */
export async function insertToken(
  pool: Pool,
  playerId: string,
  hash: Buffer,
  expiresIn: string,
  revoked = false,
): Promise<string> {
  const tokenId = `tk_it_${freshSuffix()}`;
  await pool.query(
    `INSERT INTO mcp_tokens (token_id, player_id, token_hash, expires_at, revoked_at)
     VALUES ($1, $2, $3, now() + $4::interval, CASE WHEN $5 THEN now() ELSE NULL END)`,
    [tokenId, playerId, hash, expiresIn, revoked],
  );
  return tokenId;
}
