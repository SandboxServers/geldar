import { describe, expect, it } from 'vitest';
import {
  validateIntentEventPayload,
  validateReflexFiredPayload,
  validateWakePayload,
} from '../src/index.ts';

const intent = {
  intent_id: 'in_01HZX3V9Q4M2K8R7T6Y5W4E3D5',
  life_id: 'ag_kestrel_01',
  body_generation: 2,
  state: 'running',
  tick: 1200,
};

const reflex = {
  name: 'eat',
  life_id: 'ag_kestrel_01',
  body_generation: 2,
  tick: 1300,
  trigger: { hunger: 12, food: 'bread', hungry: true, bed: null },
  outcome: { result: 'handled' },
};

const wake = { reason: 'new_agent_within_8', tick: 1400, intent_id: null };

describe('record event payloads', () => {
  it('accepts a valid intent, reflex and wake payload', () => {
    expect(validateIntentEventPayload(intent).ok).toBe(true);
    expect(validateIntentEventPayload({ ...intent, state: 'paused', detail: 'reflex' }).ok).toBe(
      true,
    );
    expect(validateReflexFiredPayload(reflex).ok).toBe(true);
    expect(validateWakePayload(wake).ok).toBe(true);
    expect(
      validateWakePayload({ ...wake, reason: 'limit_reached', intent_id: intent.intent_id }).ok,
    ).toBe(true);
  });

  it.each([
    ['an unknown intent state', () => validateIntentEventPayload({ ...intent, state: 'done' })],
    ['an intent with no life', () => validateIntentEventPayload({ ...intent, life_id: undefined })],
    ['an intent with an extra field', () => validateIntentEventPayload({ ...intent, extra: 1 })],
    ['a bad intent id', () => validateIntentEventPayload({ ...intent, intent_id: 'in_x' })],
    [
      'a reflex trigger holding an object',
      () => validateReflexFiredPayload({ ...reflex, trigger: { at: { x: 1 } } }),
    ],
    [
      'a reflex outcome that is not a result',
      () => validateReflexFiredPayload({ ...reflex, outcome: { result: 'maybe' } }),
    ],
    ['an unknown wake reason', () => validateWakePayload({ ...wake, reason: 'bored' })],
    ['a wake with no intent_id', () => validateWakePayload({ reason: 'goal_completed', tick: 1 })],
  ])('rejects %s', (_name, run) => {
    expect(run().ok).toBe(false);
  });
});
