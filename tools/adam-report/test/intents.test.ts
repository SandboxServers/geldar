import { describe, expect, it } from 'vitest';
import { intentMeasures } from '../src/intents.ts';
import type { IntentRow, ThoughtRow, Verdict } from '../src/types.ts';
import { intent, thought } from './fixture.ts';

const WIN = 'window';
const MIN_WITHOUT_CALL = 3;

/** Each intent has its own tick range (100-200, 300-400, 500-600), so a call hits only one of them. */
const START: Record<string, number> = { i1: 100, i2: 300, i3: 500 };
/** A completed intent over its own range. */
const span = (id: string, o: Partial<IntentRow> = {}): IntentRow => {
  const start = START[id] ?? 0;
  return intent(id, { startedTick: start, endedTick: start + 100, ...o });
};

const three: IntentRow[] = [span('i1'), span('i2'), span('i3')];
const called = (id: string, tick: number): ThoughtRow => thought(id, { tick, called: true });
const tired = (id: string, tick: number): ThoughtRow => thought(id, { tick, called: false });

interface Case {
  name: string;
  intents: IntentRow[];
  thoughts: ThoughtRow[];
  verdict: Verdict;
  without: number;
}

const cases: Case[] = [
  {
    name: 'three completed intents with no model call PASS',
    intents: three,
    thoughts: [],
    verdict: 'PASS',
    without: 3,
  },
  {
    name: 'two completed intents with no model call FAIL',
    intents: [span('i1'), span('i2')],
    thoughts: [],
    verdict: 'FAIL',
    without: 2,
  },
  {
    name: 'chatter-interrupted intents that completed are still counted',
    intents: [
      span('i1'),
      span('i2', { endReason: 'interrupted:chatter' }),
      span('i3', { endReason: 'interrupted:chatter' }),
    ],
    thoughts: [],
    verdict: 'PASS',
    without: 3,
  },
  {
    name: 'an intent with a model call inside its tick range is not counted',
    intents: three,
    thoughts: [called('t1', 150)],
    verdict: 'FAIL',
    without: 2,
  },
  {
    name: 'a call on the end tick is inside the range (inclusive)',
    intents: three,
    thoughts: [called('t1', 200)],
    verdict: 'FAIL',
    without: 2,
  },
  {
    name: 'a call on the start tick is inside the range (inclusive)',
    intents: three,
    thoughts: [called('t1', 100)],
    verdict: 'FAIL',
    without: 2,
  },
  {
    name: 'a call one tick before the range does not count against it',
    intents: three,
    thoughts: [called('t1', 99)],
    verdict: 'PASS',
    without: 3,
  },
  {
    name: 'a tired cycle inside the range is not a model call',
    intents: three,
    thoughts: [tired('t1', 150)],
    verdict: 'PASS',
    without: 3,
  },
  {
    name: 'an intent that did not complete is not counted',
    intents: [span('i1'), span('i2'), span('i3', { state: 'failed' })],
    thoughts: [],
    verdict: 'FAIL',
    without: 2,
  },
  {
    name: 'an intent without a tick range is unmeasured and not counted',
    intents: [span('i1'), span('i2'), span('i3', { startedTick: null })],
    thoughts: [],
    verdict: 'FAIL',
    without: 2,
  },
  {
    name: 'no intents at all is UNKNOWN',
    intents: [],
    thoughts: [],
    verdict: 'UNKNOWN',
    without: 0,
  },
];

describe('intents measure', () => {
  it.each(cases)('$name', (c) => {
    const [m] = intentMeasures(c.intents, c.thoughts, MIN_WITHOUT_CALL, WIN);
    expect(m?.verdict).toBe(c.verdict);
    expect(m?.values.completed_without_model_call).toBe(c.without);
  });

  it('counts chatter-interrupted completed intents apart in the values', () => {
    const chatter = [span('i1', { endReason: 'interrupted:chatter' }), span('i2')];
    const [m] = intentMeasures(chatter, [], MIN_WITHOUT_CALL, WIN);
    expect(m?.values.interrupted_by_chatter).toBe(1);
    expect(m?.values.completed).toBe(2);
  });

  it('gives UNKNOWN with the pending note when the minimum is not answered', () => {
    const [m] = intentMeasures(three, [], null, WIN);
    expect(m?.verdict).toBe('UNKNOWN');
    expect(m?.note).toBe('not computed: definition pending');
  });

  it('reports an intent without a tick range in the unmeasured value', () => {
    const [m] = intentMeasures([span('i1', { startedTick: null })], [], MIN_WITHOUT_CALL, WIN);
    expect(m?.values.completed_without_tick_range).toBe(1);
    expect(m?.values.completed_without_model_call).toBe(0);
  });
});
