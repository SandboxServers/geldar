import { describe, expect, it } from 'vitest';
import {
  type BodyIdentity,
  checkValidity,
  DEFAULT_SNAPSHOT_WINDOW,
  type PlanIdentity,
  type RejectReason,
} from './validity.ts';

const body: BodyIdentity = {
  lifeId: 'ag_test_01',
  bodyGeneration: 3,
  currentRevision: 10,
  tick: 500,
};
const plan: PlanIdentity = {
  lifeId: 'ag_test_01',
  bodyGeneration: 3,
  snapshotRevision: 10,
  expiresTick: 600,
};

describe('checkValidity', () => {
  it('accepts a plan that matches the body', () => {
    expect(checkValidity(plan, body)).toBeNull();
  });

  const cases: Array<[string, Partial<PlanIdentity>, Partial<BodyIdentity>, RejectReason]> = [
    ['a dead (other) life', { lifeId: 'ag_test_00' }, {}, 'wrong_life'],
    ['a stale generation', { bodyGeneration: 2 }, {}, 'stale_generation'],
    ['a generation from the future', { bodyGeneration: 4 }, {}, 'stale_generation'],
    [
      'a snapshot older than the window',
      { snapshotRevision: 10 - DEFAULT_SNAPSHOT_WINDOW - 1 },
      {},
      'stale_snapshot',
    ],
    ['a plan that expires now', { expiresTick: 500 }, {}, 'expired'],
    ['a plan that expired long ago', { expiresTick: 12 }, {}, 'expired'],
  ];
  it.each(cases)('rejects %s', (_name, planChange, bodyChange, reason) => {
    const verdict = checkValidity({ ...plan, ...planChange }, { ...body, ...bodyChange });
    expect(verdict?.reason).toBe(reason);
    expect(verdict?.detail.length).toBeGreaterThan(0);
  });

  it('accepts a snapshot exactly at the window edge, and a newer one than the body has', () => {
    const edge = { ...plan, snapshotRevision: 10 - DEFAULT_SNAPSHOT_WINDOW };
    expect(checkValidity(edge, body)).toBeNull();
    expect(checkValidity({ ...plan, snapshotRevision: 11 }, body)).toBeNull();
  });

  it('honours a custom window', () => {
    const old = { ...plan, snapshotRevision: 7 };
    expect(checkValidity(old, body, 2)?.reason).toBe('stale_snapshot');
    expect(checkValidity(old, body, 3)).toBeNull();
    expect(checkValidity({ ...plan, snapshotRevision: 9 }, body, 0)?.reason).toBe('stale_snapshot');
  });

  it('reports the life first when several things are wrong', () => {
    const bad = { ...plan, lifeId: 'ag_other_01', bodyGeneration: 0, expiresTick: 1 };
    expect(checkValidity(bad, body)?.reason).toBe('wrong_life');
  });
});
