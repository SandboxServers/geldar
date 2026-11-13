import { validateActionOutcomePayload } from '@geldar/contract';
import { describe, expect, it } from 'vitest';
import { actionOutcomeOf } from './executor-outcome.ts';
import type { ActionReport } from './executor-types.ts';

function failedReport(reason: string, message: string): ActionReport {
  return {
    record: { state: 'failed', result: { status: 'failed', reason, message, detail: {} } },
  } as unknown as ActionReport;
}

describe('action_outcome detail_text', () => {
  it.each([
    ['craft', 'missing_materials', 'need 2 more planks'],
    ['craft', 'missing_station', 'need 2 more planks; no crafting table within 32 blocks'],
    ['craft', 'timeout', 'crafting stick ran out of time while walking: made 1 of 4'],
    ['mine', 'no_effect', 'The mine was expected to gain 3 items; you gained 0.'],
    ['goto', 'needs_rescue', 'no way out: tried jump, dig, pillar'],
    ['mine', 'not_possible', 'bedrock cannot be broken by anyone, with any tool'],
  ])('%s %s carries its sentence', (verb, reason, message) => {
    const out = actionOutcomeOf(verb, 0, failedReport(reason, message));
    expect(out.detail_text).toBe(message.replace(/\.$/, ''));
    expect(validateActionOutcomePayload(out).ok).toBe(true);
  });

  it('carries nothing for a success or an unrelated failure', () => {
    const done = { record: { state: 'completed', result: { status: 'completed' } } };
    expect(actionOutcomeOf('mine', 0, done as unknown as ActionReport).detail_text).toBeUndefined();
    // blocked and timeout now carry their plain detail; only unrelated reasons carry nothing.
    const blocked = actionOutcomeOf('goto', 0, failedReport('blocked', 'path is blocked'));
    expect(blocked.detail_text).toBe('path is blocked');
  });
});
