// The Adam report against a real Postgres. Runs only with GELDAR_IT=1 (ops runs it with the secrets
// junction). Each run creates its own database, migrates it with migrations 0001-0004 and drops it.
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { absorbIdleErrors } from '../../../threshold/mcp/test/it/scratch-db.ts';
import { migrate } from '../../migrate/src/migrate.ts';
import { loadRunData, type PgConfig, pgClientFactory } from '../src/db.ts';
import { computeReport } from '../src/report.ts';
import { criteria, MIN_MS, manifest, T0 } from './fixture.ts';

const enabled = process.env.GELDAR_IT === '1';
const LIFE = 'ag_report_it';
const DB = `geldar_it_${randomBytes(6).toString('hex')}`;
const SQL_DIR = fileURLToPath(new URL('../../../sql', import.meta.url));
const at = (minutes: number): Date => new Date(T0 + minutes * MIN_MS);

/** The admin login (user geldar) on one database. The password is read only when the case runs. */
function adminConfig(database: string): PgConfig {
  return {
    host: process.env.POSTGRES_HOST ?? '127.0.0.1',
    port: Number(process.env.POSTGRES_PORT ?? 5432),
    database,
    user: 'geldar',
    password: readFileSync(
      new URL('../../../compose/secrets/postgres.txt', import.meta.url),
      'utf8',
    ).trim(),
  };
}

/** One life: three thoughts (the last not called), an intent with no called thought in its ticks, a bed placement, a sleep and a death. */
async function seed(pool: Pool): Promise<void> {
  await pool.query(
    "INSERT INTO mcp_owners (owner_id, display, player_cap) VALUES ('it-report-own', 'It', 3)",
  );
  await pool.query(
    `INSERT INTO agents (agent_id, name, life_seq, game_account, shard, mode, owner, harness,
       declared_model, model_config, tier, personality_seed)
     VALUES ($1, 'It', 1, 'report-it-life', 'phaseit', 'sovereign', 'it-report-own', 'it-on',
       'self-reported', 'declared:unverified', 'sovereign', NULL)`,
    [LIFE],
  );
  const called = '[{"role":"user","content":"look"}]';
  const thoughts: [string, number, number, string, string | null, string | null, number | null][] =
    [
      [
        'th-it-1',
        0,
        100,
        '{"hunger":18,"held_item":null,"inventory":[]}',
        called,
        '{"intent":"mine"}',
        1200,
      ],
      [
        'th-it-2',
        1,
        1300,
        '{"hunger":17,"held_item":"stone_pickaxe","inventory":[]}',
        called,
        '{"intent":"mine"}',
        2400,
      ],
      ['th-it-3', 2, 2600, '{"hunger":16,"held_item":null,"inventory":[]}', null, null, null],
    ];
  for (const [id, minute, tick, snap, input, parsed, latency] of thoughts) {
    await pool.query(
      `INSERT INTO thoughts (thought_id, life_id, at, world_day, world_tick, wake_reason, snapshot,
         model_input, parsed, raw_output, latency_ms)
       VALUES ($1, $2, $3, 0, $4, 'timer', $5::jsonb, $6::jsonb, $7::jsonb, $8, $9)`,
      [id, LIFE, at(minute), tick, `{"self":${snap}}`, input, parsed, parsed, latency],
    );
  }
  await pool.query(
    `INSERT INTO intents (intent_id, life_id, body_generation, thought_id, state, started_tick, ended_tick)
     VALUES ('in-it-1', $1, 1, 'th-it-3', 'completed', 2000, 2700)`,
    [LIFE],
  );
  await pool.query(
    `INSERT INTO actions (action_id, intent_id, life_id, body_generation, sequence, kind, args, state)
     VALUES ('ac-it-bed', 'in-it-1', $1, 1, 1, 'place', '{"block":"red_bed"}'::jsonb, 'completed')`,
    [LIFE],
  );
  await pool.query(
    `INSERT INTO receipts (receipt_id, action_id, life_id, kind, phase, at) VALUES
       ('rc-it-1', 'ac-it-bed', $1, 'place', 'prepared', $2),
       ('rc-it-2', 'ac-it-bed', $1, 'place', 'committed', $2)`,
    [LIFE, at(2)],
  );
  await pool.query(
    `INSERT INTO events (source_event_id, at, world_day, world_tick, type, agent_id, payload) VALUES
       ('ev-it-sleep', $1, 0, 1300, 'sleep', $3, '{"secret":"never read"}'::jsonb),
       ('ev-it-death', $2, 0, 2800, 'death', $3, '{"cause":"never read"}'::jsonb)`,
    [at(1), at(3), LIFE],
  );
}

describe.skipIf(!enabled)('the Adam report against Postgres (GELDAR_IT)', () => {
  let admin: Pool | undefined;
  let pool: Pool | undefined;

  beforeAll(async () => {
    admin = absorbIdleErrors(new Pool({ ...adminConfig('postgres'), max: 1 }));
    await admin.query(`CREATE DATABASE ${DB}`);
    pool = absorbIdleErrors(new Pool({ ...adminConfig(DB), max: 2 }));
    await migrate(pool, { sqlDir: SQL_DIR, dryRun: false, log: () => undefined });
    await seed(pool);
  });

  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
    await admin?.end();
  });

  it('loads one life through the read-only path and computes the verdicts', async () => {
    const data = await loadRunData(pgClientFactory(adminConfig(DB)), {
      lifeId: LIFE,
      from: at(-60),
      to: at(60),
    });
    expect(data.thoughts).toHaveLength(3);
    expect(data.events.map((e) => e.type).sort()).toEqual(['death', 'sleep']);

    const report = computeReport({
      manifest: manifest({ lifeId: LIFE, runId: 'run-it' }),
      criteria: criteria({ maxGapSeconds: 600 }),
      data,
    });
    const measure = (id: string) => report.measures.find((m) => m.id === id);
    expect(report.window.thoughtRows).toBe(3);
    expect(measure('survival')?.verdict).toBe('FAIL');
    expect(measure('survival')?.note).toMatch(/^the life ended by death at .+ inside the window;/);
    expect(measure('intents')?.verdict).toBe('FAIL');
    expect(measure('intents')?.note).toBe('1 against a minimum of 3');
    expect(measure('receipts')?.verdict).toBe('UNKNOWN');
    expect(measure('continuity')?.verdict).toBe('FAIL');
  });

  it('the loader connection cannot write: an INSERT in its read-only transaction fails', async () => {
    const client = pgClientFactory(adminConfig(DB))();
    await client.connect();
    try {
      await client.query('BEGIN READ ONLY');
      await expect(
        client.query("INSERT INTO mcp_owners (owner_id, display) VALUES ('it-denied', 'x')"),
      ).rejects.toThrow(/read-only/);
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      await client.end();
    }
  });
});
