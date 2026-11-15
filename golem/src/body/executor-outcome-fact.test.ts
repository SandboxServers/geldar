import { describe, expect, it } from 'vitest';
import { actionOutcomeOf } from './executor-outcome.ts';
import type { ActionReport } from './executor-types.ts';

const MOIST = 'this farmland is moist: water is within 4 blocks';

/** A finished, ok report whose result carries `detail` the way a completed action's does. */
function okReport(detail: Record<string, unknown>): ActionReport {
  return {
    record: { state: 'completed', result: { detail } },
    duplicate: false,
  } as unknown as ActionReport;
}

describe('actionOutcomeOf: the farmland fact an ok till or seed planting carries', () => {
  it('carries the till fact as detail_text on an ok till', () => {
    expect(actionOutcomeOf('till', 0, okReport({ block: 'farmland', fact: MOIST }))).toMatchObject({
      ok: true,
      detail_text: MOIST,
    });
  });

  it('carries the fact as detail_text on an ok seed planting', () => {
    expect(actionOutcomeOf('place', 1, okReport({ block: 'wheat', fact: MOIST }))).toMatchObject({
      ok: true,
      detail_text: MOIST,
    });
  });

  it('has no detail_text on an ok till without a fact', () => {
    expect(actionOutcomeOf('till', 0, okReport({ block: 'dirt' })).detail_text).toBeUndefined();
  });

  it('ignores a fact on a verb that carries none', () => {
    expect(actionOutcomeOf('mine', 0, okReport({ fact: MOIST })).detail_text).toBeUndefined();
  });
});
