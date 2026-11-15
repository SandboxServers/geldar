/**
 * The audit projection against a real Postgres (migration 0051). Skipped unless GELDAR_IT=1; ops runs it on
 * a throwaway database (assertConnectedToThrowaway refuses the dev database). Each test uses its own life id,
 * so it starts from no audit rows for its life; no test truncates, since the append-only triggers refuse it.
 * The agent row is seeded with every NOT NULL column of sql/0001_init.sql; game_account is the fresh life id.
 */
import { readFileSync } from 'node:fs';
import type { CharacterSheet, WorldEvent } from '@geldar/contract';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pgAuditStore } from '../src/audit/store.ts';
import { pgEventWriter } from '../src/writer.ts';
import { assertConnectedToThrowaway } from './throwaway-db.ts';

const enabled = process.env.GELDAR_IT === '1';
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const SHEET: CharacterSheet = {
  version: 1,
  attributes: { curiosity: 3, common_sense: 4, cleverness: 2, aggression: 5 },
  alignment: { law: 3, good: 4 },
  op_modes: { explorer: 3, farmer: 2, miner: 4, builder: 1, crafter: 3, warrior: 5, nitwit: 2 },
};
const OTHER_SHEET = { ...SHEET, attributes: { ...SHEET.attributes, curiosity: 1 } };

/** A ULID-shaped id with the given prefix, unique per run. */
function freshId(prefix: string): string {
  let tail = '';
  for (let i = 0; i < 26; i++) tail += ALPHABET[Math.floor(Math.random() * 32)];
  return `${prefix}_${tail}`;
}

/** A world event for `life` (the agent the event is about). */
function event(type: string, life: string, payload: object): WorldEvent {
  return {
    source_event_id: freshId('ev'),
    at: new Date().toISOString(),
    shard: 'phaseitaudit',
    world_day: 0,
    world_tick: 100,
    type,
    agent_id: life,
    payload: payload as WorldEvent['payload'],
  };
}

function rollOf(life: string, extra: object = {}): object {
  return {
    life_id: life,
    decision_id: 'dec_gather_wood_0042',
    draw_index: 0,
    engine_version: 1,
    producer: 'body',
    fx: 'gather',
    score: 3,
    dc: 12,
    mode: 'flat',
    dice: [14],
    kept: 14,
    bonus: 1,
    total: 15,
    success: true,
    ...extra,
  };
}

function decisionOf(life: string): object {
  return {
    life_id: life,
    decision_id: 'dec_pick_route_0007',
    engine_version: 1,
    producer: 'body',
    fx: 'route',
    kind: 'deterministic',
  };
}

function adoptionOf(life: string, sheetHash: string, sheet: object = SHEET): object {
  return { life_id: life, sheet, sheet_hash: sheetHash, source: 'config' };
}

describe.skipIf(!enabled)('audit projection against the live database', () => {
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
    const life = freshId('ag');
    await pool.query(
      `INSERT INTO agents (agent_id, name, life_seq, game_account, shard, mode, harness, declared_model,
         model_config, tier)
       VALUES ($1, 'It', 1, $1, 'phaseitaudit', 'sovereign', 'it-on', 'self-reported',
         'declared:unverified', 'sovereign')`,
      [life],
    );
    return life;
  }

  async function count(sql: string, value: string): Promise<number> {
    const { rows } = await pool.query(sql, [value]);
    return Number(rows[0]?.n);
  }

  it('a redelivered roll and a producer retry of the same draw are one row each', async () => {
    const life = await seedLife();
    const writer = pgEventWriter(pool);
    const roll = event('roll', life, rollOf(life));
    await writer.insertBatch([roll]);
    await writer.insertBatch([roll]);
    await writer.insertBatch([event('roll', life, rollOf(life))]);
    expect(await count('SELECT count(*)::int AS n FROM rolls WHERE life_id = $1', life)).toBe(1);
    // The redelivery is one events row (same source id); the retry is the second.
    expect(await count('SELECT count(*)::int AS n FROM events WHERE agent_id = $1', life)).toBe(2);
  });

  it('a redelivered decision and a producer retry of the same decision are one row', async () => {
    const life = await seedLife();
    const writer = pgEventWriter(pool);
    const decision = event('decision', life, decisionOf(life));
    await writer.insertBatch([decision]);
    await writer.insertBatch([decision]);
    await writer.insertBatch([event('decision', life, decisionOf(life))]);
    expect(await count('SELECT count(*)::int AS n FROM decisions WHERE life_id = $1', life)).toBe(
      1,
    );
    expect(await count('SELECT count(*)::int AS n FROM events WHERE agent_id = $1', life)).toBe(2);
  });

  it('a batch that fails mid-transaction leaves no roll row and no event row', async () => {
    const life = await seedLife();
    const ghost = freshId('ag');
    const roll = event('roll', life, rollOf(life));
    // The second event names a life with no agents row: its foreign key fails after the roll is projected.
    const unknown = event('sheet_adopted', ghost, adoptionOf(ghost, HASH_A));
    await expect(pgEventWriter(pool).insertBatch([roll, unknown])).rejects.toMatchObject({
      code: '23503',
    });
    expect(await count('SELECT count(*)::int AS n FROM rolls WHERE life_id = $1', life)).toBe(0);
    expect(
      await count(
        'SELECT count(*)::int AS n FROM events WHERE source_event_id = $1',
        roll.source_event_id,
      ),
    ).toBe(0);
  });

  it('a malformed roll is refused with its reason and stores nothing', async () => {
    const life = await seedLife();
    const bad = event('roll', life, rollOf(life, { dice: [1, 2, 3] }));
    await expect(pgEventWriter(pool).insertBatch([bad])).rejects.toThrow(
      /roll event payload is not valid/,
    );
    expect(
      await count(
        'SELECT count(*)::int AS n FROM events WHERE source_event_id = $1',
        bad.source_event_id,
      ),
    ).toBe(0);
  });

  it('a second adoption of another sheet is a conflict row and leaves the baseline sheet and hash', async () => {
    const life = await seedLife();
    const writer = pgEventWriter(pool);
    await writer.insertBatch([event('sheet_adopted', life, adoptionOf(life, HASH_A))]);
    await writer.insertBatch([event('sheet_adopted', life, adoptionOf(life, HASH_B, OTHER_SHEET))]);
    const { rows } = await pool.query(
      'SELECT result FROM character_sheet_adoptions WHERE life_id = $1 ORDER BY adoption_id',
      [life],
    );
    expect(rows.map((row) => row.result)).toEqual(['adopted', 'conflict']);
    const agent = await pool.query(
      'SELECT sheet_hash, character_sheet FROM agents WHERE agent_id = $1',
      [life],
    );
    expect(agent.rows[0]?.sheet_hash).toBe(HASH_A);
    expect(agent.rows[0]?.character_sheet).toEqual(SHEET);
  });

  it('an adoption that finds a baseline holds the agent row lock until its transaction ends', async () => {
    const life = await seedLife();
    const writer = pgEventWriter(pool);
    const conflict = event('sheet_adopted', life, adoptionOf(life, HASH_B));
    await writer.insertBatch([event('sheet_adopted', life, adoptionOf(life, HASH_A))]);
    await writer.insertBatch([conflict]);
    const holder = await pool.connect();
    const other = await pool.connect();
    try {
      await holder.query('BEGIN');
      // A redelivery of the conflicting event: the UPDATE changes no row, so the adopt path reads FOR UPDATE.
      const result = await pgAuditStore(holder).adopt(
        life,
        SHEET,
        HASH_B,
        'config',
        conflict.source_event_id,
      );
      expect(result).toBe('conflict');
      await expect(
        other.query('SELECT 1 FROM agents WHERE agent_id = $1 FOR UPDATE NOWAIT', [life]),
      ).rejects.toMatchObject({ code: '55P03' });
    } finally {
      await holder.query('ROLLBACK');
      holder.release();
      other.release();
    }
  });
});
