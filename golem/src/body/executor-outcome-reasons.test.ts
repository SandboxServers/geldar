import { describe, expect, it, vi } from 'vitest';
import { actionOutcomeOf, emitIntentFailure } from './executor-outcome.ts';
import type { ActionReport } from './executor-types.ts';
import type { RecordSink } from './records.ts';

/** A finished action's report: the record state it ended in and the result it carries. */
function reportOf(state: string, result: unknown): ActionReport {
  return { record: { state, result } } as unknown as ActionReport;
}

describe('actionOutcomeOf: a run stopped before it finished', () => {
  it('maps cancelled to interrupted, with the detail text kept', () => {
    const payload = actionOutcomeOf('mine', 2, reportOf('cancelled', { mined: 1 }));
    expect(payload).toEqual({
      verb: 'mine',
      index: 2,
      ok: false,
      reason: 'interrupted',
      message: 'Your mine failed: something interrupted it.',
      detail_text: 'the action was stopped before it finished',
    });
  });

  it('maps a failed run that reports cancelled as the reason to interrupted too', () => {
    const payload = actionOutcomeOf('walk', 0, reportOf('failed', { reason: 'cancelled' }));
    expect(payload).toMatchObject({ ok: false, reason: 'interrupted' });
  });

  it('keeps a reason the contract lists as it is', () => {
    const payload = actionOutcomeOf('give', 1, reportOf('failed', { reason: 'not_possible' }));
    expect(payload).toMatchObject({ reason: 'not_possible' });
  });

  it('reads a reason that is neither listed nor mapped as internal', () => {
    const payload = actionOutcomeOf('give', 1, reportOf('failed', { reason: 'no_such_code' }));
    expect(payload).toMatchObject({ reason: 'internal' });
  });
});

describe('emitIntentFailure: a stopped intent', () => {
  it('sends the leading cancelled code as interrupted', () => {
    const actionOutcome = vi.fn();
    emitIntentFailure(
      { actionOutcome } as unknown as RecordSink,
      7,
      'travel',
      'cancelled: stopped',
    );
    expect(actionOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'interrupted' }),
      7,
    );
  });
});
