import type { Journal, JournalEntry, SuppressedWakeup, ThoughtRow } from '../ports/index.ts';
import type { SqlClient } from './pg-store.ts';

const json = (value: unknown): string | null => (value === null ? null : JSON.stringify(value));

/** The `Journal` over Postgres: the `thoughts` and `suppressed_wakeups` tables. */
export class PgJournal implements Journal {
  private readonly db: SqlClient;

  constructor(db: SqlClient) {
    this.db = db;
  }

  async recordThought(row: ThoughtRow): Promise<void> {
    await this.db.query(
      `INSERT INTO thoughts (thought_id, life_id, at, world_day, world_tick, wake_reason, snapshot,
         model_input, prompt_template_version, schema_version, mind_version, body_version,
         model_config, thinker_id, effort, tokens_in_estimated, tokens_out_estimated,
         provider_usage, raw_output, parsed, latency_ms, credits_reserved, credits_settled)
       VALUES ($1, $2, $3::timestamptz, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11, $12, $13,
         $14, $15, $16, $17, $18::jsonb, $19, $20::jsonb, $21, $22, $23)
       ON CONFLICT (thought_id) DO NOTHING`,
      [
        row.thoughtId,
        row.lifeId,
        row.at,
        row.worldDay,
        row.worldTick,
        row.wakeReason,
        json(row.snapshot),
        json(row.modelInput),
        row.promptTemplateVersion,
        row.schemaVersion,
        row.mindVersion,
        row.bodyVersion,
        row.modelConfig,
        row.thinkerId,
        row.effort,
        row.tokensInEstimated,
        row.tokensOutEstimated,
        json(row.providerUsage),
        row.rawOutput,
        json(row.parsed),
        row.latencyMs,
        row.creditsReserved,
        row.creditsSettled,
      ],
    );
  }

  async recordSuppressed(row: SuppressedWakeup): Promise<void> {
    await this.db.query(
      `INSERT INTO suppressed_wakeups (life_id, at, event_types, reason, intent_id)
       VALUES ($1, $2::timestamptz, $3::text[], $4, $5)`,
      [row.lifeId, row.at, row.eventTypes, row.reason, row.intentId],
    );
  }

  async linkIntent(lifeId: string, intentId: string, thoughtId: string): Promise<boolean> {
    // One statement: set the link when empty; true also when it already names this thought.
    const result = await this.db.query(
      `UPDATE intents SET thought_id = COALESCE(thought_id, $1)
       WHERE intent_id = $2 AND life_id = $3 AND (thought_id IS NULL OR thought_id = $1)`,
      [thoughtId, intentId, lifeId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async lastReflectionTick(lifeId: string): Promise<number> {
    // A reflection counts once it parsed and its day is no later than the life's last sleep: a
    // failed one never sets `last_sleep_day` (`reflection/apply.ts`), so it does not count.
    const result = await this.db.query(
      `SELECT COALESCE(MAX(t.world_tick), 0) AS tick FROM thoughts t
       JOIN agents a ON a.agent_id = t.life_id
       WHERE t.life_id = $1 AND t.wake_reason = 'reflection' AND t.parsed IS NOT NULL
         AND t.world_day <= a.last_sleep_day`,
      [lifeId],
    );
    return Number(result.rows[0]?.tick ?? 0);
  }

  async journalSince(lifeId: string, tick: number, limit?: number): Promise<JournalEntry[]> {
    // The newest $3 rows (all of them when $3 is null), returned oldest first.
    const result = await this.db.query(
      `SELECT * FROM (
         SELECT thought_id, world_day, world_tick, wake_reason, parsed, at FROM thoughts
         WHERE life_id = $1 AND world_tick >= $2
         ORDER BY world_tick DESC, at DESC, thought_id DESC LIMIT $3
       ) newest ORDER BY world_tick, at, thought_id`,
      [lifeId, tick, limit ?? null],
    );
    return result.rows.map((r) => ({
      thoughtId: r.thought_id,
      worldDay: Number(r.world_day),
      worldTick: Number(r.world_tick),
      wakeReason: r.wake_reason,
      // A reflection row keeps a reflection in `parsed`; the journal shows thoughts only.
      parsed: r.wake_reason === 'reflection' ? null : (r.parsed ?? null),
    }));
  }
}
