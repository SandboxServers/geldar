import { STANDARD_SHEET } from '@geldar/psyche';
import { formatPlanLine, planAdoption } from './convert-sheets.ts';
import type { Sql } from './owners.ts';
import { checkAdoptionLife, sheetHash, transaction } from './players.ts';

/** Thrown inside one life's transaction when its UPDATE matches no row: the transaction rolls back. */
class LifeChanged extends Error {}

/**
 * Writes the standard sheet to each life the plan marks would-adopt (decision 0287, sql 0057). Only
 * the standard sheet is written: any other `--sheets` value refuses the whole run before any SQL.
 * Each life is one transaction: its events row, the agents row, then its audit row. Returns one
 * printed line per life: `adopted` or `skipped` for the lives written, the plan line for the rest,
 * and `<life>: failed` for a life whose write threw. A failed life does not stop the run, so the
 * lines of the lives already written are all returned; the caller exits non-zero on any `failed`.
 */
export async function applyAdoption(
  sql: Sql,
  shardLives: readonly string[],
  sheets: Record<string, unknown>,
): Promise<string[]> {
  if (Object.values(sheets).some((value) => value !== 'standard')) {
    throw new Error('adopt-sheets: --apply writes the standard sheet only (0328)');
  }
  const plan = await planAdoption(sql, shardLives, sheets);
  const lines: string[] = [];
  for (const line of plan) {
    if (line.verdict !== 'would-adopt') {
      lines.push(formatPlanLine(line));
      continue;
    }
    lines.push(`${line.life}: ${await adoptLifeOrFail(sql, line.life)}`);
  }
  return lines;
}

async function adoptLifeOrFail(sql: Sql, life: string): Promise<'adopted' | 'skipped' | 'failed'> {
  try {
    return await adoptLife(sql, life);
  } catch {
    return 'failed';
  }
}

/**
 * One life, in one transaction. The UPDATE repeats the planner's test in SQL (no baseline, not dead),
 * so a life that changed between the read and the write matches no row and is skipped, not overwritten.
 * A unique violation on this life's event id means the adoption was already written: skipped.
 */
async function adoptLife(sql: Sql, life: string): Promise<'adopted' | 'skipped'> {
  checkAdoptionLife(life);
  const hash = sheetHash(STANDARD_SHEET);
  const sheet = JSON.stringify(STANDARD_SHEET);
  const eventId = `conversion:sheet_adopted:${life}`;
  try {
    await transaction(sql, async () => {
      await sql.query(
        `INSERT INTO events (source_event_id, at, type, agent_id, payload)
         VALUES ($1, now(), 'sheet_adopted', $2, $3::jsonb)`,
        [
          eventId,
          life,
          JSON.stringify({
            life_id: life,
            sheet: STANDARD_SHEET,
            sheet_hash: hash,
            source: 'conversion',
          }),
        ],
      );
      const updated = await sql.query(
        `UPDATE agents SET character_sheet = $2::jsonb, sheet_hash = $3, sheet_adopted_at = now()
         WHERE agent_id = $1 AND sheet_hash IS NULL AND died_at IS NULL
         RETURNING agent_id`,
        [life, sheet, hash],
      );
      if (updated.rows.length === 0) throw new LifeChanged(life);
      await sql.query(
        `INSERT INTO character_sheet_adoptions (source_event_id, life_id, sheet_hash, sheet, source, result)
         VALUES ($1, $2, $3, $4::jsonb, 'conversion', 'adopted')`,
        [eventId, life, hash, sheet],
      );
    });
    return 'adopted';
  } catch (error) {
    if (error instanceof LifeChanged || isEventIdViolation(error, eventId)) return 'skipped';
    throw error;
  }
}

/** Postgres unique violation (23505) whose detail names this life's event id. */
function isEventIdViolation(error: unknown, eventId: string): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { code, detail } = error as { code?: unknown; detail?: unknown };
  return code === '23505' && typeof detail === 'string' && detail.includes(eventId);
}
