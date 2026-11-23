import { describe, expect, it } from 'vitest';
import type { PlanCell } from './cell-do.ts';
import { type CellSource, cellsOf } from './cell-source.ts';
import { contendFor } from './contention.ts';
import type { LanePlan } from './lane.ts';
import { type PlanExpand, PlanQueue, type QueueLane } from './queue.ts';

// A restored plan (after a restart) must keep `fresh`: scaffold removal reads the plan's layers
// from it (lane.ts removalsFor). Without `fresh` the restored lane removes no scaffold at all.

function cell(x: number): PlanCell {
  return { at: { x, y: 64, z: 0 }, prior: 'air', target: 'stone' };
}

const expand: PlanExpand = (body) => {
  const cells = (body.steps as { x: number }[]).map((s) => cell(s.x));
  return { at: (i) => cells[i] };
};

/** Records the plan the queue starts on the lane. */
class RecordingLane {
  state: 'idle' | 'running' = 'idle';
  started: LanePlan[] = [];

  start(plan: LanePlan): boolean {
    this.started.push(plan);
    this.state = 'running';
    return true;
  }

  async pauseForReflex(): Promise<void> {}

  resume(): void {}

  async endForDeath(): Promise<void> {
    this.state = 'idle';
  }

  checkpointState(): null {
    return null;
  }
}

describe('plan queue restore keeps scaffold removal (review 6 F2)', () => {
  it('a restored plan carries fresh, and each fresh read walks the plan again', async () => {
    const lane = new RecordingLane();
    const queue = new PlanQueue({
      lifeId: 'life-1',
      lane: lane as unknown as QueueLane,
      contention: contendFor(lane as never),
      expand,
    });
    const entry = {
      planId: 'p1',
      chunks: 1,
      plan: { format: 2 as const, body: { palette: {}, steps: [{ x: 0 }, { x: 1 }, { x: 2 }] } },
    };
    expect(await queue.restore(entry, 1)).toBe(true);
    const plan = lane.started[0];
    expect(plan?.cursor).toBe(1);
    const fresh = plan?.fresh;
    expect(fresh).toBeDefined();
    const xs = (src: CellSource) => cellsOf(src).map((c) => c.at.x);
    expect(xs((fresh as () => CellSource)())).toEqual([0, 1, 2]);
    expect(xs((fresh as () => CellSource)())).toEqual([0, 1, 2]);
  });
});
