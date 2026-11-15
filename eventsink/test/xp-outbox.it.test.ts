/**
 * The level outbox publisher against a real Postgres (migration 0050) and the CI NATS server (127.0.0.1:4222, no
 * credentials, as eventsink.it.test.ts uses). Skipped unless GELDAR_IT=1; CI runs it on a throwaway database. Each
 * test uses fresh life ids and the shard 'phaseitoutbox', so its NATS subjects are its own. The loop never runs
 * (the interval is an hour): each pass is an explicit drainOnce. The agent row is seeded with every NOT NULL
 * column of sql/0001_init.sql, as xp.it.test.ts does.
 */
import { readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { connect } from '@nats-io/transport-node';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { type LevelPush, startOutboxPublisher } from '../src/xp/outbox.ts';
import { assertConnectedToThrowaway } from './throwaway-db.ts';

const enabled = process.env.GELDAR_IT === '1';
const SHARD = 'phaseitoutbox';
const NAME_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** A life id matching `^ag_[a-z][a-z0-9]{0,15}_[0-9]{2,}$`: `ag_`, `ob` and ten random characters, `_`, two digits. */
function freshLifeId(): string {
  let name = 'ob';
  for (let i = 0; i < 10; i++) name += NAME_CHARS[Math.floor(Math.random() * NAME_CHARS.length)];
  return `ag_${name}_${10 + Math.floor(Math.random() * 90)}`;
}

interface Level {
  domain?: string;
  level?: number;
  xp?: number;
  version: number;
}

describe.skipIf(!enabled)('level outbox publisher against the live stack', () => {
  let pool: pg.Pool;
  let nc: Awaited<ReturnType<typeof connect>>;
  const logs: string[] = [];
  // Unpublished rows this case leaves on purpose; afterEach marks them published so the next case starts clean.
  const bogusIds: number[] = [];

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
    nc = await connect({ servers: 'nats://127.0.0.1:4222' });
    // drainOnce claims every unpublished row in the table: rows left by other files or an earlier run would
    // change the counts below, so they are marked published first (CI runs this file in its own serial step).
    await pool.query(
      'UPDATE proficiency_outbox SET published_at = now() WHERE published_at IS NULL',
    );
  });

  afterEach(async () => {
    if (bogusIds.length === 0) return;
    await pool.query(
      'UPDATE proficiency_outbox SET published_at = now() WHERE outbox_id = ANY($1::bigint[])',
      [bogusIds.splice(0)],
    );
  });

  afterAll(async () => {
    await nc?.close();
    await pool?.end();
  });

  async function seedLife(): Promise<string> {
    const life = freshLifeId();
    await pool.query(
      `INSERT INTO agents (agent_id, name, life_seq, game_account, shard, mode, harness, declared_model,
         model_config, tier)
       VALUES ($1, 'It', 1, $1, $2, 'sovereign', 'it-on', 'self-reported',
         'declared:unverified', 'sovereign')`,
      [life, SHARD],
    );
    return life;
  }

  /** One outbox row for a life (mining unless the case says otherwise); returns its outbox_id. */
  async function addRow(life: string, l: Level): Promise<number> {
    const { rows } = await pool.query<{ outbox_id: string }>(
      `INSERT INTO proficiency_outbox (life_id, domain, level, xp, version)
       VALUES ($1, $2, $3, $4, $5) RETURNING outbox_id`,
      [life, l.domain ?? 'mining', l.level ?? 1, l.xp ?? 10, l.version],
    );
    return Number(rows[0]?.outbox_id);
  }

  async function isPublished(id: number): Promise<boolean> {
    const { rows } = await pool.query<{ published: boolean }>(
      'SELECT published_at IS NOT NULL AS published FROM proficiency_outbox WHERE outbox_id = $1',
      [id],
    );
    return rows[0]?.published === true;
  }

  /** Collects the bodies on one life's level subject. */
  function listen(life: string): { bodies: string[]; close(): void } {
    const sub = nc.subscribe(`geldar.${SHARD}.state.${life}.level`);
    const bodies: string[] = [];
    void (async () => {
      for await (const m of sub) bodies.push(m.string());
    })();
    return { bodies, close: () => sub.unsubscribe() };
  }

  async function waitFor(cond: () => boolean): Promise<void> {
    for (let i = 0; i < 80 && !cond(); i++) await sleep(25);
  }

  const natsPush: LevelPush = { publish: (subject, body) => nc.publish(subject, body) };

  function publisher(push: LevelPush, batch = 100) {
    return startOutboxPublisher({
      pool,
      push,
      intervalMs: 3_600_000,
      batch,
      log: (l) => logs.push(l),
    });
  }

  const body = (life: string, level: number, version: number, domain = 'mining') =>
    JSON.stringify({ life_id: life, domain, level, xp: 10, version });

  it('publishes a level change once on its subject and marks the row published', async () => {
    const life = await seedLife();
    const id = await addRow(life, { version: 10 });
    const l = listen(life);
    const p = publisher(natsPush);
    expect(await p.drainOnce()).toBe(1);
    await waitFor(() => l.bodies.length >= 1);
    expect(l.bodies).toEqual([body(life, 1, 10)]);
    expect(await isPublished(id)).toBe(true);
    await p.stop();
    l.close();
  });

  it('a crash between the publish and the mark republishes the row once more', async () => {
    const life = await seedLife();
    const id = await addRow(life, { version: 10 });
    const l = listen(life);
    let crash = true;
    const p = publisher({
      publish(subject, b) {
        nc.publish(subject, b);
        if (crash) throw new Error('crash after publish');
      },
    });
    expect(await p.drainOnce()).toBe(0);
    expect(await isPublished(id)).toBe(false);
    crash = false;
    expect(await p.drainOnce()).toBe(1);
    await waitFor(() => l.bodies.length >= 2);
    expect(l.bodies).toEqual([body(life, 1, 10), body(life, 1, 10)]);
    expect(await isPublished(id)).toBe(true);
    await p.stop();
    l.close();
  });

  it('a transient NATS failure keeps the row unpublished and it goes out later', async () => {
    const life = await seedLife();
    const id = await addRow(life, { version: 10 });
    const l = listen(life);
    let down = true;
    const p = publisher({
      publish(subject, b) {
        if (down) throw new Error('nats unavailable');
        nc.publish(subject, b);
      },
    });
    expect(await p.drainOnce()).toBe(0);
    expect(await isPublished(id)).toBe(false);
    down = false;
    expect(await p.drainOnce()).toBe(1);
    await waitFor(() => l.bodies.length >= 1);
    expect(l.bodies).toEqual([body(life, 1, 10)]);
    expect(await isPublished(id)).toBe(true);
    await p.stop();
    l.close();
  });

  it('two publishers do not double-claim: a row another transaction holds is skipped, not waited for', async () => {
    const life = await seedLife();
    const first = await addRow(life, { version: 10, level: 1 });
    const second = await addRow(life, { version: 10, level: 2 });
    const l = listen(life);
    const holder = await pool.connect();
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT 1 FROM proficiency_outbox WHERE outbox_id = $1 FOR UPDATE', [
        first,
      ]);
      const p = publisher(natsPush, 1);
      expect(await p.drainOnce()).toBe(1);
      expect(await isPublished(second)).toBe(true);
      expect(await isPublished(first)).toBe(false);
      await holder.query('ROLLBACK');
      expect(await p.drainOnce()).toBe(1);
      expect(await isPublished(first)).toBe(true);
      await p.stop();
    } finally {
      holder.release();
    }
    await waitFor(() => l.bodies.length >= 2);
    expect(l.bodies).toEqual([body(life, 2, 10), body(life, 1, 10)]);
    l.close();
  });

  it('two concurrent publishers each claim a different row: two rows, each published once', async () => {
    const life = await seedLife();
    const a = await addRow(life, { version: 10, level: 1 });
    const b = await addRow(life, { version: 10, level: 2 });
    const l = listen(life);
    const p1 = publisher(natsPush, 1);
    const p2 = publisher(natsPush, 1);
    expect(await Promise.all([p1.drainOnce(), p2.drainOnce()])).toEqual([1, 1]);
    expect(await isPublished(a)).toBe(true);
    expect(await isPublished(b)).toBe(true);
    await waitFor(() => l.bodies.length >= 2);
    expect(l.bodies.toSorted()).toEqual([body(life, 1, 10), body(life, 2, 10)].toSorted());
    await p1.stop();
    await p2.stop();
    l.close();
  });

  it('a payload failing the contract is logged and left unpublished, not deleted; later rows still go out', async () => {
    const life = await seedLife();
    // A domain no contract accepts, unique per run so a rerun on the same database cannot collide with it.
    const bogus = await addRow(life, { version: 10, domain: `bogus${Date.now().toString(36)}` });
    bogusIds.push(bogus);
    const good = await addRow(life, { version: 11 });
    const l = listen(life);
    logs.length = 0;
    const p = publisher(natsPush);
    expect(await p.drainOnce()).toBe(1);
    expect(logs).toEqual([`outbox_rejected outbox_id=${bogus} total=1`]);
    expect(await isPublished(bogus)).toBe(false);
    const { rows } = await pool.query('SELECT 1 FROM proficiency_outbox WHERE outbox_id = $1', [
      bogus,
    ]);
    expect(rows).toHaveLength(1);
    expect(await isPublished(good)).toBe(true);
    await waitFor(() => l.bodies.length >= 1);
    expect(l.bodies).toEqual([body(life, 1, 11)]);
    await p.stop();
    l.close();
  });

  it('a row below a published version for the same life and domain is marked, not pushed', async () => {
    const life = await seedLife();
    const high = await addRow(life, { version: 10, level: 1 });
    const l = listen(life);
    const p = publisher(natsPush);
    expect(await p.drainOnce()).toBe(1);
    const stale = await addRow(life, { version: 9, level: 2 });
    expect(await p.drainOnce()).toBe(0);
    expect(await isPublished(high)).toBe(true);
    expect(await isPublished(stale)).toBe(true);
    await waitFor(() => l.bodies.length >= 1);
    expect(l.bodies).toEqual([body(life, 1, 10)]);
    await p.stop();
    l.close();
  });

  it('rows go out in outbox_id order, and a row left by a stopped publisher is published once by the next', async () => {
    const life = await seedLife();
    await addRow(life, { version: 10, level: 1 });
    await addRow(life, { version: 20, level: 2 });
    const l = listen(life);
    const stopped = publisher(natsPush);
    await stopped.stop();
    const next = publisher(natsPush);
    expect(await next.drainOnce()).toBe(2);
    expect(await next.drainOnce()).toBe(0);
    await waitFor(() => l.bodies.length >= 2);
    expect(l.bodies).toEqual([body(life, 1, 10), body(life, 2, 20)]);
    await next.stop();
    l.close();
  });
});
