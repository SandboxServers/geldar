/**
 * BLD-16: plan_progress payloads, the cadence, the `wait` sentence and the two plan wakes.
 * Every payload is checked against the generated plan_progress validator.
 */
import { type PlanProgressPayload, validatePlanProgressPayload } from '@geldar/contract';
import { describe, expect, it } from 'vitest';
import { PLAN_WAKE_REASON } from './names.ts';
import {
  buildProgressPayload,
  completedWake,
  MaterialsWait,
  type PlanPhase,
  PROGRESS_SENTENCE_MAX,
  progressDue,
  progressSentence,
} from './progress.ts';

const PLAN = 'castle-1';
const PHASES: readonly PlanPhase[] = [
  'running',
  'paused',
  'waiting_materials',
  'waiting_tps',
  'idle',
  'completed',
  'failed',
];

function valid(payload: PlanProgressPayload): true {
  const ok = validatePlanProgressPayload(payload);
  if (!ok) throw new Error(JSON.stringify(validatePlanProgressPayload.errors));
  return true;
}

describe('buildProgressPayload (BLD-16)', () => {
  it.each(PHASES)('a %s payload validates against the generated schema', (phase) => {
    const payload = buildProgressPayload({
      planId: PLAN,
      total: 40,
      counts: { placed: 3, broken: 1, changed: 2 },
      phase,
    });
    expect(valid(payload)).toBe(true);
  });

  it('a waiting_materials payload with next_need validates and carries the item and count', () => {
    const payload = buildProgressPayload({
      planId: PLAN,
      total: 40,
      counts: { placed: 10 },
      phase: 'waiting_materials',
      nextNeed: { block: 'oak_planks', count: 4 },
    });
    expect(valid(payload)).toBe(true);
    expect(payload.next_need).toEqual({ block: 'oak_planks', count: 4 });
  });

  it('a payload with no plan counts validates with zeros', () => {
    const payload = buildProgressPayload({ planId: PLAN, total: 0, counts: {}, phase: 'idle' });
    expect(valid(payload)).toBe(true);
    expect(payload).toEqual({
      plan_id: PLAN,
      total: 0,
      done: 0,
      placed: 0,
      broken: 0,
      skipped_by_code: {},
      phase: 'idle',
    });
  });

  it('done counts every counted cell; skipped_by_code holds only the skipped codes', () => {
    const payload = buildProgressPayload({
      planId: PLAN,
      total: 9,
      counts: { placed: 3, broken: 2, done_already: 1, changed: 2, blocked: 1 },
      phase: 'running',
    });
    expect(payload.done).toBe(9);
    expect(payload.placed).toBe(3);
    expect(payload.broken).toBe(2);
    expect(payload.skipped_by_code).toEqual({ changed: 2, blocked: 1 });
  });

  it('no next_need key appears unless the plan waits for materials', () => {
    const payload = buildProgressPayload({ planId: PLAN, total: 2, counts: {}, phase: 'running' });
    expect('next_need' in payload).toBe(false);
  });

  it('carries no field beyond the schema: no positions, blocks or seen data', () => {
    const payload = buildProgressPayload({
      planId: PLAN,
      total: 2,
      counts: { placed: 1, changed: 1 },
      phase: 'running',
    });
    expect(Object.keys(payload).sort()).toEqual(
      ['broken', 'done', 'placed', 'phase', 'plan_id', 'skipped_by_code', 'total'].sort(),
    );
  });

  it('the validator refuses an extra field such as a sample position', () => {
    const payload = {
      ...buildProgressPayload({ planId: PLAN, total: 1, counts: {}, phase: 'idle' }),
    };
    const extra = { ...payload, sample: [1, 2, 3] } as unknown as PlanProgressPayload;
    expect(validatePlanProgressPayload(extra)).toBe(false);
  });
});

describe('progressDue cadence (BLD-16)', () => {
  it('is false just under 25 cells and 30 s', () => {
    expect(progressDue(24, 29_999)).toBe(false);
  });

  it('is true at 25 cells, whatever the time', () => {
    expect(progressDue(25, 0)).toBe(true);
  });

  it('is true at 30 s, whatever the cell count', () => {
    expect(progressDue(0, 30_000)).toBe(true);
  });
});

describe('progressSentence (BLD-16)', () => {
  it('names the plan, the counts, the phase and the wanted item, with no owner or position', () => {
    const payload = buildProgressPayload({
      planId: PLAN,
      total: 40,
      counts: { placed: 10, changed: 1 },
      phase: 'waiting_materials',
      nextNeed: { block: 'oak_planks', count: 4 },
    });
    const text = progressSentence(payload);
    expect(text).toContain(PLAN);
    expect(text).toContain('11 of 40 cells done');
    expect(text).toContain('waiting_materials');
    expect(text).toContain('Waiting for 4 oak_planks');
    expect(text).not.toMatch(/owner|\[\s*-?\d+\s*,/);
  });

  it('stays within the bound even for a long plan name and item', () => {
    const payload = buildProgressPayload({
      planId: 'p'.repeat(64),
      total: Number.MAX_SAFE_INTEGER,
      counts: { placed: Number.MAX_SAFE_INTEGER },
      phase: 'waiting_materials',
      nextNeed: { block: 'x'.repeat(64), count: Number.MAX_SAFE_INTEGER },
    });
    const text = progressSentence(payload);
    expect(text.length).toBeLessThanOrEqual(PROGRESS_SENTENCE_MAX);
    expect(text.endsWith('...')).toBe(true);
  });
});

describe('the materials wake and the completed wake (BLD-16)', () => {
  it('running out of oak planks wakes the Mind once with the count', () => {
    const wait = new MaterialsWait();
    const wake = wait.waiting('oak_planks', 6, 10);
    expect(wake?.reason).toBe(PLAN_WAKE_REASON);
    expect(wake?.detail).toContain('missing 4 oak_planks');
    expect(wake?.detail).toContain('have 6, need 10');
  });

  it('the plan keeps waiting: further slices in the same wait do not wake again', () => {
    const wait = new MaterialsWait();
    expect(wait.waiting('oak_planks', 6, 10)).not.toBeNull();
    expect(wait.waiting('oak_planks', 6, 10)).toBeNull();
    expect(wait.waiting('oak_planks', 7, 10)).toBeNull();
  });

  it('a later shortage, after the plan resumed, wakes the Mind again', () => {
    const wait = new MaterialsWait();
    expect(wait.waiting('oak_planks', 6, 10)).not.toBeNull();
    wait.resumed();
    expect(wait.waiting('oak_planks', 0, 4)).not.toBeNull();
  });

  it('a completed plan wakes with goal_completed and its counts', () => {
    const payload = buildProgressPayload({
      planId: PLAN,
      total: 5,
      counts: { placed: 5 },
      phase: 'completed',
    });
    const wake = completedWake(payload);
    expect(wake.reason).toBe('goal_completed');
    expect(wake.detail).toContain('5 of 5 cells done');
  });
});
