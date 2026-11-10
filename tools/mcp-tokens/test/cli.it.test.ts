/**
 * WM-09 integration: the mcp-tokens CLI against a real Postgres, and the MCP server's token store
 * resolving what the CLI wrote. Skipped unless GELDAR_IT=1 (integrationEnabled). One scratch
 * database serves the file; every case seeds its own player (a random suffix) and mints its own
 * tokens, so no case depends on another. afterAll drops the database and the temp directory even
 * when a case or the setup failed.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client, type Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PgTokenStore } from '../../../threshold/mcp/src/store/pg-tokens.ts';
import { hashToken } from '../../../threshold/mcp/src/store/token-hash.ts';
import { integrationEnabled } from '../../../threshold/mcp/test/live/gate.ts';
import {
  adminConfig,
  createScratchDatabase,
  dropScratchDatabase,
  freshSuffix,
  migrateScratch,
  scratchPool,
  seedPlayer,
} from '../../../threshold/mcp/test/it/scratch-db.ts';
import { type Env, type Io, run, type SqlSession } from '../src/cli.ts';
import { initSecretFiles, readPepper } from '../src/secret-files.ts';

/** The shape of a token value: the prefix and 64 lower-case hex digits (TOKEN_PATTERN). */
const VALUE_IN_FILE = /^GELDAR_MCP_TOKEN=(gmcp-[0-9a-f]{64})\n$/;

describe.skipIf(!integrationEnabled())('the mcp-tokens CLI against a real Postgres', () => {
  let database = '';
  let pool: Pool | undefined;
  let workDir = '';
  let secretDir = '';
  let pepper = '';
  let env: Env;

  /** A database session on the scratch database as the admin login, like the CLI's own connection. */
  async function connect(): Promise<SqlSession> {
    const client = new Client(adminConfig(database));
    await client.connect();
    return {
      query: (text, values) => client.query(text, values),
      end: () => client.end(),
    };
  }

  /** Runs one CLI command and returns its exit code with the lines it wrote. */
  async function cli(argv: string[]): Promise<{ code: number; lines: string[] }> {
    const lines: string[] = [];
    const io: Io = { out: (line) => lines.push(line), err: (line) => lines.push(line) };
    const code = await run(argv, io, env);
    return { code, lines };
  }

  /** Mints a token for a player through the CLI; returns the token id, the value from the file, and the CLI output. */
  async function mint(playerId: string, label: string) {
    const out = join(workDir, `${label}.env`);
    const result = await cli(['token', 'mint', playerId, '--out', out]);
    expect(result.code, result.lines.join('\n')).toBe(0);
    const match = VALUE_IN_FILE.exec(await readFile(out, 'utf8'));
    expect(match, 'the token file holds one GELDAR_MCP_TOKEN line').not.toBeNull();
    const tokenId = /^minted (tk_[0-9a-f]+) for /.exec(result.lines[0] ?? '')?.[1];
    expect(tokenId, 'the mint line names the token id').toBeDefined();
    return {
      tokenId: tokenId as string,
      value: (match as RegExpExecArray)[1] as string,
      lines: result.lines,
    };
  }

  /** Whether the MCP server's token store resolves a token value, as the geldar_mcp role. */
  async function resolves(value: string): Promise<boolean> {
    const mcp = scratchPool(database, 'geldar_mcp');
    try {
      const store = new PgTokenStore(
        mcp,
        { 'it-on': true },
        { ...adminConfig(database), options: '-c role=geldar_mcp' },
      );
      return (await store.resolve(hashToken(pepper, value), Date.now())) !== null;
    } finally {
      await mcp.end();
    }
  }

  /** The admin pool on the scratch database; it exists once beforeAll has run. */
  function db(): Pool {
    if (pool === undefined) throw new Error('the scratch database is not set up');
    return pool;
  }

  beforeAll(async () => {
    database = await createScratchDatabase();
    pool = scratchPool(database);
    await migrateScratch(pool);
    workDir = await mkdtemp(join(tmpdir(), 'geldar-it-mcp-tokens-'));
    secretDir = join(workDir, 'secrets');
    await initSecretFiles(secretDir, { force: false });
    pepper = await readPepper(secretDir);
    env = { secretDir, shardFile: '', connect };
  });

  afterAll(async () => {
    await pool?.end();
    if (workDir !== '') await rm(workDir, { recursive: true, force: true });
    if (database !== '') await dropScratchDatabase(database);
  });

  it('a minted token resolves', async () => {
    const seeded = await seedPlayer(db(), freshSuffix());
    const minted = await mint(seeded.playerId, 'mint-resolve');
    expect(await resolves(minted.value)).toBe(true);
  });

  it('a revoked token does not resolve', async () => {
    const seeded = await seedPlayer(db(), freshSuffix());
    const minted = await mint(seeded.playerId, 'revoke');
    expect(await resolves(minted.value)).toBe(true);
    const revoked = await cli(['token', 'revoke', minted.tokenId]);
    expect(revoked.code, revoked.lines.join('\n')).toBe(0);
    expect(await resolves(minted.value)).toBe(false);
  });

  it('a rotated-out token works inside the grace window and not after it', async () => {
    const seeded = await seedPlayer(db(), freshSuffix());
    const old = await mint(seeded.playerId, 'rotate-old');
    const rotated = await cli([
      'token',
      'rotate',
      seeded.playerId,
      '--out',
      join(workDir, 'rotate-new.env'),
      '--grace-minutes',
      '1',
    ]);
    expect(rotated.code, rotated.lines.join('\n')).toBe(0);
    const next = VALUE_IN_FILE.exec(await readFile(join(workDir, 'rotate-new.env'), 'utf8'));
    const newValue = (next as RegExpExecArray)[1] as string;

    // Inside the window: the old token and the new one both resolve.
    expect(await resolves(old.value), 'the old token inside the grace window').toBe(true);
    expect(await resolves(newValue), 'the new token').toBe(true);

    // The window ends when the old token's expiry passes. The CLI takes no clock, so the expiry is
    // moved into the past here instead of waiting out the minute.
    await db().query(
      `UPDATE mcp_tokens SET expires_at = now() - interval '1 second' WHERE token_id = $1`,
      [old.tokenId],
    );
    expect(await resolves(old.value), 'the old token after the grace window').toBe(false);
    expect(await resolves(newValue), 'the new token after the window').toBe(true);
  });

  it('a rotation with zero grace ends the old token at once', async () => {
    const seeded = await seedPlayer(db(), freshSuffix());
    const old = await mint(seeded.playerId, 'zero-old');
    const rotated = await cli([
      'token',
      'rotate',
      seeded.playerId,
      '--out',
      join(workDir, 'zero-new.env'),
      '--grace-minutes',
      '0',
    ]);
    expect(rotated.code, rotated.lines.join('\n')).toBe(0);
    expect(await resolves(old.value)).toBe(false);
  });

  it('prints the token once and stores only its digest', async () => {
    const seeded = await seedPlayer(db(), freshSuffix());
    const minted = await mint(seeded.playerId, 'print-once');

    // The value is never on the command output, not in the mint line and not in a listing.
    expect(minted.lines.join('\n')).not.toContain(minted.value);
    const listed = await cli(['token', 'list', '--player', seeded.playerId]);
    expect(listed.lines.join('\n')).not.toContain(minted.value);

    // The database holds the keyed digest of the value and no copy of the value itself.
    const row = await db().query('SELECT token_hash FROM mcp_tokens WHERE token_id = $1', [
      minted.tokenId,
    ]);
    const stored = row.rows[0]?.token_hash as Buffer;
    expect(stored.equals(hashToken(pepper, minted.value))).toBe(true);
    const copies = await db().query(
      'SELECT count(*)::int AS n FROM mcp_tokens t WHERE strpos(t::text, $1) > 0',
      [minted.value],
    );
    expect(copies.rows[0]?.n).toBe(0);
  });
});
