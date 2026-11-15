/**
 * The proficiency state service against a real Postgres (migration 0050) and a real NATS server. Skipped unless
 * GELDAR_IT=1; CI runs it on a throwaway database (assertConnectedToThrowaway refuses the dev database). Each
 * test uses fresh life ids, so none starts with state; no test truncates (the XP triggers refuse it).
 * Agent rows are seeded with every NOT NULL column of sql/0001_init.sql, as xp.it.test.ts does. The client
 * connects without credentials, as the lane's NATS server allows; the body and mcp role cases are ops checks
 * (see the worknote), not run here.
 */
import { readFileSync } from 'node:fs';
import { DEFAULT_THRESHOLDS, levelForXp, STANDARD_SHEET } from '@geldar/psyche';
import { connect, type NatsConnection } from '@nats-io/transport-node';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { proficiencyRequestSubject } from '../../contract/src/subjects.ts';
import { pgStateStore } from '../src/state/pg-state-store.ts';
import { serveProficiencyState } from '../src/state/service.ts';
import { assertConnectedToThrowaway } from './throwaway-db.ts';

const enabled = process.env.GELDAR_IT === '1';
const SHARD = 'phaseitstate';
const RATE_SHARD = 'phaseitstaterate';
const HASH = 'a'.repeat(64);
const NAME_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';
const ZERO = { level: 0, xp: 0 };
const DOMAINS = ['combat', 'farming', 'mining', 'building', 'crafting', 'exploring', 'social'];

/** A pattern-valid life id, `^ag_[a-z][a-z0-9]{0,15}_[0-9]{2,}$`, fresh for each call. */
function freshLifeId(): string {
  let name = 'st';
  for (let i = 0; i < 10; i++) name += NAME_CHARS[Math.floor(Math.random() * NAME_CHARS.length)];
  return `ag_${name}_${10 + Math.floor(Math.random() * 90)}`;
}

describe.skipIf(!enabled)('proficiency state service against the live database and NATS', () => {
  let pool: pg.Pool;
  let nc: NatsConnection;
  let svc: { stop(): Promise<void> };
  let rateSvc: { stop(): Promise<void> };

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
    nc = await connect({ servers: process.env.GELDAR_NATS_URL ?? 'nats://127.0.0.1:4222' });
    svc = serveProficiencyState({
      nc,
      store: pgStateStore(pool),
      shard: SHARD,
      log: () => undefined,
      minIntervalMs: 0,
    });
    rateSvc = serveProficiencyState({
      nc,
      store: pgStateStore(pool),
      shard: RATE_SHARD,
      log: () => undefined,
      minIntervalMs: 60_000,
    });
  });

  afterAll(async () => {
    await svc?.stop();
    await rateSvc?.stop();
    await nc?.drain();
    await pool?.end();
  });

  /** Inserts an agent row and its proficiency rows; the level is what the writer would store. */
  async function seedLife(life: string, xp: Record<string, number>, sheet = false): Promise<void> {
    await pool.query(
      `INSERT INTO agents (agent_id, name, life_seq, game_account, shard, mode, harness, declared_model,
         model_config, tier)
       VALUES ($1, 'It', 1, $1, 'phaseitstate', 'sovereign', 'it-on', 'self-reported',
         'declared:unverified', 'sovereign')`,
      [life],
    );
    for (const [domain, amount] of Object.entries(xp)) {
      await pool.query(
        `INSERT INTO proficiency (life_id, domain, xp, level, updated_tick) VALUES ($1, $2, $3, $4, 0)`,
        [life, domain, amount, levelForXp(amount, DEFAULT_THRESHOLDS)],
      );
    }
    if (sheet) {
      await pool.query(
        `UPDATE agents SET character_sheet = $2, sheet_hash = $3, sheet_adopted_at = now()
         WHERE agent_id = $1`,
        [life, JSON.stringify(STANDARD_SHEET), HASH],
      );
    }
  }

  /** One request on the wire; resolves with the reply body, or rejects on a timeout or no responders. */
  async function ask(subject: string, body = '', timeout = 1000): Promise<string> {
    const msg = await nc.request(subject, new TextEncoder().encode(body), { timeout });
    return new TextDecoder().decode(msg.data);
  }

  it('replies with the life levels and the XP sum as version, and no sheet', async () => {
    const life = freshLifeId();
    await seedLife(life, { mining: 40, combat: 5 });
    const body = JSON.parse(await ask(proficiencyRequestSubject(SHARD, life)));
    expect(body.life_id).toBe(life);
    expect(body.version).toBe(45);
    expect(body.levels.mining).toEqual({ level: levelForXp(40, DEFAULT_THRESHOLDS), xp: 40 });
    expect(body.levels.combat).toEqual({ level: levelForXp(5, DEFAULT_THRESHOLDS), xp: 5 });
    expect(body.levels.farming).toEqual(ZERO);
    expect(body).not.toHaveProperty('sheet');
  });

  it('a life with no proficiency rows replies version 0 and seven zero levels', async () => {
    const life = freshLifeId();
    await seedLife(life, {});
    const body = JSON.parse(await ask(proficiencyRequestSubject(SHARD, life)));
    expect(body).toEqual({
      life_id: life,
      version: 0,
      levels: Object.fromEntries(DOMAINS.map((d) => [d, ZERO])),
    });
  });

  it('a life with an adopted sheet replies its levels and version, never the sheet or its hash', async () => {
    const life = freshLifeId();
    await seedLife(life, { building: 1 }, true);
    const reply = await ask(proficiencyRequestSubject(SHARD, life));
    const body = JSON.parse(reply);
    expect(body.version).toBe(1);
    expect(body).not.toHaveProperty('sheet');
    expect(body).not.toHaveProperty('sheet_hash');
    expect(reply).not.toContain(HASH);
  });

  it('an unknown life (no agents row) replies unknown_life', async () => {
    const life = freshLifeId();
    expect(await ask(proficiencyRequestSubject(SHARD, life))).toBe('{"error":"unknown_life"}');
  });

  it('a reply carries only the subject life: another life XP never appears', async () => {
    const life = freshLifeId();
    const other = freshLifeId();
    await seedLife(life, { mining: 3 });
    await seedLife(other, { combat: 77 });
    const text = await ask(proficiencyRequestSubject(SHARD, life));
    const body = JSON.parse(text);
    expect(body.life_id).toBe(life);
    expect(body.version).toBe(3);
    expect(body.levels.combat).toEqual(ZERO);
    expect(text).not.toContain(other);
  });

  it('a life id in the request body is not trusted: the subject life answers', async () => {
    const life = freshLifeId();
    const other = freshLifeId();
    await seedLife(life, { mining: 3 });
    await seedLife(other, { combat: 77 });
    const body = JSON.parse(
      await ask(proficiencyRequestSubject(SHARD, life), JSON.stringify({ life_id: other })),
    );
    expect(body.life_id).toBe(life);
    expect(body.version).toBe(3);
  });

  it('a request for another shard gets no reply', async () => {
    const life = freshLifeId();
    await seedLife(life, {});
    await expect(
      ask(`geldar.phaseitotherstate.state.${life}.proficiency`, '', 500),
    ).rejects.toThrow();
  });

  it('a body over 256 bytes gets no reply', async () => {
    const life = freshLifeId();
    await seedLife(life, {});
    await expect(
      ask(proficiencyRequestSubject(SHARD, life), 'x'.repeat(257), 500),
    ).rejects.toThrow();
  });

  it('a second request inside the minimum interval gets the rate error', async () => {
    const life = freshLifeId();
    await seedLife(life, { mining: 1 });
    const subject = proficiencyRequestSubject(RATE_SHARD, life);
    expect(JSON.parse(await ask(subject)).life_id).toBe(life);
    expect(await ask(subject)).toBe('{"error":"rate"}');
  });
});
