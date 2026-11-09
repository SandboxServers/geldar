/** Writes events to Postgres, idempotently. */
import type { WorldEvent } from '@geldar/contract';
import type { Pool } from 'pg';
import { isProjected, pgProjectionStore, projectEvent } from './projection.ts';

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

/**
 * True for a Postgres error that retrying cannot fix: SQLSTATE class 22 (data exception, such as a
 * NUL in jsonb or an out-of-range integer) or 23 (integrity constraint). Connection and timeout
 * errors are not permanent.
 */
export function isPermanentDbError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && /^(22|23)/.test(code);
}

/** Binds the event columns of a batch for INSERT_SQL. */
function insertParams(events: readonly WorldEvent[]): unknown[] {
  return [
    events.map((e) => e.source_event_id),
    events.map((e) => e.at),
    events.map((e) => e.world_day),
    events.map((e) => String(e.world_tick)),
    events.map((e) => e.type),
    events.map((e) => e.agent_id ?? null),
    events.map((e) => e.thinker_id ?? null),
    events.map((e) => JSON.stringify(e.payload)),
  ];
}

/**
 * The Postgres-backed writer. A single INSERT is atomic, so the batch is all or nothing. A batch
 * holding `intent`, `action` or `receipt` events runs in one transaction: the INSERT, then the
 * projection of those events into their tables (see projection.ts), in batch order.
 */
export function pgEventWriter(pool: Pool): EventWriter {
  return {
    async insertBatch(events) {
      if (events.length === 0) return;
      if (!events.some(isProjected)) {
        await pool.query(INSERT_SQL, insertParams(events));
        return;
      }
      const client = await pool.connect();
      // A client whose ROLLBACK failed may still hold the open transaction: destroy it, not pool it.
      let broken = false;
      try {
        await client.query('BEGIN');
        await client.query(INSERT_SQL, insertParams(events));
        const store = pgProjectionStore(client);
        for (const event of events) await projectEvent(event, store);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {
          broken = true;
        });
        throw error;
      } finally {
        client.release(broken);
      }
    },
  };
}
