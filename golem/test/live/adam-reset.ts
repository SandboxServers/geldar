/**
 * The journal reset of the live Mind cases. The test life `ag_adam_02` persists between runs, and
 * the Mind loads its recent thoughts, beliefs, memories and goals into every prompt, so after many
 * runs of greetings the 8B copies its own history. Before each case this clears that life's journal
 * rows and clears its `last_sleep_day` and `born_day`, so its tiredness starts over. Only the 8B test
 * life, in tier `fast`, can be reset; `intents`, `actions` and `receipts` are left alone (the case
 * ignores older intents) and the `agents` row stays (the Mind re-creates it when missing).
 * Commitments are the `memories` rows with provenance `commitment`, so they go with `memories`.
 */
import { ADAM_LIFE_ID, type Queryable } from './adam-stack.ts';

/** The tier the test life must be in before a reset runs (the case checks the same tier). */
export const RESET_TIER = 'fast';

/**
 * The journal tables a reset clears, children before parents, with the column that holds the life
 * id. None of them is `agents`, `intents`, `actions` or `receipts`.
 */
export const JOURNAL_RESET_TABLES: readonly { table: string; column: string }[] = [
  { table: 'suppressed_wakeups', column: 'life_id' },
  { table: 'memories', column: 'agent_id' },
  { table: 'goals', column: 'agent_id' },
  { table: 'relationships', column: 'agent_id' },
  { table: 'thoughts', column: 'life_id' },
];

/** One parameterised statement of a reset. */
export interface ResetStatement {
  sql: string;
  params: [string];
}

/**
 * The statements that reset `lifeId`'s journal, in order. Throws unless `lifeId` is the 8B test
 * life, so a real Adam life can never be wiped by accident.
 */
export function journalResetStatements(lifeId: string): ResetStatement[] {
  if (lifeId !== ADAM_LIFE_ID) {
    throw new Error(
      `refusing to reset the journal of life '${lifeId}': only the 8B test life '${ADAM_LIFE_ID}' may be reset`,
    );
  }
  return JOURNAL_RESET_TABLES.map(({ table, column }) => ({
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
 */
export async function resetJournal(db: Queryable, lifeId: string): Promise<void> {
  const statements = journalResetStatements(lifeId);
  const { rows } = await db.query('SELECT tier FROM agents WHERE agent_id = $1', [lifeId]);
  if (rows[0]?.tier !== RESET_TIER) {
    throw new Error(`refusing to reset '${lifeId}': its agents row is not tier ${RESET_TIER}`);
  }
  for (const { sql, params } of [...statements, agentResetStatement(lifeId)]) {
    await db.query(sql, params);
  }
}
