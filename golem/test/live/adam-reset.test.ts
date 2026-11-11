import { describe, expect, it } from 'vitest';
import {
  AUDIT_RESET_TABLES,
  auditResetStatements,
  JOURNAL_RESET_TABLES,
  journalResetStatements,
  resetJournal,
} from './adam-reset.ts';
import { ADAM_LIFE_ID } from './adam-stack.ts';

/** The four append-only tables of migration 0007 (decision 0085). */
const APPEND_ONLY_TABLES = ['receipts', 'thoughts', 'suppressed_wakeups', 'mcp_journal'];

/**
 * A client that records every query. Its `agents` tier read answers `tier` (no row when null); any
 * other query answers with no rows.
 */
function recordingClient(tier: string | null = 'fast') {
  const calls: { sql: string; params: unknown[] }[] = [];
  return {
    calls,
    query: async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (sql.startsWith('SELECT tier')) return { rows: tier === null ? [] : [{ tier }] };
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

  it('clears the mutable tables with the life column each one is keyed by', () => {
    expect(journalResetStatements(ADAM_LIFE_ID).map((s) => s.sql)).toEqual([
      'DELETE FROM memories WHERE agent_id = $1',
      'DELETE FROM goals WHERE agent_id = $1',
      'DELETE FROM relationships WHERE agent_id = $1',
    ]);
  });

  it('keeps the agents row, intents, actions and receipts', () => {
    const touched = JOURNAL_RESET_TABLES.map((t) => t.table);
    for (const kept of ['agents', 'intents', 'actions', 'receipts', 'mcp_journal']) {
      expect(touched).not.toContain(kept);
    }
  });

  it('never deletes from an append-only table', () => {
    const touched = JOURNAL_RESET_TABLES.map((t) => t.table);
    for (const table of APPEND_ONLY_TABLES) {
      expect(touched).not.toContain(table);
    }
  });

  it('refuses any other life id, so no statement is built for it', () => {
    expect(() => journalResetStatements('ag_kestrel_01')).toThrow(/only the 8B test life/);
    expect(() => journalResetStatements('')).toThrow(/refusing/);
  });
});

describe('auditResetStatements', () => {
  it('builds the DELETE of the two audit tables the reset used to clear, and no other', () => {
    expect(auditResetStatements(ADAM_LIFE_ID)).toEqual([
      { sql: 'DELETE FROM thoughts WHERE life_id = $1', params: [ADAM_LIFE_ID] },
      { sql: 'DELETE FROM suppressed_wakeups WHERE life_id = $1', params: [ADAM_LIFE_ID] },
    ]);
    expect(AUDIT_RESET_TABLES.map((t) => t.table)).not.toContain('receipts');
    expect(AUDIT_RESET_TABLES.map((t) => t.table)).not.toContain('mcp_journal');
  });

  it('refuses any other life id', () => {
    expect(() => auditResetStatements('ag_kestrel_01')).toThrow(/only the 8B test life/);
  });
});

describe('resetJournal', () => {
  it('reads the tier, then runs the mutable deletes and clears the sleep and birth days', async () => {
    const db = recordingClient();
    await resetJournal(db, ADAM_LIFE_ID, () => undefined);
    expect(db.calls).toEqual([
      { sql: 'SELECT tier FROM agents WHERE agent_id = $1', params: [ADAM_LIFE_ID] },
      ...journalResetStatements(ADAM_LIFE_ID).map((s) => ({ sql: s.sql, params: s.params })),
      {
        sql: 'UPDATE agents SET last_sleep_day = NULL, born_day = NULL WHERE agent_id = $1',
        params: [ADAM_LIFE_ID],
      },
    ]);
  });

  it('logs the audit DELETEs as not run and runs none of them', async () => {
    const db = recordingClient();
    const logged: string[] = [];
    await resetJournal(db, ADAM_LIFE_ID, (line) => logged.push(line));
    expect(logged).toEqual([
      `reset not run (append-only, decision 0085): DELETE FROM thoughts WHERE life_id = $1 [${ADAM_LIFE_ID}]`,
      `reset not run (append-only, decision 0085): DELETE FROM suppressed_wakeups WHERE life_id = $1 [${ADAM_LIFE_ID}]`,
    ]);
    expect(db.calls.map((c) => c.sql)).not.toContain('DELETE FROM thoughts WHERE life_id = $1');
  });

  it('runs no DELETE against the four append-only tables', async () => {
    const db = recordingClient();
    await resetJournal(db, ADAM_LIFE_ID, () => undefined);
    for (const table of APPEND_ONLY_TABLES) {
      const deletes = db.calls.filter((c) => c.sql.startsWith(`DELETE FROM ${table} `));
      expect(deletes, `DELETE on ${table}`).toEqual([]);
    }
  });

  it('issues no query at all for another life id', async () => {
    const db = recordingClient();
    await expect(resetJournal(db, 'ag_kestrel_01', () => undefined)).rejects.toThrow(/refusing/);
    expect(db.calls).toEqual([]);
  });

  it('deletes nothing for the test life unless its row is tier fast', async () => {
    const db = recordingClient('local');
    await expect(resetJournal(db, ADAM_LIFE_ID, () => undefined)).rejects.toThrow(/not tier fast/);
    expect(db.calls.map((c) => c.sql)).toEqual(['SELECT tier FROM agents WHERE agent_id = $1']);
  });

  it('refuses when the test life has no agents row', async () => {
    const db = recordingClient(null);
    await expect(resetJournal(db, ADAM_LIFE_ID, () => undefined)).rejects.toThrow(/not tier fast/);
    expect(db.calls).toHaveLength(1);
  });
});
