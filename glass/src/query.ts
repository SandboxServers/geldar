/**
 * Every SQL statement Glass runs. Values go in the parameter array, never into the text, and the
 * statements read only the five tables migration 0005 grants to `geldar_glass`. query.test.ts
 * fails when a statement names any other table.
 */

/** The one method Glass needs from a Postgres client (pg's Pool and Client both satisfy it). */
export interface SqlClient {
  query(text: string, values: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

/** A row as the API returns it. Every text field may hold agent-authored text: it is data. */
export type Row = Record<string, unknown>;

/** The position of a thought in newest-first order: its time and its id. */
export interface ThoughtCursor {
  at: string;
  id: string;
}

export interface ThoughtFilter {
  lifeId?: string | undefined;
  tier?: string | undefined;
  outcome?: 'parsed' | 'unparsed' | undefined;
  since?: string | undefined;
  before?: ThoughtCursor | undefined;
  limit: number;
}

/** Lists the agents. Owner, harness and model config are left out: they are not what Glass shows. */
export async function listAgents(db: SqlClient): Promise<Row[]> {
  const result = await db.query(
    `SELECT agent_id, name, life_seq, shard, mode, tier, born_day, died_at, death_cause
       FROM agents ORDER BY agent_id LIMIT 500`,
    [],
  );
  return result.rows;
}

/** Lists thoughts, newest first, one page at a time. Each filter is optional. */
export async function listThoughts(db: SqlClient, filter: ThoughtFilter): Promise<Row[]> {
  const result = await db.query(
    `SELECT t.thought_id, t.life_id, t.at, t.at::text AS cursor_at, t.world_day, t.world_tick,
            t.wake_reason, t.prompt_template_version, t.latency_ms, t.parsed, a.tier, a.name
       FROM thoughts t LEFT JOIN agents a ON a.agent_id = t.life_id
      WHERE ($1::text IS NULL OR t.life_id = $1)
        AND ($2::text IS NULL OR a.tier = $2)
        AND ($3::text IS NULL OR ($3 = 'parsed' AND t.parsed IS NOT NULL)
                              OR ($3 = 'unparsed' AND t.parsed IS NULL))
        AND ($4::timestamptz IS NULL OR t.at >= $4)
        AND ($5::timestamptz IS NULL OR (t.at, t.thought_id) < ($5::timestamptz, $6::text))
      ORDER BY t.at DESC, t.thought_id DESC
      LIMIT $7`,
    [
      filter.lifeId ?? null,
      filter.tier ?? null,
      filter.outcome ?? null,
      filter.since ?? null,
      filter.before?.at ?? null,
      filter.before?.id ?? '',
      filter.limit,
    ],
  );
  return result.rows;
}

/** One thought with the complete model input (the caller caps it). Null when there is none. */
export async function getThought(db: SqlClient, thoughtId: string): Promise<Row | null> {
  const result = await db.query(
    `SELECT t.thought_id, t.life_id, t.at, t.world_day, t.world_tick, t.wake_reason,
            t.prompt_template_version, t.schema_version, t.model_config, t.latency_ms,
            t.parsed, t.raw_output, t.model_input::text AS model_input, a.tier, a.name
       FROM thoughts t LEFT JOIN agents a ON a.agent_id = t.life_id
      WHERE t.thought_id = $1`,
    [thoughtId],
  );
  return result.rows[0] ?? null;
}

/** The receipts of one action, oldest first (prepared before committed or aborted). */
export async function listReceipts(db: SqlClient, actionId: string): Promise<Row[]> {
  const result = await db.query(
    `SELECT receipt_id, action_id, life_id, kind, phase, item, count, credits, at, detail
       FROM receipts WHERE action_id = $1 ORDER BY at, phase LIMIT 100`,
    [actionId],
  );
  return result.rows;
}

/** The cursor a new stream starts from: the database's clock now, so only later thoughts arrive. */
export async function streamStartCursor(db: SqlClient): Promise<ThoughtCursor> {
  const result = await db.query(`SELECT now()::text AS at`, []);
  return { at: String(result.rows[0]?.at ?? ''), id: '' };
}

/** Thoughts after a cursor, oldest first, at most `limit`. The stream calls this on each poll. */
export async function thoughtsAfter(
  db: SqlClient,
  after: ThoughtCursor,
  limit: number,
): Promise<Row[]> {
  const result = await db.query(
    `SELECT t.thought_id, t.life_id, t.at, t.at::text AS cursor_at, t.wake_reason, t.parsed,
            a.tier, a.name
       FROM thoughts t LEFT JOIN agents a ON a.agent_id = t.life_id
      WHERE t.at IS NOT NULL AND (t.at, t.thought_id) > ($1::timestamptz, $2::text)
      ORDER BY t.at, t.thought_id
      LIMIT $3`,
    [after.at, after.id, limit],
  );
  return result.rows;
}
