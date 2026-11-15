/** Writes events to Postgres, idempotently. */
import type { WorldEvent } from '@geldar/contract';
import { DEFAULT_THRESHOLDS } from '@geldar/psyche';
import type { Pool } from 'pg';
import { AUDIT_TYPES, projectAudit } from './audit/projection.ts';
import { pgAuditStore } from './audit/store.ts';
import { isProjected, pgProjectionStore, projectEvent } from './projection.ts';
import { awardsFor } from './xp/awards.ts';
import { applyAward } from './xp/ledger.ts';
import { pgXpStore } from './xp/pg-xp-store.ts';
import type { XpThresholds } from './xp/xp-config.ts';

/** XP counting in the writer. `enabled` is xpEnabled(env) from xp-config.ts; off means no award is read. */
export interface XpWriting {
  enabled: boolean;
  thresholds: XpThresholds;
}

const XP_OFF: XpWriting = { enabled: false, thresholds: DEFAULT_THRESHOLDS };

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
INSERT INTO events (source_event_id, at, world_day, world_tick, type, agent_id, thinker_id, payload, harness, model)
SELECT * FROM unnest(
  $1::text[], $2::timestamptz[], $3::int[], $4::bigint[], $5::text[], $6::text[], $7::text[], $8::jsonb[],
  $9::text[], $10::text[]
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
    events.map((e) => e.harness ?? null),
    events.map((e) => e.model ?? null),
  ];
}

/** True for an event whose projection runs in the batch transaction with its INSERT. */
function needsTransaction(event: WorldEvent): boolean {
  return isProjected(event) || AUDIT_TYPES.has(event.type);
}

/**
 * The Postgres-backed writer. A single INSERT is atomic, so the batch is all or nothing. A batch
 * holding `intent`, `action`, `receipt`, `roll`, `decision` or `sheet_adopted` events runs in one
 * transaction: the INSERT, then the projection of those events into their tables (projection.ts for
 * the first three, audit/projection.ts for the rest), in batch order. With XP on (card AN-10a), every
 * batch takes the transaction, and each event's awards (applyAward) run after its projection; with XP
 * off the branch is never reached.
 */
export function pgEventWriter(pool: Pool, xp: XpWriting = XP_OFF): EventWriter {
  return {
    async insertBatch(events) {
      if (events.length === 0) return;
      if (!xp.enabled && !events.some(needsTransaction)) {
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
        const audit = pgAuditStore(client);
        const xpStore = pgXpStore(client);
        for (const event of events) {
          await projectEvent(event, store);
          if (AUDIT_TYPES.has(event.type)) await projectAudit(event, audit);
          if (xp.enabled) {
            for (const award of awardsFor(event)) {
              await applyAward(xpStore, award, xp.thresholds);
            }
          }
        }
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
