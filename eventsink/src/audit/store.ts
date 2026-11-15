/** The audit tables over one open transaction (migration 0051). Every insert is idempotent. */
import type { CharacterSheet } from '@geldar/contract';
import { ProjectionRejectedError, type Queryable } from '../projection.ts';
import type { AuditStore, DecisionRow, RollRow } from './projection.ts';

function jsonOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : JSON.stringify(value);
}

/** The store over one open transaction, for `projectAudit`. `pg`'s `PoolClient` fits `Queryable`. */
export function pgAuditStore(db: Queryable): AuditStore {
  return {
    async insertRoll(r: RollRow) {
      await db.query(
        `INSERT INTO rolls (source_event_id, life_id, world_tick, decision_id, draw_index, engine_version,
           producer, fx, score, proficiency, dc, mode, dice, kept, bonus, total, success, inputs)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18::jsonb)
         ON CONFLICT DO NOTHING`,
        [
          r.source_event_id,
          r.life_id,
          r.world_tick,
          r.decision_id,
          r.draw_index,
          r.engine_version,
          r.producer,
          r.fx,
          r.score,
          r.proficiency,
          r.dc,
          r.mode,
          r.dice,
          r.kept,
          r.bonus,
          r.total,
          r.success,
          jsonOrNull(r.inputs),
        ],
      );
    },
    async insertDecision(d: DecisionRow) {
      await db.query(
        `INSERT INTO decisions (source_event_id, life_id, world_tick, decision_id, engine_version, producer,
           fx, kind, policy, inputs, result, roll_event_ids, thought_id, action_id, intent_id, dropped, since_tick)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12, $13, $14, $15, $16, $17)
         ON CONFLICT DO NOTHING`,
        [
          d.source_event_id,
          d.life_id,
          d.world_tick,
          d.decision_id,
          d.engine_version,
          d.producer,
          d.fx,
          d.kind,
          d.policy,
          jsonOrNull(d.inputs),
          jsonOrNull(d.result),
          d.roll_event_ids,
          d.thought_id,
          d.action_id,
          d.intent_id,
          d.dropped,
          d.since_tick,
        ],
      );
    },
    async adopt(
      life: string,
      sheet: CharacterSheet,
      hash: string,
      source: string,
      sourceEventId: string,
    ) {
      const updated = await db.query(
        `UPDATE agents SET character_sheet = $2::jsonb, sheet_hash = $3, sheet_adopted_at = now()
           WHERE agent_id = $1 AND character_sheet IS NULL
         RETURNING agent_id`,
        [life, JSON.stringify(sheet), hash],
      );
      let result: 'adopted' | 'same' | 'conflict' = 'adopted';
      if (updated.rows.length === 0) {
        const stored = await db.query(
          'SELECT sheet_hash FROM agents WHERE agent_id = $1 FOR UPDATE',
          [life],
        );
        if (stored.rows.length === 0) {
          // The same refusal the foreign key gives: the consumer dead-letters it.
          throw new ProjectionRejectedError('23503', `sheet_adopted for unknown life ${life}`);
        }
        result = stored.rows[0]?.sheet_hash === hash ? 'same' : 'conflict';
      }
      await db.query(
        `INSERT INTO character_sheet_adoptions (source_event_id, life_id, sheet_hash, sheet, source, result)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6)
         ON CONFLICT (source_event_id) DO NOTHING`,
        [sourceEventId, life, hash, JSON.stringify(sheet), source, result],
      );
      return result;
    },
  };
}
