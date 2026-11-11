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

/**
 * What a reader may see. `shownUntil` is the newest thought time Glass shows (the delay, 0072 item 5);
 * null shows every thought. `showLivingSovereign` false hides the thoughts and receipts of a sovereign
 * agent that is still alive (0072 item 4); a dead sovereign agent and a house agent always show.
 */
export interface Visibility {
  shownUntil: string | null;
  showLivingSovereign: boolean;
}

/** No delay, living sovereign agents hidden. A caller with a policy passes `visibilityAt(policy)`. */
export const DEFAULT_VISIBILITY: Visibility = { shownUntil: null, showLivingSovereign: false };

export interface ThoughtFilter {
  lifeId?: string | undefined;
  tier?: string | undefined;
  outcome?: 'parsed' | 'unparsed' | undefined;
  since?: string | undefined;
  before?: ThoughtCursor | undefined;
  limit: number;
}

/**
 * Lists the agents. Owner, harness and model config are left out: they are not what Glass shows.
 * A living sovereign agent is left out too unless the visibility shows it (0072 item 4): its name
 * is as private as its thoughts.
 */
export async function listAgents(
  db: SqlClient,
  shown: Visibility = DEFAULT_VISIBILITY,
): Promise<Row[]> {
  const result = await db.query(
    `SELECT a.agent_id, a.name, a.life_seq, a.shard, a.mode, a.tier, a.born_day, a.died_at,
            a.death_cause
       FROM agents a
      WHERE ($1::boolean OR a.mode IS DISTINCT FROM 'sovereign' OR a.died_at IS NOT NULL)
      ORDER BY a.agent_id LIMIT 500`,
    [shown.showLivingSovereign],
  );
  return result.rows;
}

/** Lists thoughts, newest first, one page at a time. Each filter is optional. */
export async function listThoughts(
  db: SqlClient,
  filter: ThoughtFilter,
  shown: Visibility = DEFAULT_VISIBILITY,
): Promise<Row[]> {
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
        AND ($8::boolean OR a.mode IS DISTINCT FROM 'sovereign' OR a.died_at IS NOT NULL)
        AND ($9::timestamptz IS NULL OR t.at <= $9::timestamptz)
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
      shown.showLivingSovereign,
      shown.shownUntil,
    ],
  );
  return result.rows;
}

/** One thought. The prompt and the raw reply are not selected: they are not public (R21). */
export async function getThought(
  db: SqlClient,
  thoughtId: string,
  shown: Visibility = DEFAULT_VISIBILITY,
): Promise<Row | null> {
  const result = await db.query(
    `SELECT t.thought_id, t.life_id, t.at, t.world_day, t.world_tick, t.wake_reason,
            t.prompt_template_version, t.schema_version, t.model_config, t.latency_ms,
            t.parsed, a.tier, a.name
       FROM thoughts t LEFT JOIN agents a ON a.agent_id = t.life_id
      WHERE t.thought_id = $1
        AND ($2::boolean OR a.mode IS DISTINCT FROM 'sovereign' OR a.died_at IS NOT NULL)
        AND ($3::timestamptz IS NULL OR t.at <= $3::timestamptz)`,
    [thoughtId, shown.showLivingSovereign, shown.shownUntil],
  );
  return result.rows[0] ?? null;
}

/** The receipts of one action, oldest first (prepared before committed or aborted), no newer than the cut-off. */
export async function listReceipts(
  db: SqlClient,
  actionId: string,
  shown: Visibility = DEFAULT_VISIBILITY,
): Promise<Row[]> {
  const result = await db.query(
    `SELECT r.receipt_id, r.action_id, r.life_id, r.kind, r.phase, r.item, r.count, r.credits, r.at,
            r.detail
       FROM receipts r LEFT JOIN agents a ON a.agent_id = r.life_id
      WHERE r.action_id = $1
        AND ($2::boolean OR a.mode IS DISTINCT FROM 'sovereign' OR a.died_at IS NOT NULL)
        AND ($3::timestamptz IS NULL OR r.at <= $3::timestamptz)
      ORDER BY r.at, r.phase LIMIT 100`,
    [actionId, shown.showLivingSovereign, shown.shownUntil],
  );
  return result.rows;
}

/**
 * The cursor a new stream starts from: the database's clock now minus the public delay, so a thought
 * still hidden by the delay arrives once it is old enough, and a thought already shown is not replayed.
 */
export async function streamStartCursor(
  db: SqlClient,
  delaySeconds: number,
): Promise<ThoughtCursor> {
  const result = await db.query(`SELECT (now() - make_interval(secs => $1::int))::text AS at`, [
    Math.max(0, Math.floor(delaySeconds)),
  ]);
  return { at: String(result.rows[0]?.at ?? ''), id: '' };
}

/** Thoughts after a cursor, oldest first, at most `limit`. The stream calls this on each poll. */
export async function thoughtsAfter(
  db: SqlClient,
  after: ThoughtCursor,
  limit: number,
  shown: Visibility = DEFAULT_VISIBILITY,
): Promise<Row[]> {
  const result = await db.query(
    `SELECT t.thought_id, t.life_id, t.at, t.at::text AS cursor_at, t.wake_reason, t.parsed,
            a.tier, a.name
       FROM thoughts t LEFT JOIN agents a ON a.agent_id = t.life_id
      WHERE t.at IS NOT NULL AND (t.at, t.thought_id) > ($1::timestamptz, $2::text)
        AND ($4::boolean OR a.mode IS DISTINCT FROM 'sovereign' OR a.died_at IS NOT NULL)
        AND ($5::timestamptz IS NULL OR t.at <= $5::timestamptz)
      ORDER BY t.at, t.thought_id
      LIMIT $3`,
    [after.at, after.id, limit, shown.showLivingSovereign, shown.shownUntil],
  );
  return result.rows;
}
