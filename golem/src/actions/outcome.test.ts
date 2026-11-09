import { type ActionRecord, validateActionRecord } from '@geldar/contract';
import { describe, expect, it } from 'vitest';
import { ulid } from '../ulid.ts';
import {
  type ActionOutcome,
  cancelled,
  completed,
  failed,
  recordState,
  toResult,
} from './outcome.ts';

/** A full `ActionRecord` around an outcome, the way the Body stores it. */
function recordFor(outcome: ActionOutcome): ActionRecord {
  return {
    action_id: `ac_${ulid()}`,
    intent_id: null,
    life_id: 'ag_kestrel_01',
    body_generation: 1,
    sequence: 0,
    source_snapshot_id: `sn_${ulid()}`,
    snapshot_revision: 1,
    expires_tick: 24_000,
    kind: 'goto',
    args: { target: 'GolemSmoke' },
    state: recordState(outcome),
    result: { ...toResult(outcome, 12, 40) },
    receipt_id: null,
  };
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
    const verdict = validateActionRecord(recordFor(outcome));
    expect(verdict.ok, verdict.ok ? '' : verdict.errors.join('; ')).toBe(true);
  });

  it('carries a state that matches the outcome, so a wrong mapping is caught', () => {
    expect(recordFor(completed()).state).toBe('completed');
    expect(recordFor(failed('blocked', 'x')).state).toBe('failed');
    expect(recordFor(cancelled()).state).toBe('cancelled');
  });
});
