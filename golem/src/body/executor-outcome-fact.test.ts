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

const SWAM = 'swim: blocks in water 12, surfacings for air 2';
const STOPPED_AT_10 = 'swim stopped at air 10 with your head in the water';

/** A failed report whose result carries `reason` and `message` the way a failed walk's does. */
function failedWalk(reason: string, message: string): ActionReport {
  return {
    record: { state: 'failed', result: { status: 'failed', reason, message, detail: {} } },
    duplicate: false,
  } as unknown as ActionReport;
}

describe('actionOutcomeOf: the swim facts a goto carries (decision 0194 d)', () => {
  it('carries the swim note as detail_text on an ok goto that swam', () => {
    expect(actionOutcomeOf('goto', 0, okReport({ note: SWAM }))).toMatchObject({
      ok: true,
      detail_text: SWAM,
    });
  });

  it('has no detail_text on an ok goto that did not swim', () => {
    expect(actionOutcomeOf('goto', 0, okReport({ position: {} })).detail_text).toBeUndefined();
  });

  it('carries the air fact as detail_text on a goto stopped at air 10', () => {
    expect(actionOutcomeOf('goto', 0, failedWalk('interrupted', STOPPED_AT_10))).toMatchObject({
      ok: false,
      reason: 'interrupted',
      detail_text: STOPPED_AT_10,
    });
  });

  it('carries no detail on an interrupted goto that was not a swim abort', () => {
    expect(
      actionOutcomeOf('goto', 0, failedWalk('interrupted', 'the path changed under the walk'))
        .detail_text,
    ).toBeUndefined();
  });

  it('keeps the swim wording of an interrupted action other than a goto out of the Mind', () => {
    expect(
      actionOutcomeOf('mine', 0, failedWalk('interrupted', STOPPED_AT_10)).detail_text,
    ).toBeUndefined();
  });
});
