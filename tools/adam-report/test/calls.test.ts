import { describe, expect, it } from 'vitest';
import { callsMeasure } from '../src/calls.ts';
import type { ReceiptRow, ThoughtRow, Verdict } from '../src/types.ts';
import { MIN_MS, receipt, T0, thought } from './fixture.ts';

const WIN = 'window';
/** Action a1 and a2 belong to intents; a9 belongs to no intent (a non-economic action). */
const intentByAction = new Map([
  ['a1', 'i1'],
  ['a2', 'i1'],
]);

/** Four model calls (three thoughts, one reflection), each 1 s long, in minutes 0, 5, 6 and 7. */
const base = (): ThoughtRow[] => [
  thought('t1', { atMs: T0, latencyMs: 1000 }),
  thought('t2', { atMs: T0 + 5 * MIN_MS, latencyMs: 1000 }),
  thought('t3', { atMs: T0 + 6 * MIN_MS, latencyMs: 1000 }),
  thought('r1', { atMs: T0 + 7 * MIN_MS, latencyMs: 1000, wakeReason: 'reflection' }),
];
/** Two receipts for intent actions, in minutes 2 and 3 (neither busy): two useful minutes. */
const useful = (): ReceiptRow[] => [
  receipt('a1', 'committed', T0 + 2 * MIN_MS),
  receipt('a2', 'committed', T0 + 3 * MIN_MS),
];

interface Case {
  name: string;
  thoughts: ThoughtRow[];
  receipts: ReceiptRow[];
  verdict: Verdict;
  values: Record<string, number>;
}

const cases: Case[] = [
  {
    name: 'thoughts and reflections separately, with the total as the headline',
    thoughts: base(),
    receipts: useful(),
    verdict: 'INFO',
    values: {
      model_calls_total: 4,
      thought_calls: 3,
      reflection_calls: 1,
      useful_minutes: 2,
      per_useful_minute_total: 2,
      per_useful_minute_thoughts: 1.5,
      per_useful_minute_reflections: 0.5,
    },
  },
  {
    name: 'an errored call (model call made) is counted as a call',
    thoughts: [...base(), thought('e1', { atMs: T0 + 8 * MIN_MS, latencyMs: 1000, errored: true })],
    receipts: useful(),
    verdict: 'INFO',
    values: { model_calls_total: 5, per_useful_minute_total: 2.5 },
  },
  {
    name: 'a tired cycle is not a model call',
    thoughts: [...base(), thought('q1', { atMs: T0 + 9 * MIN_MS, called: false, latencyMs: null })],
    receipts: useful(),
    verdict: 'INFO',
    values: { model_calls_total: 4 },
  },
  {
    name: 'a receipt in a minute with a model call waited on is not a useful minute',
    thoughts: base(),
    receipts: [receipt('a1', 'committed', T0 + 5 * MIN_MS + 1000)],
    verdict: 'UNKNOWN',
    values: { useful_minutes: 0 },
  },
  {
    name: 'a receipt for an action with no intent is not a useful minute',
    thoughts: base(),
    receipts: [receipt('a9', 'committed', T0 + 2 * MIN_MS)],
    verdict: 'UNKNOWN',
    values: { useful_minutes: 0 },
  },
  {
    name: 'no useful minute is UNKNOWN, never a division by zero',
    thoughts: [],
    receipts: [],
    verdict: 'UNKNOWN',
    values: { model_calls_total: 0, useful_minutes: 0 },
  },
];

describe('calls per useful minute measure', () => {
  it.each(cases)('$name', (c) => {
    const m = callsMeasure({ thoughts: c.thoughts, receipts: c.receipts, intentByAction }, WIN);
    expect(m.verdict).toBe(c.verdict);
    expect(m.values).toMatchObject(c.values);
  });

  it('records the number with the note that the spec gives no threshold', () => {
    const m = callsMeasure({ thoughts: base(), receipts: useful(), intentByAction }, WIN);
    expect(m.note).toBe('recorded, no threshold in the spec');
  });

  it('writes no per-minute value when there is no useful minute', () => {
    const m = callsMeasure({ thoughts: base(), receipts: [], intentByAction }, WIN);
    expect(Object.keys(m.values)).not.toContain('per_useful_minute_total');
    expect(m.note).toBe('no useful minute in the window');
  });
});
