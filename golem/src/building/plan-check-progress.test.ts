import { describe, expect, it } from 'vitest';
import {
  answerPlanCheck,
  type PlanCheckBody,
  type PlanCheckProgress,
  PROGRESS_EVERY_MS,
  planCheckFrom,
} from './plan-check-reply.ts';
import type { SeenMap } from './seen/section.ts';
import { COUNT_SLICE } from './wire-expand.ts';

const FEET = { x: 0, y: 64, z: 0 };

/** A sphere of radius 120 about (0, 0, 0) from the feet: the large plan the walk streams. */
const SPHERE_120 = {
  plan: {
    palette: { stone: { block: 'stone' } },
    steps: [{ op: 'sphere', pal: 'stone', center: { x: 0, y: 0, z: 0 }, radius: 120 }],
  },
};

/** A seen map that never knows a cell, counting its reads. */
function countingSeen(): { seen: SeenMap; reads: () => number } {
  let count = 0;
  const seen = {
    read: () => {
      count++;
      return undefined;
    },
  } as unknown as SeenMap;
  return { seen, reads: () => count };
}

/** A body for the dry run; `extra` adds the progress hook, the clock or the slice size. */
function bodyWith(extra: Partial<PlanCheckBody>): { body: PlanCheckBody; reads: () => number } {
  const { seen, reads } = countingSeen();
  return {
    body: { seen, pack: () => ({}), feet: () => FEET, ...extra },
    reads,
  };
}

/** A clock that moves on by `step` ms each time it is read. */
function movingClock(step: number): () => number {
  let now = 0;
  return () => {
    now += step;
    return now;
  };
}

describe('answerPlanCheck progress (the streamed dry run)', () => {
  it('a radius-120 sphere reports progress as it walks, in order, and still answers the count', async () => {
    const reports: PlanCheckProgress[] = [];
    // A slice of one million cells, so the walk yields a few times; the clock moves a full report
    // interval on each read, so every slice reports.
    const { body } = bodyWith({
      sliceFor: () => 1_000_000,
      clock: movingClock(PROGRESS_EVERY_MS),
      progress: (report) => reports.push(report),
    });
    const answer = await answerPlanCheck(body, SPHERE_120, true);
    if (!('cells' in answer)) throw new Error('the sphere must be answered with a count');
    expect(answer.cells).toBeGreaterThan(1_000_000);
    expect(reports.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < reports.length; i++) {
      const prev = reports[i - 1] as PlanCheckProgress;
      const next = reports[i] as PlanCheckProgress;
      expect(next.cells_checked).toBeGreaterThanOrEqual(prev.cells_checked);
      expect(next.layers_done).toBeGreaterThanOrEqual(prev.layers_done);
    }
    const last = reports[reports.length - 1] as PlanCheckProgress;
    expect(last.cells_checked).toBeLessThanOrEqual(answer.cells);
    expect(last.layers_done).toBeLessThanOrEqual(241);
  });

  it('reports nothing while the walk is faster than the report interval', async () => {
    const reports: PlanCheckProgress[] = [];
    const { body } = bodyWith({
      sliceFor: () => 1_000,
      clock: () => 0,
      progress: (report) => reports.push(report),
    });
    const answer = await answerPlanCheck(body, SPHERE_120, true);
    expect('cells' in answer).toBe(true);
    expect(reports).toEqual([]);
  });

  it('paces progress by the clock: a clock that moves less than the interval per read reports fewer times than slices', async () => {
    const reports: PlanCheckProgress[] = [];
    const { body } = bodyWith({
      sliceFor: () => 1_000_000,
      clock: movingClock(PROGRESS_EVERY_MS - 1),
      progress: (report) => reports.push(report),
    });
    const answer = await answerPlanCheck(body, SPHERE_120, true);
    if (!('cells' in answer)) throw new Error('the sphere must be answered with a count');
    // One slice per million cells at least, so at least that many slices ran; the clock reports only
    // once a full interval has passed, which is less often than once per slice.
    expect(reports.length).toBeLessThan(Math.floor(answer.cells / 1_000_000));
  });

  it('a cancel request (not a plan) supersedes the running walk: the walk stops, the cancel is invalid input', async () => {
    const { seen, reads } = countingSeen();
    const bot = {
      inventory: { items: () => [] },
      entity: { position: { x: 0.5, y: 64.5, z: 0.5 } },
    };
    const check = planCheckFrom(seen, bot);
    const first = check(SPHERE_120);
    const readsAtCancel = reads();
    expect(await check({ cancel: true })).toEqual({ error: 'invalid_input' });
    expect(await first).toEqual({ error: 'not_available' });
    expect(reads()).toBeLessThanOrEqual(readsAtCancel + COUNT_SLICE);
  });

  it('after the cancel no walk keeps reading the map', async () => {
    const { seen, reads } = countingSeen();
    const bot = {
      inventory: { items: () => [] },
      entity: { position: { x: 0.5, y: 64.5, z: 0.5 } },
    };
    const check = planCheckFrom(seen, bot);
    const first = check(SPHERE_120);
    await check({ cancel: true });
    await first;
    const settled = reads();
    await new Promise((resolve) => setImmediate(resolve));
    expect(reads()).toBe(settled);
  });
});
