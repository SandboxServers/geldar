import { describe, expect, it } from 'vitest';
import { listThoughtActions, type SqlClient } from './query.ts';

/**
 * The thought -> intents -> actions join, checked without Postgres: the statement must repeat the thought's
 * visibility predicates on the join, keep only the thought's own agent's actions, and bind the same values.
 * The IT file (glass/test/glass.it.test.ts, GELDAR_IT=1) runs the rows for real.
 */
type Call = { text: string; values: unknown[] };

function recorder(rows: Record<string, unknown>[] = []): { db: SqlClient; calls: Call[] } {
  const calls: Call[] = [];
  const db: SqlClient = {
    query: async (text, values) => {
      calls.push({ text, values });
      return { rows };
    },
  };
  return { db, calls };
}

const CUTOFF = '2026-11-11T10:00:00.000Z';

describe('listThoughtActions', () => {
  it('joins thought -> intents on thought_id and actions on intent_id, within the thought own agent', async () => {
    const { db, calls } = recorder();
    await listThoughtActions(db, 'th-1');
    const sql = calls[0]?.text ?? '';
    expect(sql).toMatch(/JOIN intents i ON i\.thought_id = t\.thought_id/);
    expect(sql).toMatch(
      /JOIN actions ac ON ac\.intent_id = i\.intent_id AND ac\.life_id = t\.life_id/,
    );
  });

  it('repeats the sovereign and delay predicates of the thought on the join', async () => {
    const { db, calls } = recorder();
    await listThoughtActions(db, 'th-1', {
      shownUntil: CUTOFF,
      showLivingSovereign: false,
      ownedAgents: ['ag-own'],
    });
    const sql = calls[0]?.text ?? '';
    expect(sql).toMatch(
      /\(\$2::boolean OR a\.mode IS DISTINCT FROM 'sovereign' OR a\.died_at IS NOT NULL\s+OR a\.thoughts_delayed_public OR a\.agent_id = ANY\(\$4::text\[\]\)\)/,
    );
    expect(sql).toMatch(
      /\(\$3::timestamptz IS NULL OR t\.at <= \$3::timestamptz OR a\.died_at IS NOT NULL\s+OR a\.agent_id = ANY\(\$4::text\[\]\)\)/,
    );
    expect(calls[0]?.values).toEqual(['th-1', false, CUTOFF, ['ag-own']]);
  });

  it('binds no delay and shows a living sovereign agent when the viewer may see it', async () => {
    const { db, calls } = recorder();
    await listThoughtActions(db, 'th-1', { shownUntil: null, showLivingSovereign: true });
    expect(calls[0]?.values).toEqual(['th-1', true, null, []]);
  });

  it('keeps the rows in the order the statement returns them: intent start, then sequence, then id', async () => {
    const rows = [{ action_id: 'ac-1' }, { action_id: 'ac-2' }, { action_id: 'ac-3' }];
    const { db, calls } = recorder(rows);
    const ids = await listThoughtActions(db, 'th-1');
    expect(ids).toEqual(['ac-1', 'ac-2', 'ac-3']);
    expect(calls[0]?.text).toMatch(
      /ORDER BY i\.started_tick NULLS LAST, i\.intent_id, ac\.sequence NULLS LAST, ac\.action_id/,
    );
  });

  it('returns an empty list when the thought has no action, or is hidden (the statement returns no rows)', async () => {
    const { db } = recorder([]);
    expect(await listThoughtActions(db, 'th-none')).toEqual([]);
  });

  it('keeps a hostile thought id as a bound parameter, never in the SQL text', async () => {
    const hostile = "'; DELETE FROM actions; --";
    const { db, calls } = recorder();
    await listThoughtActions(db, hostile);
    expect(calls[0]?.text).not.toContain('DELETE');
    expect(calls[0]?.values[0]).toBe(hostile);
  });
});
