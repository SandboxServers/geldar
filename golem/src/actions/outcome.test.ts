import { validateActionRecord } from '@geldar/contract';
import { describe, expect, it } from 'vitest';
import { recordFor } from '../../test/live/record.ts';
import {
  type ActionOutcome,
  cancelled,
  completed,
  errorText,
  failed,
  recordState,
  toResult,
} from './outcome.ts';

/** The record for an outcome, built around the `runAction` shape for a `goto`. */
function goRecord(outcome: ActionOutcome) {
  return recordFor(
    'goto',
    { target: 'GolemSmoke' },
    { state: recordState(outcome), result: toResult(outcome, 12, 40) },
  );
}

describe('toResult', () => {
  it('omits reason and message for a completed outcome', () => {
    const result = toResult(completed({ moved: 3 }), 5, 10);
    expect(result).toEqual({
      status: 'completed',
      latency_ms: 5,
      world_ticks: 10,
      detail: { moved: 3 },
    });
    expect(Object.keys(result)).not.toContain('reason');
    expect(Object.keys(result)).not.toContain('message');
  });

  it('keeps reason and message for a failure and no undefined values', () => {
    const result = toResult(failed('blocked', 'no path'), 0, null);
    expect(result).toEqual({
      status: 'failed',
      reason: 'blocked',
      message: 'no path',
      latency_ms: 0,
      world_ticks: null,
      detail: {},
    });
    expect(Object.values(result)).not.toContain(undefined);
  });
});

describe('errorText', () => {
  it('takes the message of an Error and of other thrown values as a string', () => {
    expect(errorText(new Error('boom'))).toBe('boom');
    expect(errorText('plain')).toBe('plain');
    expect(errorText(42)).toBe('42');
  });

  it('cuts the text to 200 characters', () => {
    expect(errorText(new Error('x'.repeat(300)))).toHaveLength(200);
  });
});

describe('recordState', () => {
  it('maps each outcome status to the same record state', () => {
    expect(recordState(completed())).toBe('completed');
    expect(recordState(failed('internal', 'boom'))).toBe('failed');
    expect(recordState(cancelled())).toBe('cancelled');
  });
});

describe('ActionRecord around an outcome', () => {
  it.each([
    ['completed', completed({ moved: 1 })],
    ['failed', failed('timeout', 'no result within 60000 ms')],
    ['cancelled', cancelled()],
  ])('passes validateActionRecord for a %s outcome', (_name, outcome) => {
    const verdict = validateActionRecord(goRecord(outcome));
    expect(verdict.ok, verdict.ok ? '' : verdict.errors.join('; ')).toBe(true);
  });

  it('carries a state that matches the outcome, so a wrong mapping is caught', () => {
    expect(goRecord(completed()).state).toBe('completed');
    expect(goRecord(failed('blocked', 'x')).state).toBe('failed');
    expect(goRecord(cancelled()).state).toBe('cancelled');
  });
});
