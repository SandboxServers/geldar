/**
 * The journal reset of the live Mind cases. The test life `ag_adam_02` persists between runs, and
 * the Mind loads its recent thoughts, beliefs, memories and goals into every prompt, so after many
 * runs of greetings the 8B copies its own history. Before each case this clears that life's mutable
 * rows (memories, goals, relationships) and clears its `last_sleep_day` and `born_day`, so its
 * tiredness starts over. Only the 8B test life, in tier `fast`, can be reset; `intents`, `actions`,
 * `receipts` and `mcp_journal` are left alone and the `agents` row stays (the Mind re-creates it when
 * missing). Commitments are the `memories` rows with provenance `commitment`, so they go with
 * `memories`.
 *
 * `thoughts` and `suppressed_wakeups` are append-only since migration 0007 (decision 0085): a DELETE
 * is refused by trigger. The reset does not run those DELETEs. It logs each one as not run, so the
 * old thoughts stay in the table and reach the Mind's prompts until a new life id exists (follow-up
 * in decision 0085: ADAM_LIFE_ID in adam-stack.ts, outside the packet's may-edit list).
 */
import { ADAM_LIFE_ID, type Queryable } from './adam-stack.ts';

/** The tier the test life must be in before a reset runs (the case checks the same tier). */
export const RESET_TIER = 'fast';

/**
 * The mutable journal tables a reset clears, with the column that holds the life id. None of them
 * is `agents`, `intents`, `actions`, `receipts` or an audit table.
 */
export const JOURNAL_RESET_TABLES: readonly { table: string; column: string }[] = [
  { table: 'memories', column: 'agent_id' },
  { table: 'goals', column: 'agent_id' },
  { table: 'relationships', column: 'agent_id' },
];

/**
 * The append-only tables that a reset used to clear. The reset never runs a DELETE on them; it logs
 * the statement it would have run (decision 0085). receipts and mcp_journal were never cleared here.
 */
export const AUDIT_RESET_TABLES: readonly { table: string; column: string }[] = [
  { table: 'thoughts', column: 'life_id' },
  { table: 'suppressed_wakeups', column: 'life_id' },
];

/** One parameterised statement of a reset. */
export interface ResetStatement {
  sql: string;
  params: [string];
}

/** Throws unless `lifeId` is the 8B test life, so a real Adam life can never be wiped by accident. */
function assertTestLife(lifeId: string): void {
  if (lifeId !== ADAM_LIFE_ID) {
    throw new Error(
      `refusing to reset the journal of life '${lifeId}': only the 8B test life '${ADAM_LIFE_ID}' may be reset`,
    );
  }
}

/** The DELETE statements of the mutable tables, in order. Throws unless `lifeId` is the test life. */
export function journalResetStatements(lifeId: string): ResetStatement[] {
  assertTestLife(lifeId);
  return JOURNAL_RESET_TABLES.map(({ table, column }) => ({
    sql: `DELETE FROM ${table} WHERE ${column} = $1`,
    params: [lifeId],
  }));
}

/**
 * The DELETE statements a reset would have run on the append-only tables. They are logged and never
 * run. Throws unless `lifeId` is the test life.
 */
export function auditResetStatements(lifeId: string): ResetStatement[] {
  assertTestLife(lifeId);
  return AUDIT_RESET_TABLES.map(({ table, column }) => ({
    sql: `DELETE FROM ${table} WHERE ${column} = $1`,
    params: [lifeId],
  }));
}

/** The `agents` update of a reset: the life's last sleep day and birth day go back to unset. */
export function agentResetStatement(lifeId: string): ResetStatement {
  return {
    sql: 'UPDATE agents SET last_sleep_day = NULL, born_day = NULL WHERE agent_id = $1',
    params: [lifeId],
  };
}

/**
 * Runs the reset of `lifeId`'s journal on `db`. The life id is checked first, then the row's tier:
 * only a `fast` row is reset, and a missing row is refused. Nothing is deleted for a refused life.
 * Each append-only DELETE is passed to `log` as not run.
 */
export async function resetJournal(
  db: Queryable,
  lifeId: string,
  log: (line: string) => void = (line) => console.log(line),
): Promise<void> {
  const statements = journalResetStatements(lifeId);
  const { rows } = await db.query('SELECT tier FROM agents WHERE agent_id = $1', [lifeId]);
  if (rows[0]?.tier !== RESET_TIER) {
    throw new Error(`refusing to reset '${lifeId}': its agents row is not tier ${RESET_TIER}`);
  }
  for (const { sql, params } of [...statements, agentResetStatement(lifeId)]) {
    await db.query(sql, params);
  }
  for (const { sql, params } of auditResetStatements(lifeId)) {
    log(`reset not run (append-only, decision 0085): ${sql} [${params[0]}]`);
  }
}
