/**
 * The XP ledger against a real Postgres (migration 0050). Skipped unless GELDAR_IT=1; CI runs it on a
 * throwaway database (assertConnectedToThrowaway refuses the dev database). Each test uses its own life id,
 * so it starts with no XP for its life; no test truncates, since the append-only triggers refuse it.
 * Each award is applied in its own transaction, as the writer does. The agent row is seeded with every
 * NOT NULL column of sql/0001_init.sql (game_account is the fresh life id), as audit.it.test.ts does.
 */
import { readFileSync } from 'node:fs';
import { DEFAULT_THRESHOLDS, type Domain } from '@geldar/psyche';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eventOf } from '../src/projection.fakes.ts';
import { isPermanentDbError, pgEventWriter } from '../src/writer.ts';
import type { XpAward } from '../src/xp/awards.ts';
import { applyAward } from '../src/xp/ledger.ts';
import { pgXpStore } from '../src/xp/pg-xp-store.ts';
import { assertConnectedToThrowaway } from './throwaway-db.ts';

// The AN-09a stub throws, so the writer case needs real awards: here each event's payload `key` is its
// evidence key, awarded in mining. Only the writer case reaches awardsFor; the other cases call applyAward.
vi.mock('../src/xp/awards.ts', () => ({
  awardsFor: (event: {
    agent_id: string;
    source_event_id: string;
    world_tick: number;
    payload: { key: string };
  }) => [
    {
      lifeId: event.agent_id,
      domain: 'mining',
      evidenceKey: event.payload.key,
      sourceEventId: event.source_event_id,
      worldTick: event.world_tick,
    },
  ],
}));

const enabled = process.env.GELDAR_IT === '1';
const NAME_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';

/**
 * A life id matching the contract's LifeId pattern, `^ag_[a-z][a-z0-9]{0,15}_[0-9]{2,}$`: `ag_`, a
 * 12-character random name starting with a letter, `_`, and two digits. A new life has no XP yet.
 */
function freshLifeId(): string {
  let name = 'xp';
  for (let i = 0; i < 10; i++) name += NAME_CHARS[Math.floor(Math.random() * NAME_CHARS.length)];
  return `ag_${name}_${10 + Math.floor(Math.random() * 90)}`;
}

function awardOf(
  life: string,
  key: string,
  source = `ev_${key}`,
  domain: Domain = 'mining',
): XpAward {
  return { lifeId: life, domain, evidenceKey: key, sourceEventId: source, worldTick: 100 };
}

describe.skipIf(!enabled)('XP ledger against the live database', () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    const password = readFileSync(
      new URL('../../compose/secrets/postgres.txt', import.meta.url),
      'utf8',
    ).trim();
    pool = new pg.Pool({
      host: '127.0.0.1',
      user: 'geldar',
      database: process.env.POSTGRES_DB ?? 'geldar',
      password,
    });
    try {
      await assertConnectedToThrowaway(pool);
    } catch (err) {
      await pool.end();
      throw err;
    }
  });

  afterAll(async () => {
    await pool?.end();
  });

  async function seedLife(): Promise<string> {
    const life = freshLifeId();
    await pool.query(
      `INSERT INTO agents (agent_id, name, life_seq, game_account, shard, mode, harness, declared_model,
         model_config, tier)
       VALUES ($1, 'It', 1, $1, 'phaseitxp', 'sovereign', 'it-on', 'self-reported',
         'declared:unverified', 'sovereign')`,
      [life],
    );
    return life;
  }

  /** Runs fn on one client in BEGIN ... COMMIT, or ROLLBACK when fn throws (the error is rethrown). */
  async function inTx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  function awardInTx(a: XpAward) {
    return inTx((client) => applyAward(pgXpStore(client), a, DEFAULT_THRESHOLDS));
  }

  async function levelOf(life: string, domain: Domain = 'mining'): Promise<number> {
    const { rows } = await pool.query(
      'SELECT level FROM proficiency WHERE life_id = $1 AND domain = $2',
      [life, domain],
    );
    return rows.length === 0 ? 0 : Number(rows[0].level);
  }

  async function count(sql: string, life: string): Promise<number> {
    const { rows } = await pool.query(sql, [life]);
    return Number(rows[0]?.n);
  }

  async function xpOf(life: string, domain: Domain = 'mining'): Promise<number> {
    const { rows } = await pool.query(
      'SELECT xp FROM proficiency WHERE life_id = $1 AND domain = $2',
      [life, domain],
    );
    return rows.length === 0 ? 0 : Number(rows[0].xp);
  }

  it('a redelivered award adds one XP once', async () => {
    const life = await seedLife();
    const a = awardOf(life, 'k1');
    expect(await awardInTx(a)).toEqual({ awarded: true, level: null });
    expect(await awardInTx(a)).toEqual({ awarded: false, level: null });
    expect(await xpOf(life)).toBe(1);
    expect(await count('SELECT count(*)::int AS n FROM xp_evidence WHERE life_id = $1', life)).toBe(
      1,
    );
  });

  it('two sources of one accomplishment give one XP, the first source wins, in either order', async () => {
    const life = await seedLife();
    await awardInTx(awardOf(life, 'k1', 'ev_running'));
    await awardInTx(awardOf(life, 'k1', 'ev_completed'));
    expect(await xpOf(life)).toBe(1);
    const { rows } = await pool.query(
      'SELECT source_event_id FROM xp_evidence WHERE life_id = $1',
      [life],
    );
    expect(rows.map((r) => r.source_event_id)).toEqual(['ev_running']);

    const other = await seedLife();
    await awardInTx(awardOf(other, 'k2', 'ev_completed'));
    await awardInTx(awardOf(other, 'k2', 'ev_running'));
    expect(await xpOf(other)).toBe(1);
  });

  it('two concurrent transactions with different keys give two XP (no lost update)', async () => {
    const life = await seedLife();
    await Promise.all([awardInTx(awardOf(life, 'c1')), awardInTx(awardOf(life, 'c2'))]);
    expect(await xpOf(life)).toBe(2);
    expect(await count('SELECT count(*)::int AS n FROM xp_evidence WHERE life_id = $1', life)).toBe(
      2,
    );
  });

  it('a rollback after the evidence insert leaves no evidence and no XP', async () => {
    const life = await seedLife();
    await expect(
      inTx(async (client) => {
        await applyAward(pgXpStore(client), awardOf(life, 'r1'), DEFAULT_THRESHOLDS);
        throw new Error('abort after the award');
      }),
    ).rejects.toThrow('abort after the award');
    expect(await count('SELECT count(*)::int AS n FROM xp_evidence WHERE life_id = $1', life)).toBe(
      0,
    );
    expect(await count('SELECT count(*)::int AS n FROM proficiency WHERE life_id = $1', life)).toBe(
      0,
    );
  });

  it('the levels at 10, 30 and 70 each enqueue one outbox row, and 71 XP enqueue no more', async () => {
    const life = await seedLife();
    const outboxCounts: number[] = [];
    const levels: Array<number | null> = [];
    for (let i = 1; i <= 71; i++) {
      levels.push((await awardInTx(awardOf(life, `k${i}`))).level);
      outboxCounts.push(
        await count('SELECT count(*)::int AS n FROM proficiency_outbox WHERE life_id = $1', life),
      );
    }
    // 9 to 10, 29 to 30 and 69 to 70 each add exactly one row (outboxCounts is indexed from 0).
    expect(outboxCounts[8]).toBe(0);
    expect(outboxCounts[9]).toBe(1);
    expect(outboxCounts[28]).toBe(1);
    expect(outboxCounts[29]).toBe(2);
    expect(outboxCounts[68]).toBe(2);
    expect(outboxCounts[69]).toBe(3);
    expect(outboxCounts[70]).toBe(3);
    expect(levels.filter((l) => l !== null)).toEqual([1, 2, 3]);
    const { rows } = await pool.query(
      'SELECT level, xp, version FROM proficiency_outbox WHERE life_id = $1 ORDER BY outbox_id',
      [life],
    );
    expect(rows.map((r) => [r.level, r.xp, Number(r.version)])).toEqual([
      [1, 10, 10],
      [2, 30, 30],
      [3, 70, 70],
    ]);
  }, 60_000);

  it('a poison award (evidence key over 200 characters) is a permanent error and stores nothing', async () => {
    const life = await seedLife();
    const error = await awardInTx(awardOf(life, 'x'.repeat(201))).catch((err: unknown) => err);
    expect(error).toMatchObject({ code: '23514' });
    expect(isPermanentDbError(error)).toBe(true);
    expect(await count('SELECT count(*)::int AS n FROM xp_evidence WHERE life_id = $1', life)).toBe(
      0,
    );
    expect(await xpOf(life)).toBe(0);
  });

  it('an unknown life is skipped, not poisoned, and stores nothing', async () => {
    const ghost = freshLifeId();
    await expect(awardInTx(awardOf(ghost, 'k1'))).resolves.toEqual({
      awarded: false,
      level: null,
    });
    expect(
      await count('SELECT count(*)::int AS n FROM xp_evidence WHERE life_id = $1', ghost),
    ).toBe(0);
  });

  it('setLevel stores the level in proficiency at each crossing (0, 1, 1, 2, 2, 3 at 9, 10, 29, 30, 69, 70)', async () => {
    const life = await seedLife();
    const stored: number[] = [];
    for (let i = 1; i <= 70; i++) {
      await awardInTx(awardOf(life, `k${i}`));
      if ([9, 10, 29, 30, 69, 70].includes(i)) stored.push(await levelOf(life));
    }
    expect(stored).toEqual([0, 1, 1, 2, 2, 3]);
  }, 60_000);

  it('the outbox version is the life total across two domains (5 combat + 10 mining = 15)', async () => {
    const life = await seedLife();
    for (let i = 1; i <= 5; i++) {
      await awardInTx(awardOf(life, `c${i}`, `ev_c${i}`, 'combat'));
    }
    for (let i = 1; i <= 10; i++) await awardInTx(awardOf(life, `m${i}`));
    expect(await xpOf(life, 'combat')).toBe(5);
    const { rows } = await pool.query(
      'SELECT domain, level, xp, version FROM proficiency_outbox WHERE life_id = $1',
      [life],
    );
    expect(rows.map((r) => [r.domain, r.level, r.xp, Number(r.version)])).toEqual([
      ['mining', 1, 10, 15],
    ]);
  });

  it('the writer with XP on awards each event once in the batch transaction; redelivery adds nothing', async () => {
    const life = await seedLife();
    const writer = pgEventWriter(pool, { enabled: true, thresholds: DEFAULT_THRESHOLDS });
    const event = (n: number, key: string) => ({
      ...eventOf('speech', { key }, n),
      agent_id: life,
      source_event_id: `${life}_w${n}`,
    });
    // Ten keys: k1 arrives from two sources in one batch, so the batch has eleven events and ten XP.
    const batch = [
      event(1, 'k1'),
      event(2, 'k1'),
      ...Array.from({ length: 9 }, (_, i) => event(i + 3, `k${i + 2}`)),
    ];
    await writer.insertBatch(batch);
    expect(await xpOf(life)).toBe(10);
    expect(await levelOf(life)).toBe(1);
    expect(await count('SELECT count(*)::int AS n FROM xp_evidence WHERE life_id = $1', life)).toBe(
      10,
    );
    expect(await count('SELECT count(*)::int AS n FROM events WHERE agent_id = $1', life)).toBe(11);
    // Redelivery of the same batch: the events and the evidence conflict, so no XP and no new outbox row.
    await writer.insertBatch(batch);
    expect(await xpOf(life)).toBe(10);
    expect(
      await count('SELECT count(*)::int AS n FROM proficiency_outbox WHERE life_id = $1', life),
    ).toBe(1);
    expect(await count('SELECT count(*)::int AS n FROM events WHERE agent_id = $1', life)).toBe(11);
    const { rows } = await pool.query(
      'SELECT level, xp, version FROM proficiency_outbox WHERE life_id = $1',
      [life],
    );
    expect(rows.map((r) => [r.level, r.xp, Number(r.version)])).toEqual([[1, 10, 10]]);
  });
});
