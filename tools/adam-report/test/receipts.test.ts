import { describe, expect, it } from 'vitest';
import { receiptMeasure } from '../src/intents.ts';
import type { ActionRow, ReceiptRow, Verdict } from '../src/types.ts';
import { MIN_MS, T0, action, receipt } from './fixture.ts';

const WIN = 'window';

/** `n` completed actions, the i-th with its prepared and committed receipts i minutes after T0. */
const spread = (n: number) => {
  const actions: ActionRow[] = [];
  const receipts: ReceiptRow[] = [];
  for (let i = 0; i < n; i++) {
    actions.push(action(`b${i}`, { state: 'completed' }));
    receipts.push(receipt(`b${i}`, 'prepared', T0 + i * MIN_MS));
    receipts.push(receipt(`b${i}`, 'committed', T0 + i * MIN_MS));
  }
  return { actions, receipts };
};

interface Case {
  name: string;
  actions: ActionRow[];
  receipts: ReceiptRow[];
  verdict: Verdict;
  noteHas?: string;
}

const enough = spread(20);

const cases: Case[] = [
  {
    name: 'every terminal action has one final receipt PASS',
    actions: enough.actions,
    receipts: enough.receipts,
    verdict: 'PASS',
  },
  {
    name: 'fewer than 20 terminal actions cannot PASS: UNKNOWN',
    actions: spread(19).actions,
    receipts: spread(19).receipts,
    verdict: 'UNKNOWN',
  },
  {
    name: 'twenty terminal actions inside one minute cannot PASS: UNKNOWN',
    actions: enough.actions,
    receipts: enough.receipts.map((r) => ({ ...r, atMs: T0 })),
    verdict: 'UNKNOWN',
  },
  {
    name: 'one terminal action without a final receipt FAIL, naming its id',
    actions: [action('a1', { state: 'completed' }), action('a2', { state: 'completed' })],
    receipts: [receipt('a1', 'committed')],
    verdict: 'FAIL',
    noteHas: 'a2',
  },
  {
    name: 'two final receipts for one action FAIL, naming its id',
    actions: [action('a1', { state: 'completed' })],
    receipts: [receipt('a1', 'prepared'), receipt('a1', 'committed'), receipt('a1', 'aborted')],
    verdict: 'FAIL',
    noteHas: 'action a1 has no one final receipt',
  },
  {
    name: 'an action that is not terminal yet is not counted',
    actions: [...enough.actions, action('r1', { state: 'running' })],
    receipts: [...enough.receipts, receipt('r1', 'prepared'), receipt('r1', 'committed')],
    verdict: 'PASS',
  },
  {
    name: 'an economic action with no prepared receipt FAIL, naming its id',
    actions: [action('a1', { state: 'completed' }), action('a2', { state: 'completed' })],
    receipts: [receipt('a1', 'prepared'), receipt('a1', 'committed'), receipt('a2', 'committed')],
    verdict: 'FAIL',
    noteHas: 'a2',
  },
  {
    name: 'only actions that are not terminal is UNKNOWN',
    actions: [action('a1', { state: 'running' })],
    receipts: [],
    verdict: 'UNKNOWN',
  },
  {
    name: 'no actions at all is UNKNOWN',
    actions: [],
    receipts: [],
    verdict: 'UNKNOWN',
  },
];

describe('receipts measure', () => {
  it.each(cases)('$name', (c) => {
    const m = receiptMeasure(c.actions, c.receipts, WIN);
    expect(m.verdict).toBe(c.verdict);
    if (c.noteHas !== undefined) expect(m.note).toContain(c.noteHas);
  });

  it('counts the terminal and economic actions in the values', () => {
    const m = receiptMeasure(
      [action('a1', { state: 'completed' }), action('a2', { state: 'running' })],
      [receipt('a1', 'prepared'), receipt('a1', 'committed')],
      WIN,
    );
    expect(m.values).toMatchObject({
      actions_total: 2,
      terminal_actions: 1,
      terminal_without_one_final_receipt: 0,
      economic_actions: 1,
      economic_without_prepared: 0,
    });
  });
});
