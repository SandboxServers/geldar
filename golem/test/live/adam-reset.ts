/**
 * The journal reset of the live Mind cases. The test life `ag_adam_02` persists between runs, and
 * the Mind loads its recent thoughts, beliefs, memories and goals into every prompt, so after many
 * runs of greetings the 8B copies its own history. Before each case this clears that life's journal
 * rows. Only the 8B test life can be reset; `intents`, `actions` and `receipts` are left alone (the
 * case ignores older intents) and so is the `agents` row (the Mind re-creates it when missing).
 * Commitments are the `memories` rows with provenance `commitment`, so they go with `memories`.
 */
import { ADAM_LIFE_ID, type Queryable } from './adam-stack.ts';

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

/** Runs the reset of `lifeId`'s journal on `db`. Nothing runs for a refused life id. */
export async function resetJournal(db: Queryable, lifeId: string): Promise<void> {
  for (const { sql, params } of journalResetStatements(lifeId)) {
    await db.query(sql, params);
  }
}
