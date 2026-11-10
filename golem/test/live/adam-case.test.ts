import { describe, expect, it } from 'vitest';
import { type AdamCaseKind, caseSetup, caseTime, planEvidence } from './adam-case.ts';
import { type ActionRow, ADAM_LIFE_ID, type IntentRow, type ThoughtRow } from './adam-stack.ts';

const KINDS: AdamCaseKind[] = ['smoke', 'chatter', 'restart', 'sleep'];

function thought(id: string, valid: boolean): ThoughtRow {
  return {
    thought_id: id,
    wake_reason: 'chatter',
    at: '2026-11-09T10:00:00.000Z',
    latency_ms: 800,
    valid,
    has_output: true,
    body_generation: 1,
    model_input: null,
  };
}

function intent(id: string, thoughtId: string | null, state = 'accepted'): IntentRow {
  return {
    intent_id: id,
    thought_id: thoughtId,
    body_generation: 1,
    state,
    program: 'travel',
    goal: null,
  };
}

function action(id: string, intentId: string | null, state: string): ActionRow {
  return { action_id: id, intent_id: intentId, body_generation: 1, state, kind: 'goto' };
}

describe('the case setup', () => {
  it('starts only the sleep case at night, with a bed in the inventory', () => {
    expect(caseTime('sleep')).toBe('night');
    expect(caseSetup('sleep')).toContain(`give ${ADAM_LIFE_ID} white_bed 1`);
    for (const kind of KINDS.filter((k) => k !== 'sleep')) {
      expect(caseTime(kind)).toBe('day');
      expect(caseSetup(kind).some((c) => c.includes('white_bed'))).toBe(false);
      expect(caseSetup(kind).some((c) => c.includes('time set night'))).toBe(false);
    }
  });

  it('empties the inventory before every case, and sets the time first', () => {
    for (const kind of KINDS) {
      const commands = caseSetup(kind);
      expect(commands[0]).toBe(`time set ${caseTime(kind)}`);
      expect(commands[1]).toBe(`clear ${ADAM_LIFE_ID}`);
    }
  });
});

describe('planEvidence', () => {
  const good = thought('t_good', true);
  const bad = thought('t_bad', false);

  it('is null until an intent of a valid thought or a completed action appears', () => {
    expect(planEvidence([good], [], [])).toBeNull();
    expect(planEvidence([bad], [intent('i1', 't_bad')], [])).toBeNull();
    expect(planEvidence([good], [intent('i1', null)], [])).toBeNull();
    expect(planEvidence([good], [], [action('a1', 'i1', 'running')])).toBeNull();
  });

  it('accepts an intent made from a valid thought, whatever its state', () => {
    expect(planEvidence([good], [intent('i1', 't_good', 'failed')], [])).toEqual({
      via: 'intent',
      id: 't_good',
      state: 'failed',
    });
  });

  it('accepts a completed action when the case has a valid thought and no intent', () => {
    const actions = [action('a1', 'i1', 'running'), action('a2', 'i1', 'completed')];
    expect(planEvidence([good], [], actions)).toEqual({
      via: 'action',
      id: 'a2',
      state: 'completed',
    });
  });

  it('does not accept actions without a valid thought', () => {
    expect(planEvidence([bad], [], [action('a1', 'i1', 'completed')])).toBeNull();
  });
});
