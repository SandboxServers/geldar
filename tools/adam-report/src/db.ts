import { readFileSync } from 'node:fs';
import pg from 'pg';
import { toLiteSnapshot } from './snapshot.ts';
import type { ActionRow, EventRow, IntentRow, ReceiptRow, RunData, ThoughtRow } from './types.ts';

/** The part of a pg client the loader uses. A test passes a fake that implements the same three methods. */
export interface QueryClient {
  connect(): Promise<void>;
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  end(): Promise<void>;
}

export type ClientFactory = () => QueryClient;

/** The life to read and the query window. The window applies to thoughts and events (both carry a time). */
export interface LoadWindow {
  lifeId: string;
  from: Date;
  to: Date;
}

// Every statement names its columns. Nothing reads model_input, raw_output or provider_usage: the
// loader derives the booleans it needs in SQL, so the prompts never leave Postgres.
const THOUGHTS_SQL = `SELECT thought_id, at, world_day, world_tick, wake_reason, snapshot,
  model_input IS NOT NULL AS called,
  parsed IS NOT NULL AS parsed_ok,
  (model_input IS NOT NULL AND raw_output IS NULL) AS errored,
  latency_ms
  FROM thoughts WHERE life_id = $1 AND at >= $2 AND at <= $3 ORDER BY at, thought_id`;
const INTENTS_SQL = `SELECT intent_id, state, started_tick, ended_tick, end_reason
  FROM intents WHERE life_id = $1 ORDER BY intent_id`;
const ACTIONS_SQL = `SELECT action_id, intent_id, body_generation, state, kind,
  CASE WHEN kind = 'place' THEN args->>'block' END AS place_block
  FROM actions WHERE life_id = $1 ORDER BY action_id`;
const RECEIPTS_SQL = `SELECT action_id, phase, at FROM receipts
  WHERE life_id = $1 AND at IS NOT NULL ORDER BY receipt_id`;
// Only the columns the grant to geldar_glass covers (W6-09 excludes payload). source_event_id is unique, so it orders the rows.
export const EVENTS_SQL = `SELECT type, world_day, at FROM events
  WHERE agent_id = $1 AND type IN ('death', 'sleep') AND at >= $2 AND at <= $3 ORDER BY at, source_event_id`;

const BEGIN_READ_ONLY = 'BEGIN READ ONLY';

const toMs = (v: unknown): number => (v instanceof Date ? v.getTime() : Date.parse(String(v)));
const toInt = (v: unknown): number => Number(v);
const nullableInt = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number(v);
const nullableText = (v: unknown): string | null =>
  v === null || v === undefined ? null : String(v);

function thoughtRow(r: Record<string, unknown>): ThoughtRow {
  return {
    thoughtId: String(r.thought_id),
    atMs: toMs(r.at),
    day: toInt(r.world_day),
    tick: toInt(r.world_tick),
    wakeReason: String(r.wake_reason ?? ''),
    called: r.called === true,
    parsedOk: r.parsed_ok === true,
    errored: r.errored === true,
    latencyMs: nullableInt(r.latency_ms),
    snapshot: toLiteSnapshot(r.snapshot),
  };
}

function intentRow(r: Record<string, unknown>): IntentRow {
  return {
    intentId: String(r.intent_id),
    state: String(r.state),
    startedTick: nullableInt(r.started_tick),
    endedTick: nullableInt(r.ended_tick),
    endReason: nullableText(r.end_reason),
  };
}

function actionRow(r: Record<string, unknown>): ActionRow {
  return {
    actionId: String(r.action_id),
    intentId: nullableText(r.intent_id),
    bodyGeneration: nullableInt(r.body_generation),
    state: String(r.state),
    kind: String(r.kind),
    placeBlock: nullableText(r.place_block),
  };
}

function receiptRow(r: Record<string, unknown>): ReceiptRow {
  return { actionId: String(r.action_id), phase: String(r.phase), atMs: toMs(r.at) };
}

function eventRow(r: Record<string, unknown>): EventRow {
  return { type: String(r.type), day: toInt(r.world_day), atMs: toMs(r.at) };
}

async function readRows(
  client: QueryClient,
  win: LoadWindow,
  signal?: AbortSignal,
): Promise<RunData> {
  const run = async (text: string, values: unknown[]): Promise<Record<string, unknown>[]> => {
    signal?.throwIfAborted();
    return (await client.query(text, values)).rows;
  };
  const span = [win.lifeId, win.from, win.to];
  const thoughts = (await run(THOUGHTS_SQL, span)).map(thoughtRow);
  const intents = (await run(INTENTS_SQL, [win.lifeId])).map(intentRow);
  const actions = (await run(ACTIONS_SQL, [win.lifeId])).map(actionRow);
  const receipts = (await run(RECEIPTS_SQL, [win.lifeId])).map(receiptRow);
  const events = (await run(EVENTS_SQL, span)).map(eventRow);
  return { thoughts, intents, actions, receipts, events };
}

/**
 * Reads one life in one read-only transaction. The client is closed on every path: success, a
 * query error, a failed BEGIN, or an abort. A failed read is rolled back before the error rethrows.
 */
export async function loadRunData(
  factory: ClientFactory,
  win: LoadWindow,
  signal?: AbortSignal,
): Promise<RunData> {
  const client = factory();
  try {
    await client.connect();
    await client.query(BEGIN_READ_ONLY);
    try {
      const data = await readRows(client, win, signal);
      await client.query('COMMIT');
      return data;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    }
  } finally {
    // A close error must not hide the error that is already propagating.
    await client.end().catch(() => undefined);
  }
}

export interface PgConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

/**
 * Reads the connection from the environment. Names: POSTGRES_HOST, POSTGRES_PORT (5432),
 * POSTGRES_DB, GELDAR_REPORT_DB_USER (geldar_glass), and the password from
 * GELDAR_REPORT_DB_PASSWORD_FILE or GELDAR_REPORT_DB_PASSWORD. Errors name a variable, never its value.
 */
export function pgConfigFromEnv(env: NodeJS.ProcessEnv): PgConfig {
  const need = (name: string): string => {
    const v = env[name];
    if (v === undefined || v === '') throw new Error(`environment variable ${name} is not set`);
    return v;
  };
  let password = env.GELDAR_REPORT_DB_PASSWORD ?? '';
  if (env.GELDAR_REPORT_DB_PASSWORD_FILE)
    password = readFileSync(env.GELDAR_REPORT_DB_PASSWORD_FILE, 'utf8').trim();
  if (password === '')
    throw new Error('set GELDAR_REPORT_DB_PASSWORD or GELDAR_REPORT_DB_PASSWORD_FILE');
  return {
    host: need('POSTGRES_HOST'),
    port: Number(env.POSTGRES_PORT ?? '5432'),
    database: need('POSTGRES_DB'),
    user: env.GELDAR_REPORT_DB_USER ?? 'geldar_glass',
    password,
  };
}

/** A factory of real pg clients for one configuration. */
export function pgClientFactory(config: PgConfig): ClientFactory {
  return () => {
    const client = new pg.Client(config);
    return {
      connect: async () => {
        await client.connect();
      },
      query: async (text, values) => ({
        rows: (await client.query(text, values)).rows as Record<string, unknown>[],
      }),
      end: () => client.end(),
    };
  };
}
