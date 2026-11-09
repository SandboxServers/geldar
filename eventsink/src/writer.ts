/** Writes events to Postgres, idempotently. */
import type { WorldEvent } from '@geldar/contract';
import type { Pool } from 'pg';

/** What the consumer needs from the database; tests substitute a fake. */
export interface EventWriter {
  /** Inserts the events in one transaction; rows whose `source_event_id` exists are skipped. Rejects on any DB error. */
  insertBatch(events: readonly WorldEvent[]): Promise<void>;
}

/**
 * One statement for the whole batch: the arrays are unnested into rows.
 * `ON CONFLICT DO NOTHING` makes redelivery (and duplicates inside one batch) harmless.
 */
const INSERT_SQL = `
INSERT INTO events (source_event_id, at, world_day, world_tick, type, agent_id, thinker_id, payload)
SELECT * FROM unnest(
  $1::text[], $2::timestamptz[], $3::int[], $4::bigint[], $5::text[], $6::text[], $7::text[], $8::jsonb[]
)
ON CONFLICT (source_event_id) DO NOTHING`;

/** The Postgres-backed writer. A single INSERT is atomic, so the batch is all or nothing. */
export function pgEventWriter(pool: Pool): EventWriter {
  return {
    async insertBatch(events) {
      if (events.length === 0) return;
      await pool.query(INSERT_SQL, [
        events.map((e) => e.source_event_id),
        events.map((e) => e.at),
        events.map((e) => e.world_day),
        events.map((e) => String(e.world_tick)),
        events.map((e) => e.type),
        events.map((e) => e.agent_id ?? null),
        events.map((e) => e.thinker_id ?? null),
        events.map((e) => JSON.stringify(e.payload)),
      ]);
    },
  };
}
