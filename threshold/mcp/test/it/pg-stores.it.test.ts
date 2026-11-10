/**
 * WM-12 integration: the MCP server's Postgres stores against a real database, and the grants of
 * the geldar_mcp role. Skipped unless GELDAR_IT=1 (integrationEnabled). One scratch database
 * serves the file; every case seeds ids of its own (a random suffix), so no case depends on
 * another. afterAll drops the database even when a case or the setup failed.
 */
import { randomBytes } from 'node:crypto';
import type { ClientConfig, Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PgAgentStore } from '../../src/store/pg-agents.ts';
import { PgBudgetLedger } from '../../src/store/pg-budget.ts';
import { PgJournalStore } from '../../src/store/pg-journal.ts';
import { PgTokenStore } from '../../src/store/pg-tokens.ts';
import { integrationEnabled } from '../live/gate.ts';
import {
  adminConfig,
  createScratchDatabase,
  dropScratchDatabase,
  freshSuffix,
  insertToken,
  migrateScratch,
  scratchPool,
  seedPlayer,
} from './scratch-db.ts';

/** SQLSTATE 42501: insufficient_privilege, what Postgres raises for a refused grant. */
const PERMISSION_DENIED = { code: '42501' };

const tokenStates = [
  {
    case: 'a valid token resolves',
    expiresIn: '1 day',
    revoked: false,
    status: 'active',
    harnessEnabled: true,
    resolves: true,
  },
  {
    case: 'an expired token does not resolve',
    expiresIn: '-1 minute',
    revoked: false,
    status: 'active',
    harnessEnabled: true,
    resolves: false,
  },
  {
    case: 'a revoked token does not resolve',
    expiresIn: '1 day',
    revoked: true,
    status: 'active',
    harnessEnabled: true,
    resolves: false,
  },
  {
    // The schema has no owner status; a retired sovereign player is the retirement it records.
    case: 'a token of a retired player does not resolve',
    expiresIn: '1 day',
    revoked: false,
    status: 'retired',
    harnessEnabled: true,
    resolves: false,
  },
  {
    case: 'a token whose harness is disabled does not resolve',
    expiresIn: '1 day',
    revoked: false,
    status: 'active',
    harnessEnabled: false,
    resolves: false,
  },
];

describe.skipIf(!integrationEnabled())('Postgres stores against a real database', () => {
  let database = '';
  let admin: Pool;
  let mcp: Pool;

  beforeAll(async () => {
    database = await createScratchDatabase();
    admin = scratchPool(database);
    await migrateScratch(admin);
    mcp = scratchPool(database, 'geldar_mcp');
  });

  afterAll(async () => {
    await mcp?.end().catch(() => undefined);
    await admin?.end().catch(() => undefined);
    if (database !== '') await dropScratchDatabase(database).catch(() => undefined);
  });

  /**
   * The LISTEN connection as the server opens it: the geldar_mcp role on the scratch database. The
   * application_name lets a case find, and terminate, its own listener.
   */
  function listenConfig(applicationName = 'geldar-it-listen'): ClientConfig {
    return {
      ...adminConfig(database),
      options: '-c role=geldar_mcp',
      application_name: applicationName,
    };
  }

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Terminates the named LISTEN backend, then waits until it is gone: the store is now between
   * connections, so a change made next is a NOTIFY the gap hides.
   */
  async function dropListener(applicationName: string): Promise<void> {
    await admin.query(
      'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = $1',
      [applicationName],
    );
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const { rows } = await admin.query<{ n: string }>(
        'SELECT count(*)::text AS n FROM pg_stat_activity WHERE application_name = $1',
        [applicationName],
      );
      if (rows[0]?.n === '0') return;
      await sleep(20);
    }
  }

  describe('token states', () => {
    it.each(tokenStates)('$case', async (state) => {
      const seeded = await seedPlayer(admin, freshSuffix(), { status: state.status });
      const hash = randomBytes(32);
      await insertToken(admin, seeded.playerId, hash, state.expiresIn, state.revoked);
      const store = new PgTokenStore(mcp, { 'it-on': state.harnessEnabled }, listenConfig());
      const resolved = await store.resolve(hash, Date.now());
      if (state.resolves) {
        expect(resolved?.player.playerId, 'the player the token resolves to').toBe(seeded.playerId);
      } else {
        expect(resolved, 'a token that must not resolve').toBeNull();
      }
    });
  });

  it('a revocation drops the cached token within one second', async () => {
    const seeded = await seedPlayer(admin, freshSuffix());
    const hash = randomBytes(32);
    const tokenId = await insertToken(admin, seeded.playerId, hash, '1 day');
    const store = new PgTokenStore(mcp, { 'it-on': true }, listenConfig());
    const notices: { tokenId: string; playerId: string }[] = [];
    store.onRevoke((notice) => notices.push(notice));
    await store.start();
    try {
      expect(await store.resolve(hash, Date.now()), 'the hit before the revocation').not.toBeNull();
      await admin.query('UPDATE mcp_tokens SET revoked_at = now() WHERE token_id = $1', [tokenId]);
      // Without the NOTIFY the cache would answer for 5 s; the deadline is 1 s.
      const deadline = Date.now() + 1_000;
      let after = await store.resolve(hash, Date.now());
      while (after !== null && Date.now() < deadline) {
        await sleep(50);
        after = await store.resolve(hash, Date.now());
      }
      expect(after, 'the resolve within 1 s of the revocation').toBeNull();
      expect(notices, 'the revocation notice').toContainEqual({
        tokenId,
        playerId: seeded.playerId,
      });
    } finally {
      await store.stop();
    }
  });

  it('pausing a player ends its open session within one second', async () => {
    const seeded = await seedPlayer(admin, freshSuffix());
    const hash = randomBytes(32);
    const tokenId = await insertToken(admin, seeded.playerId, hash, '1 day');
    const store = new PgTokenStore(mcp, { 'it-on': true }, listenConfig());
    const notices: { tokenId: string; playerId: string }[] = [];
    store.onRevoke((notice) => notices.push(notice));
    await store.start();
    try {
      expect(await store.resolve(hash, Date.now()), 'the hit before the pause').not.toBeNull();
      await admin.query("UPDATE mcp_players SET status = 'paused' WHERE player_id = $1", [
        seeded.playerId,
      ]);
      const deadline = Date.now() + 1_000;
      while (notices.length === 0 && Date.now() < deadline) await sleep(50);
      expect(notices, 'the session end for the paused player').toContainEqual({
        tokenId,
        playerId: seeded.playerId,
      });
      expect(await store.resolve(hash, Date.now()), 'the token after the pause').toBeNull();
    } finally {
      await store.stop();
    }
  });

  it('a revocation made while the LISTEN connection is down is fired on reconnect', async () => {
    const seeded = await seedPlayer(admin, freshSuffix());
    const hash = randomBytes(32);
    const tokenId = await insertToken(admin, seeded.playerId, hash, '1 day');
    const name = `it-listen-${freshSuffix()}`;
    const store = new PgTokenStore(mcp, { 'it-on': true }, listenConfig(name));
    const notices: { tokenId: string; playerId: string }[] = [];
    store.onRevoke((notice) => notices.push(notice));
    await store.start();
    try {
      await dropListener(name);
      await admin.query('UPDATE mcp_tokens SET revoked_at = now() WHERE token_id = $1', [tokenId]);
      const deadline = Date.now() + 10_000;
      while (notices.length === 0 && Date.now() < deadline) await sleep(50);
      expect(notices, 'the revocation the gap hid, fired after reconnect').toContainEqual({
        tokenId,
        playerId: seeded.playerId,
      });
    } finally {
      await store.stop();
    }
  });

  it('a pause made while the LISTEN connection is down is fired on reconnect', async () => {
    const seeded = await seedPlayer(admin, freshSuffix());
    const hash = randomBytes(32);
    const tokenId = await insertToken(admin, seeded.playerId, hash, '1 day');
    const name = `it-listen-${freshSuffix()}`;
    const store = new PgTokenStore(mcp, { 'it-on': true }, listenConfig(name));
    const notices: { tokenId: string; playerId: string }[] = [];
    store.onRevoke((notice) => notices.push(notice));
    await store.start();
    try {
      await dropListener(name);
      await admin.query("UPDATE mcp_players SET status = 'paused' WHERE player_id = $1", [
        seeded.playerId,
      ]);
      const deadline = Date.now() + 10_000;
      while (notices.length === 0 && Date.now() < deadline) await sleep(50);
      expect(notices, 'the session end the gap hid, fired after reconnect').toContainEqual({
        tokenId,
        playerId: seeded.playerId,
      });
    } finally {
      await store.stop();
    }
  });

  it('ten parallel reserves never overspend the balance', async () => {
    const seeded = await seedPlayer(admin, freshSuffix());
    // One credit per real hour: no accrual lands inside the test, so the balance moves only by
    // the reserves. The start balance is 240 (seedPlayer) and the cap is the same 240.
    const ledger = new PgBudgetLedger(mcp, { creditsPerRealHour: 1, capCredits: 240 });
    const cost = 50;
    const results = await Promise.all(
      Array.from({ length: 10 }, () => ledger.reserve(seeded.lifeId, cost, Date.now())),
    );
    const accepted = results.filter((result) => result.ok).length;
    const { rows } = await admin.query<{ credits: number }>(
      'SELECT credits FROM mcp_budget WHERE life_id = $1',
      [seeded.lifeId],
    );
    const final = rows[0]?.credits;
    expect(accepted, 'the reserves accepted: 240 covers four of 50').toBe(4);
    expect(
      results.every((result) => result.remaining >= 0),
      'no remaining balance below zero',
    ).toBe(true);
    expect(final, 'the stored balance: start minus the accepted costs').toBe(240 - accepted * cost);
    expect(final, 'the stored balance never below zero').toBeGreaterThanOrEqual(0);
  });

  it('a balance racing a reserve never writes back a stale accrual', async () => {
    // 60 credits an hour; the stored balance is 100 with an hour of accrual owed: 160 before the
    // reserve. Whichever runs first, the end is 100 + 60 - 50 = 110. A stale write ends elsewhere.
    const ledger = new PgBudgetLedger(mcp, { creditsPerRealHour: 60, capCredits: 240 });
    for (let round = 0; round < 5; round += 1) {
      const seeded = await seedPlayer(admin, freshSuffix());
      const now = Date.now();
      await admin.query('UPDATE mcp_budget SET credits = 100, accrued_at = $2 WHERE life_id = $1', [
        seeded.lifeId,
        new Date(now - 3_600_000),
      ]);
      const [reserved] = await Promise.all([
        ledger.reserve(seeded.lifeId, 50, now),
        ledger.balance(seeded.lifeId, now),
      ]);
      expect(reserved.ok, 'the reserve covered by 160').toBe(true);
      const { rows } = await admin.query<{ credits: number }>(
        'SELECT credits FROM mcp_budget WHERE life_id = $1',
        [seeded.lifeId],
      );
      expect(rows[0]?.credits, 'the stored balance after both').toBe(110);
    }
  });

  describe('the geldar_mcp role', () => {
    it('reads the tables the server reads', async () => {
      await seedPlayer(admin, freshSuffix());
      for (const table of ['agents', 'mcp_owners', 'mcp_players', 'mcp_tokens', 'mcp_budget']) {
        const { rows } = await mcp.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`);
        expect(rows[0]?.n, `rows readable in ${table}`).toBeGreaterThanOrEqual(1);
      }
    });

    it('writes the columns and tables the server writes', async () => {
      const seeded = await seedPlayer(admin, freshSuffix());
      const hash = randomBytes(32);
      const tokenId = await insertToken(admin, seeded.playerId, hash, '1 day');
      const touched = await mcp.query(
        'UPDATE mcp_tokens SET last_used_at = now() WHERE token_id = $1',
        [tokenId],
      );
      const journaled = await mcp.query(
        'INSERT INTO mcp_journal (life_id, at, text) VALUES ($1, now(), $2)',
        [seeded.lifeId, 'it write'],
      );
      expect(touched.rowCount, 'last_used_at updated').toBe(1);
      expect(journaled.rowCount, 'journal row inserted').toBe(1);
    });

    it('upserts its sleep mark, but may not write agents or read its last_sleep_day', async () => {
      const seeded = await seedPlayer(admin, freshSuffix());
      const store = new PgAgentStore(mcp);
      await store.write(seeded.lifeId, { lastSleepDay: 6, cursor: 12 });
      await store.write(seeded.lifeId, { lastSleepDay: 7, cursor: 15 });
      expect(await store.read(seeded.lifeId), 'the mark as last written').toEqual({
        lastSleepDay: 7,
        cursor: 15,
      });
      await expect(
        mcp.query('UPDATE agents SET last_sleep_day = 8 WHERE agent_id = $1', [seeded.lifeId]),
      ).rejects.toThrow(/permission denied/);
      await expect(mcp.query('SELECT last_sleep_day FROM agents LIMIT 1')).rejects.toThrow(
        /permission denied/,
      );
    });

    it('keeps the newest 1000 journal lines of a life, oldest first to go', async () => {
      const seeded = await seedPlayer(admin, freshSuffix());
      const journal = new PgJournalStore(mcp);
      for (let i = 0; i < 1001; i += 1) await journal.append(seeded.lifeId, `line ${i}`, i);
      const count = await mcp.query<{ n: string }>(
        'SELECT count(*) AS n FROM mcp_journal WHERE life_id = $1',
        [seeded.lifeId],
      );
      expect(count.rows[0]?.n, 'rows kept').toBe('1000');
      const oldest = await mcp.query<{ text: string }>(
        'SELECT text FROM mcp_journal WHERE life_id = $1 ORDER BY id ASC LIMIT 1',
        [seeded.lifeId],
      );
      expect(oldest.rows[0]?.text, 'the first line was trimmed').toBe('line 1');
    }, 30_000);

    it('refuses a read of thoughts', async () => {
      await expect(mcp.query('SELECT 1 FROM thoughts LIMIT 1')).rejects.toMatchObject(
        PERMISSION_DENIED,
      );
    });

    it('refuses an insert into mcp_owners, which it does not write', async () => {
      const ownerId = `it-own-${freshSuffix()}`;
      await expect(
        mcp.query('INSERT INTO mcp_owners (owner_id, display) VALUES ($1, $1)', [ownerId]),
      ).rejects.toMatchObject(PERMISSION_DENIED);
    });

    it('refuses a change to a stored token hash', async () => {
      const seeded = await seedPlayer(admin, freshSuffix());
      const tokenId = await insertToken(admin, seeded.playerId, randomBytes(32), '1 day');
      await expect(
        mcp.query('UPDATE mcp_tokens SET token_hash = $2 WHERE token_id = $1', [
          tokenId,
          randomBytes(32),
        ]),
      ).rejects.toMatchObject(PERMISSION_DENIED);
    });
  });
});
