import { describe, expect, it } from 'vitest';
import { getThought, listReceipts, listThoughts, type SqlClient, thoughtsAfter } from './query.ts';

/**
 * The delay cut-off (0072 item 5) without Postgres: each statement must compare the row time with
 * "<=" against the cut-off parameter and bind the cut-off to that parameter. A flipped operator,
 * or a cut-off bound to the wrong slot, fails here. The IT file runs the same cases for real.
 */
const CUTOFF = '2026-11-11T10:00:00.000Z';
const SHOWN = { shownUntil: CUTOFF, showLivingSovereign: true };

type Call = { text: string; values: unknown[] };

function recorder(): { db: SqlClient; calls: Call[] } {
  const calls: Call[] = [];
  const db: SqlClient = {
    query: async (text, values) => {
      calls.push({ text, values });
      return { rows: [] };
    },
  };
  return { db, calls };
}

const RUNS: [string, string, (db: SqlClient, shown: typeof SHOWN) => Promise<unknown>][] = [
  ['listThoughts', 't', (db, s) => listThoughts(db, { limit: 5 }, s)],
  ['getThought', 't', (db, s) => getThought(db, 'th-1', s)],
  [
    'thoughtsAfter',
    't',
    (db, s) => thoughtsAfter(db, { at: '2026-11-11 00:00:00+00', id: '' }, 5, s),
  ],
  ['listReceipts', 'r', (db, s) => listReceipts(db, 'ac-1', s)],
];

describe('the delay cut-off in every statement', () => {
  it.each(RUNS)(
    '%s keeps rows at or before the cut-off, bound to the shownUntil value',
    async (_n, alias, run) => {
      const { db, calls } = recorder();
      await run(db, SHOWN);
      const call = calls[0] as Call;
      const match = new RegExp(
        `\\$(\\d+)::timestamptz IS NULL OR ${alias}\\.at <= \\$(\\d+)::timestamptz`,
      ).exec(call.text);
      expect(match, call.text).not.toBeNull();
      expect(match?.[1]).toBe(match?.[2]);
      expect(call.values[Number(match?.[2]) - 1]).toBe(CUTOFF);
      expect(call.text).not.toMatch(new RegExp(`${alias}\\.at >= \\$${match?.[2]}\\b`));
    },
  );

  it.each(RUNS)('%s binds null when there is no delay', async (_n, _alias, run) => {
    const { db, calls } = recorder();
    await run(db, { ...SHOWN, shownUntil: null as unknown as string });
    expect((calls[0] as Call).values).toContain(null);
    expect((calls[0] as Call).values).not.toContain(CUTOFF);
  });
});
