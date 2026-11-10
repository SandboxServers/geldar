import { describe, expect, it } from 'vitest';
import { resumeMeasure } from '../src/intents.ts';
import type { ActionRow, IntentRow, Verdict } from '../src/types.ts';
import { action, intent } from './fixture.ts';

const WIN = 'window';

/** A completed intent i1 whose actions ran in the given Body generations. */
const ran = (...generations: number[]): ActionRow[] =>
  generations.map((gen, n) => action(`a${n + 1}`, { intentId: 'i1', bodyGeneration: gen }));

interface Case {
  name: string;
  intents: IntentRow[];
  actions: ActionRow[];
  restarts: number | null;
  verdict: Verdict;
}

const completed = [intent('i1', { state: 'completed' })];

const cases: Case[] = [
  {
    name: 'a Body restart mid-intent, resumed from its checkpoint PASS',
    intents: completed,
    actions: ran(1, 2),
    restarts: 1,
    verdict: 'PASS',
  },
  {
    name: 'a Body restart with no resumed intent FAIL',
    intents: completed,
    actions: ran(1),
    restarts: 1,
    verdict: 'FAIL',
  },
  {
    name: 'an intent in two generations that did not complete is not a resume',
    intents: [intent('i1', { state: 'interrupted' })],
    actions: ran(1, 2),
    restarts: 1,
    verdict: 'FAIL',
  },
  {
    name: 'no Body restart in the run is UNKNOWN',
    intents: completed,
    actions: ran(1),
    restarts: 0,
    verdict: 'UNKNOWN',
  },
  {
    name: 'no restart record in the manifest is UNKNOWN',
    intents: completed,
    actions: ran(1),
    restarts: null,
    verdict: 'UNKNOWN',
  },
  {
    name: 'no intents and no actions is UNKNOWN',
    intents: [],
    actions: [],
    restarts: 1,
    verdict: 'UNKNOWN',
  },
];

describe('checkpoint resume measure', () => {
  it.each(cases)('$name', (c) => {
    const m = resumeMeasure(c.intents, c.actions, c.restarts, WIN);
    expect(m.verdict).toBe(c.verdict);
  });

  it('counts a resumed intent and reports the Body restarts', () => {
    const m = resumeMeasure(completed, ran(1, 2), 1, WIN);
    expect(m.values).toMatchObject({ checkpoint_resumes: 1, body_restarts: 1 });
  });

  it('ignores an action with no Body generation', () => {
    const actions = [
      action('a1', { intentId: 'i1', bodyGeneration: 1 }),
      action('a2', { intentId: 'i1', bodyGeneration: null }),
    ];
    const m = resumeMeasure(completed, actions, 1, WIN);
    expect(m.verdict).toBe('FAIL');
  });
});
