import { describe, expect, it } from 'vitest';
import { JOURNAL_RESET_TABLES, journalResetStatements, resetJournal } from './adam-reset.ts';
import { ADAM_LIFE_ID } from './adam-stack.ts';

/** A client that records every query and answers with no rows. */
function recordingClient() {
  const calls: { sql: string; params: unknown[] }[] = [];
  return {
    calls,
    query: async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      return { rows: [] };
    },
  };
}

describe('journalResetStatements', () => {
  it('parameterises every statement by the life id and never inlines it', () => {
    const statements = journalResetStatements(ADAM_LIFE_ID);
    expect(statements.length).toBe(JOURNAL_RESET_TABLES.length);
    for (const s of statements) {
      expect(s.sql).toMatch(/^DELETE FROM \w+ WHERE \w+ = \$1$/);
      expect(s.sql).not.toContain(ADAM_LIFE_ID);
      expect(s.params).toEqual([ADAM_LIFE_ID]);
    }
  });

  it('clears the journal tables with the life column each one is keyed by', () => {
    expect(journalResetStatements(ADAM_LIFE_ID).map((s) => s.sql)).toEqual([
      'DELETE FROM suppressed_wakeups WHERE life_id = $1',
      'DELETE FROM memories WHERE agent_id = $1',
      'DELETE FROM goals WHERE agent_id = $1',
      'DELETE FROM relationships WHERE agent_id = $1',
      'DELETE FROM thoughts WHERE life_id = $1',
    ]);
  });

  it('keeps the agents row, intents, actions and receipts', () => {
    const touched = JOURNAL_RESET_TABLES.map((t) => t.table);
    for (const kept of ['agents', 'intents', 'actions', 'receipts']) {
      expect(touched).not.toContain(kept);
    }
  });

  it('deletes memories (the vector column lives there) before the agent rows it references', () => {
    // Children before parents: nothing here is a parent of `memories`, and `agents` is never
    // deleted, so the order only needs the tables that reference a life to come first.
    const order = JOURNAL_RESET_TABLES.map((t) => t.table);
    expect(order.indexOf('memories')).toBeLessThan(order.indexOf('thoughts'));
    expect(order.indexOf('goals')).toBeLessThan(order.indexOf('thoughts'));
  });

  it('refuses any other life id, so no statement is built for it', () => {
    expect(() => journalResetStatements('ag_kestrel_01')).toThrow(/only the 8B test life/);
    expect(() => journalResetStatements('')).toThrow(/refusing/);
  });
});

describe('resetJournal', () => {
  it('runs the statements in order with the life id as the only parameter', async () => {
    const db = recordingClient();
    await resetJournal(db, ADAM_LIFE_ID);
    expect(db.calls).toEqual(
      journalResetStatements(ADAM_LIFE_ID).map((s) => ({ sql: s.sql, params: s.params })),
    );
  });

  it('issues no query at all for another life id', async () => {
    const db = recordingClient();
    await expect(resetJournal(db, 'ag_kestrel_01')).rejects.toThrow(/refusing/);
    expect(db.calls).toEqual([]);
  });
});
