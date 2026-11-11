/**
 * Glass against a real Postgres: the read-only role, the query layer as that role, the HTTP API and
 * the SSE stream. Skipped unless GELDAR_IT=1. The case makes a scratch database with a random name,
 * migrates it with the repo's runner, gives geldar_glass a throwaway password through the migrate
 * tool's SCRAM builder, and drops the database afterwards, even on failure. The admin password is
 * read from compose/secrets/postgres.txt, as the other integration cases read it. Nothing here is
 * written to the dev database, and no geldar_glass password is printed.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { type IncomingMessage, request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { Pool, type PoolConfig } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate, passwordStatement } from '../../tools/migrate/src/migrate.ts';
import { scramVerifier } from '../../tools/migrate/src/scram.ts';
import { OPEN_POLICY, visibilityAt } from '../src/policy.ts';
import { getThought, listAgents, listReceipts, listThoughts, thoughtsAfter } from '../src/query.ts';
import { buildGlass, type GlassParts } from '../src/server.ts';

const ENABLED = process.env.GELDAR_IT === '1';
const ROLE = 'geldar_glass';
const SQL_DIR = fileURLToPath(new URL('../../sql', import.meta.url));
const POLL_MS = 200;
/** Agent-authored text with markup: the API must return it as JSON data, never as HTML. */
const MARKUP = '<script>alert("glass")</script><img src=x onerror=alert(1)>';
/** Postgres SQLSTATE for insufficient_privilege: a refused column, table or write. */
const DENIED = '42501';

/** Connection settings for one database as the admin login. */
function adminConfig(database: string): PoolConfig {
  return {
    host: process.env.POSTGRES_HOST ?? '127.0.0.1',
    port: Number(process.env.POSTGRES_PORT ?? 5432),
    user: 'geldar',
    password: readFileSync(
      new URL('../../compose/secrets/postgres.txt', import.meta.url),
      'utf8',
    ).trim(),
    database,
  };
}

/** Creates an empty database with a generated name. */
async function createScratch(): Promise<string> {
  const name = `geldar_it_glass_${randomBytes(6).toString('hex')}`;
  const admin = new Pool({ ...adminConfig('postgres'), max: 1 });
  try {
    await admin.query(`CREATE DATABASE ${name}`);
  } finally {
    await admin.end();
  }
  return name;
}

/** Drops a scratch database and any connection still open to it. */
async function dropScratch(name: string): Promise<void> {
  const admin = new Pool({ ...adminConfig('postgres'), max: 1 });
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  } finally {
    await admin.end();
  }
}

/** Sets the geldar_glass login password as a SCRAM verifier; the password never leaves this process. */
async function setGlassPassword(admin: Pool, password: string): Promise<void> {
  const client = await admin.connect();
  try {
    const sql = passwordStatement(ROLE, scramVerifier(password), (value) =>
      client.escapeLiteral(value),
    );
    await client.query(sql);
  } finally {
    client.release();
  }
}

/** Polls a condition until it holds or the time runs out. Returns whether it held. */
async function eventually(check: () => boolean, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return check();
}

/** Runs a query and returns the SQLSTATE it fails with, or null when it succeeds. */
async function failureCode(pool: Pool, sql: string): Promise<string | null> {
  try {
    await pool.query(sql);
    return null;
  } catch (err) {
    return (err as { code?: string }).code ?? 'unknown';
  }
}

describe.skipIf(!ENABLED)('Glass against a real Postgres', () => {
  const password = randomBytes(18).toString('hex');
  const suffix = randomBytes(4).toString('hex');
  const lifeId = `ag_it_glass_${suffix}`;
  const thoughtId = `th_it_glass_${suffix}`;
  let dbName = '';
  let admin: Pool | undefined;
  let glass: GlassParts | undefined;
  /** A second Glass with the default public policy: living sovereign hidden, 60 s delay. */
  let strict: GlassParts | undefined;
  let strictPort = 0;
  const deadId = `ag_it_dead_${suffix}`;
  const houseId = `ag_it_house_${suffix}`;
  const deadThought = `th_it_dead_${suffix}`;
  const houseOld = `th_it_house_old_${suffix}`;
  const houseNew = `th_it_house_new_${suffix}`;
  const livingNew = `th_it_living_new_${suffix}`;
  const actionOld = `ac_it_old_${suffix}`;
  const actionNew = `ac_it_new_${suffix}`;
  const actionLiving = `ac_it_living_${suffix}`;
  let applied: string[] = [];
  let port = 0;

  beforeAll(async () => {
    dbName = await createScratch();
    admin = new Pool({ ...adminConfig(dbName), max: 4 });
    const report = await migrate(admin, { sqlDir: SQL_DIR, dryRun: false, log: () => undefined });
    applied = report.applied;
    await setGlassPassword(admin, password);
    await admin.query(`INSERT INTO mcp_owners (owner_id, display, player_cap) VALUES ($1, $1, 3)`, [
      `it-owner-${suffix}`,
    ]);
    await admin.query(
      `INSERT INTO agents (agent_id, name, life_seq, game_account, shard, mode, owner, harness,
         declared_model, model_config, tier, personality_seed)
       VALUES ($1, 'It', 1, $1, 'phaseit', 'sovereign', $2, 'it-on', 'self-reported',
         'declared:unverified', 'sovereign', 'secret-seed-it')`,
      [lifeId, `it-owner-${suffix}`],
    );
    await admin.query(
      `INSERT INTO thoughts (thought_id, life_id, at, world_day, world_tick, wake_reason, parsed)
       VALUES ($1, $2, now(), 1, 1, 'it', $3::jsonb)`,
      [thoughtId, lifeId, JSON.stringify({ text: MARKUP })],
    );
    const conn = adminConfig(dbName);
    const parts = buildGlass({
      host: '127.0.0.1',
      port: 0,
      pg: {
        host: conn.host ?? '127.0.0.1',
        port: Number(conn.port ?? 5432),
        user: ROLE,
        database: dbName,
        password,
      },
      sseMaxClients: 2,
      sseBufferFrames: 10,
      ssePollMs: POLL_MS,
      enabled: true,
      delaySeconds: 0,
      showLivingSovereign: true,
      trustedProxies: [],
      rateLimit: { perMinute: 60, burst: 20, maxClients: 1024 },
    });
    glass = parts;
    await new Promise<void>((resolve) => parts.server.listen(0, '127.0.0.1', () => resolve()));
    port = (parts.server.address() as AddressInfo).port;
    await seedStrictCases(admin);
    const second = buildGlass({
      host: '127.0.0.1',
      port: 0,
      pg: {
        host: conn.host ?? '127.0.0.1',
        port: Number(conn.port ?? 5432),
        user: ROLE,
        database: dbName,
        password,
      },
      sseMaxClients: 2,
      sseBufferFrames: 10,
      ssePollMs: POLL_MS,
      enabled: true,
      delaySeconds: 60,
      showLivingSovereign: false,
      trustedProxies: [],
      rateLimit: { perMinute: 600, burst: 200, maxClients: 1024 },
    });
    strict = second;
    await new Promise<void>((resolve) => second.server.listen(0, '127.0.0.1', () => resolve()));
    strictPort = (second.server.address() as AddressInfo).port;
  });

  /** A dead sovereign agent, a house agent, and rows older and newer than the 60 s delay. */
  async function seedStrictCases(db: Pool): Promise<void> {
    const insertAgent = (id: string, mode: string, died: boolean) =>
      db.query(
        `INSERT INTO agents (agent_id, name, life_seq, game_account, shard, mode, owner, harness,
           declared_model, model_config, tier, personality_seed, died_at, death_cause)
         VALUES ($1, $1, 1, $1, 'phaseit', $2, $3, 'it-on', 'self-reported',
           'declared:unverified', $2, 'seed-it', $4::timestamptz, $5)`,
        [
          id,
          mode,
          `it-owner-${suffix}`,
          died ? new Date(Date.now() - 3_600_000).toISOString() : null,
          died ? 'it' : null,
        ],
      );
    await insertAgent(deadId, 'sovereign', true);
    await insertAgent(houseId, 'headless', false);
    const insertThought = (id: string, life: string, age: string) =>
      db.query(
        `INSERT INTO thoughts (thought_id, life_id, at, world_day, world_tick, wake_reason, parsed,
           model_input, raw_output)
         VALUES ($1, $2, now() - $3::interval, 1, 3, 'it', '{}'::jsonb, '["secret prompt"]'::jsonb,
           'secret reply')`,
        [id, life, age],
      );
    await insertThought(deadThought, deadId, '2 hours');
    await insertThought(houseOld, houseId, '10 minutes');
    await insertThought(houseNew, houseId, '0 seconds');
    await insertThought(livingNew, lifeId, '10 minutes');
    const insertReceipt = (action: string, life: string, age: string) =>
      db.query(
        `INSERT INTO receipts (receipt_id, action_id, life_id, kind, phase, item, count, credits, at)
         VALUES ($1, $1, $2, 'it', 'committed', 'stone', 1, 2, now() - $3::interval)`,
        [action, life, age],
      );
    await insertReceipt(actionOld, houseId, '10 minutes');
    await insertReceipt(actionNew, houseId, '0 seconds');
    await insertReceipt(actionLiving, lifeId, '10 minutes');
  }

  afterAll(async () => {
    strict?.hub.close();
    strict?.server.close();
    strict?.server.closeAllConnections();
    await strict?.pool.end().catch(() => undefined);
    glass?.hub.close();
    glass?.server.close();
    glass?.server.closeAllConnections();
    await glass?.pool.end().catch(() => undefined);
    await admin?.end().catch(() => undefined);
    if (dbName !== '') await dropScratch(dbName);
  });

  it('applies every migration, 0005 included', () => {
    expect(applied.some((name) => name.startsWith('0005'))).toBe(true);
  });

  it('reads the granted tables and columns as geldar_glass through the query layer', async () => {
    const pool = glass?.pool;
    if (pool === undefined) throw new Error('glass not built');
    const agents = await listAgents(pool, { shownUntil: null, showLivingSovereign: true });
    expect(agents.map((row) => row.agent_id)).toContain(lifeId);
    const thoughts = await listThoughts(
      pool,
      { limit: 10 },
      { shownUntil: null, showLivingSovereign: true },
    );
    expect(thoughts.map((row) => row.thought_id)).toContain(thoughtId);
    const events = await pool.query(
      'SELECT type, agent_id, world_day, world_tick, at, source_event_id FROM events LIMIT 1',
    );
    expect(events.rows.length).toBeLessThanOrEqual(1);
  });

  it('hides the living sovereign agent by default, and shows it when the flag is on', async () => {
    const pool = glass?.pool;
    if (pool === undefined) throw new Error('glass not built');
    const hidden = { shownUntil: null, showLivingSovereign: false };
    const shown = { shownUntil: null, showLivingSovereign: true };
    const ids = async (v: typeof shown) =>
      (await listThoughts(pool, { limit: 100 }, v)).map((row) => row.thought_id);
    expect(await ids(hidden)).not.toContain(thoughtId);
    expect(await ids(shown)).toContain(thoughtId);
    expect(await getThought(pool, thoughtId, hidden)).toBeNull();
    expect(await getThought(pool, thoughtId, shown)).not.toBeNull();
    expect(await listReceipts(pool, 'no-such-action', hidden)).toEqual([]);
  });

  it('the delay cut-off hides a thought newer than the cut-off', async () => {
    const pool = glass?.pool;
    if (pool === undefined) throw new Error('glass not built');
    const old = new Date(Date.now() - 3_600_000).toISOString();
    const late = new Date(Date.now() + 3_600_000).toISOString();
    const ids = async (until: string) =>
      (
        await listThoughts(pool, { limit: 100 }, { shownUntil: until, showLivingSovereign: true })
      ).map((row) => row.thought_id);
    expect(await ids(old)).not.toContain(thoughtId);
    expect(await ids(late)).toContain(thoughtId);
  });

  it('decision 0138: owner live, dead lives public past the delay, opt-in shows a living agent', async () => {
    const pool = glass?.pool;
    if (pool === undefined || admin === undefined) throw new Error('glass not built');
    const cut = new Date(Date.now() - 3 * 3_600_000).toISOString(); // older than every seeded thought
    const ids = async (extra: { ownedAgents?: string[] }) =>
      (
        await listThoughts(
          pool,
          { limit: 100 },
          { shownUntil: cut, showLivingSovereign: false, ...extra },
        )
      ).map((row) => row.thought_id);
    // rule 3: the dead life shows although it is newer than the cut-off
    expect(await ids({})).toContain(deadThought);
    // rule 2: the living sovereign agent and a fresh house agent thought stay hidden from a non-owner
    expect(await ids({})).not.toContain(livingNew);
    expect(await ids({})).not.toContain(houseNew);
    // rule 1: the owner sees the living agent at once; another agent id changes nothing
    expect(await ids({ ownedAgents: [lifeId] })).toContain(livingNew);
    expect(await ids({ ownedAgents: [houseId] })).not.toContain(livingNew);
    // rule 4: the opt-in shows the living agent to everyone, still behind the delay
    await admin.query('UPDATE agents SET thoughts_delayed_public = TRUE WHERE agent_id = $1', [
      lifeId,
    ]);
    const late = new Date(Date.now() + 3_600_000).toISOString();
    const optedIn = await listThoughts(
      pool,
      { limit: 100 },
      { shownUntil: late, showLivingSovereign: false },
    );
    expect(optedIn.map((row) => row.thought_id)).toContain(livingNew);
    expect(await ids({})).not.toContain(livingNew);
    await admin.query('UPDATE agents SET thoughts_delayed_public = FALSE WHERE agent_id = $1', [
      lifeId,
    ]);
  });

  it('refuses events.payload, agents.personality_seed and every table Glass is not granted', async () => {
    const pool = glass?.pool;
    if (pool === undefined) throw new Error('glass not built');
    expect(await failureCode(pool, 'SELECT payload FROM events LIMIT 1')).toBe(DENIED);
    expect(await failureCode(pool, 'SELECT personality_seed FROM agents LIMIT 1')).toBe(DENIED);
    expect(await failureCode(pool, 'SELECT * FROM agents LIMIT 1')).toBe(DENIED);
    expect(await failureCode(pool, 'SELECT * FROM memories LIMIT 1')).toBe(DENIED);
    expect(await failureCode(pool, 'SELECT * FROM mcp_tokens LIMIT 1')).toBe(DENIED);
    expect(await failureCode(pool, 'SELECT * FROM mcp_players LIMIT 1')).toBe(DENIED);
    expect(await failureCode(pool, 'SELECT * FROM mcp_owners LIMIT 1')).toBe(DENIED);
  });

  it('refuses every write to thoughts', async () => {
    const pool = glass?.pool;
    if (pool === undefined) throw new Error('glass not built');
    expect(
      await failureCode(
        pool,
        `INSERT INTO thoughts (thought_id, life_id, at) VALUES ('th_it_w', '${lifeId}', now())`,
      ),
    ).toBe(DENIED);
    expect(await failureCode(pool, `UPDATE thoughts SET wake_reason = 'x'`)).toBe(DENIED);
    expect(await failureCode(pool, 'DELETE FROM thoughts')).toBe(DENIED);
  });

  /** One GET or other-method request to the running Glass; the whole body is read. */
  function send(
    method: string,
    path: string,
  ): Promise<{ status: number; type: string; headers: IncomingMessage['headers']; body: string }> {
    return new Promise((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port, path, method }, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          body += chunk;
        });
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            type: String(res.headers['content-type'] ?? ''),
            headers: res.headers,
            body,
          }),
        );
      });
      req.on('error', reject);
      req.end();
    });
  }

  it('serves the thoughts API as JSON, with the markup returned as data', async () => {
    const reply = await send('GET', '/api/thoughts');
    expect(reply.status).toBe(200);
    expect(reply.type).toMatch(/^application\/json/);
    expect(reply.headers['content-security-policy']).toContain("default-src 'none'");
    expect(reply.headers['x-content-type-options']).toBe('nosniff');
    const parsed = JSON.parse(reply.body) as {
      thoughts: { thought_id: string; parsed: { text: string } }[];
    };
    expect(Array.isArray(parsed.thoughts)).toBe(true);
    const row = parsed.thoughts.find((item) => item.thought_id === thoughtId);
    expect(row?.parsed.text).toBe(MARKUP);
  });

  it('answers every non-GET method with 405', async () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const reply = await send(method, '/api/thoughts');
      expect(reply.status).toBe(405);
    }
  });

  it('streams a new thought within the poll interval, and frees the slot when the client aborts', async () => {
    const hub = glass?.hub;
    if (hub === undefined) throw new Error('glass not built');
    const stream = request({ host: '127.0.0.1', port, path: '/api/stream', method: 'GET' });
    const response = await new Promise<IncomingMessage>((resolve, reject) => {
      stream.on('response', resolve);
      stream.on('error', reject);
      stream.end();
    });
    response.on('error', () => undefined);
    expect(response.statusCode).toBe(200);
    expect(String(response.headers['content-type'])).toMatch(/^text\/event-stream/);
    let received = '';
    response.setEncoding('utf8');
    response.on('data', (chunk: string) => {
      received += chunk;
    });
    expect(await eventually(() => hub.stats().clients === 1, 2000)).toBe(true);
    expect(await eventually(() => hub.stats().polls >= 1, 2000)).toBe(true);

    const streamedId = `th_it_stream_${suffix}`;
    const inserted = Date.now();
    await admin?.query(
      `INSERT INTO thoughts (thought_id, life_id, at, world_day, world_tick, wake_reason, parsed)
       VALUES ($1, $2, clock_timestamp(), 1, 2, 'it', $3::jsonb)`,
      [streamedId, lifeId, JSON.stringify({ text: MARKUP })],
    );
    const arrived = await eventually(() => received.includes(streamedId), POLL_MS * 10);
    expect(arrived).toBe(true);
    expect(Date.now() - inserted).toBeLessThan(POLL_MS * 10);

    stream.destroy();
    expect(await eventually(() => hub.stats().clients === 0, 2000)).toBe(true);
  });

  describe('with the default public policy (living sovereign hidden, 60 s delay)', () => {
    /** One GET to the strict Glass; returns the status and the parsed JSON body. */
    function getStrict(path: string): Promise<{ status: number; json: Record<string, unknown> }> {
      return new Promise((resolve, reject) => {
        const req = request({ host: '127.0.0.1', port: strictPort, path, method: 'GET' }, (res) => {
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (chunk: string) => {
            body += chunk;
          });
          res.on('end', () =>
            resolve({
              status: res.statusCode ?? 0,
              json: JSON.parse(body) as Record<string, unknown>,
            }),
          );
        });
        req.on('error', reject);
        req.end();
      });
    }

    const idsOf = (rows: unknown, key: string): string[] =>
      (rows as Record<string, unknown>[]).map((row) => String(row[key]));

    it('lists the dead sovereign and the house agent, and not the living sovereign', async () => {
      const reply = await getStrict('/api/agents');
      const ids = idsOf(reply.json.agents, 'agent_id');
      expect(ids).toContain(deadId);
      expect(ids).toContain(houseId);
      expect(ids).not.toContain(lifeId);
    });

    it('lists thoughts of a dead sovereign and an old house thought, not newer or living ones', async () => {
      const ids = idsOf((await getStrict('/api/thoughts?limit=100')).json.thoughts, 'thought_id');
      expect(ids).toContain(deadThought);
      expect(ids).toContain(houseOld);
      expect(ids).not.toContain(houseNew);
      expect(ids).not.toContain(livingNew);
      expect(ids).not.toContain(thoughtId);
    });

    it('serves a thought detail only for a shown row, and never the prompt or the raw reply', async () => {
      for (const id of [deadThought, houseOld]) {
        const reply = await getStrict(`/api/thoughts/${id}`);
        expect(reply.status, id).toBe(200);
        const thought = reply.json.thought as Record<string, unknown>;
        expect(thought).not.toHaveProperty('model_input');
        expect(thought).not.toHaveProperty('raw_output');
      }
      for (const id of [houseNew, livingNew]) {
        expect((await getStrict(`/api/thoughts/${id}`)).status, id).toBe(404);
      }
    });

    it('shows the receipt of a house agent after the delay, and hides the newer and the living one', async () => {
      const receipts = async (action: string) =>
        (await getStrict(`/api/receipts?action_id=${action}`)).json.receipts as unknown[];
      expect(await receipts(actionOld)).toHaveLength(1);
      expect(await receipts(actionNew)).toHaveLength(0);
      expect(await receipts(actionLiving)).toHaveLength(0);
    });

    it('thoughtsAfter (the stream query) applies the same sovereign and delay rules', async () => {
      const pool = strict?.pool;
      if (pool === undefined) throw new Error('glass not built');
      const rows = await thoughtsAfter(
        pool,
        { at: '1970-01-01 00:00:00+00', id: '' },
        100,
        visibilityAt({ ...OPEN_POLICY, delaySeconds: 60, showLivingSovereign: false }),
      );
      const ids = idsOf(rows, 'thought_id');
      expect(ids).toContain(deadThought);
      expect(ids).toContain(houseOld);
      expect(ids).not.toContain(houseNew);
      expect(ids).not.toContain(livingNew);
    });

    it('getThought, thoughtsAfter and listReceipts respect a cut-off before and after the row', async () => {
      const pool = strict?.pool;
      if (pool === undefined) throw new Error('glass not built');
      const at = (await admin?.query(`SELECT at FROM thoughts WHERE thought_id = $1`, [houseNew]))
        ?.rows[0]?.at as Date;
      const before = {
        shownUntil: new Date(at.getTime() - 1000).toISOString(),
        showLivingSovereign: false,
      };
      const after = {
        shownUntil: new Date(at.getTime() + 1000).toISOString(),
        showLivingSovereign: false,
      };
      const start = { at: '1970-01-01 00:00:00+00', id: '' };
      expect(await getThought(pool, houseNew, before)).toBeNull();
      expect(await getThought(pool, houseNew, after)).not.toBeNull();
      expect(idsOf(await thoughtsAfter(pool, start, 100, before), 'thought_id')).not.toContain(
        houseNew,
      );
      expect(idsOf(await thoughtsAfter(pool, start, 100, after), 'thought_id')).toContain(houseNew);
      expect(await listReceipts(pool, actionNew, before)).toHaveLength(0);
      expect(await listReceipts(pool, actionNew, after)).toHaveLength(1);
    });
  });
});
