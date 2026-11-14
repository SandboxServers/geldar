import { validateActionOutcomePayload } from '@geldar/contract';
import { describe, expect, it } from 'vitest';
import { actionOutcomeOf } from './executor-outcome.ts';
import type { ActionReport } from './executor-types.ts';

/** A finished sleep: completed with the sleepers fact the action put in its detail. */
function sleptReport(sleepers: unknown): ActionReport {
  return {
    record: {
      state: 'completed',
      result: { status: 'completed', detail: { bed: { x: 5, y: 64, z: 0 }, sleepers } },
    },
  } as unknown as ActionReport;
}

describe('an ok sleep carries its sleepers fact (decision 0215)', () => {
  it.each<[unknown, string | undefined]>([
    [{ asleep: 1, needed: 2 }, '1 of 2 needed are asleep'],
    [{ asleep: 0, needed: 3 }, '0 of 3 needed are asleep'],
    ['skipped', 'the night was skipped'],
    [null, undefined],
  ])('sleepers %j reads as %s', (sleepers, text) => {
    const out = actionOutcomeOf('sleep', 0, sleptReport(sleepers));
    expect(out.ok).toBe(true);
    expect(out.detail_text).toBe(text);
    expect(validateActionOutcomePayload(out).ok).toBe(true);
  });

  it('a failed sleep keeps its reason text, whatever sleepers it carries', () => {
    const failed = {
      record: {
        state: 'failed',
        result: {
          status: 'failed',
          reason: 'not_possible',
          message: 'it is not night',
          detail: { sleepers: { asleep: 1, needed: 2 } },
        },
      },
    } as unknown as ActionReport;
    const out = actionOutcomeOf('sleep', 0, failed);
    expect(out.ok).toBe(false);
    expect(out.detail_text).toBe('it is not night');
  });

  it('an ok verb other than sleep never reads the sleepers fact', () => {
    const done = {
      record: {
        state: 'completed',
        result: { status: 'completed', detail: { sleepers: { asleep: 1, needed: 2 } } },
      },
    } as unknown as ActionReport;
    expect(actionOutcomeOf('mine', 0, done).detail_text).toBeUndefined();
  });
});
