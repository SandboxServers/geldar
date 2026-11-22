import { describe, expect, it } from 'vitest';
import type { PlanCell } from './cell-do.ts';
import { arrayCellSource } from './cell-source.ts';
import { contendFor } from './contention.ts';
import type { LaneDeps, LanePlan } from './lane.ts';
import {
  type PlanChunk,
  type PlanExpand,
  PlanQueue,
  type PlanQueueStore,
  type QueueLane,
} from './queue.ts';

// Replace of the active plan (review 6 F5): the awaits in the replace let the lane move on, so the
// replace re-checks that the active plan is still the one it read, and refuses when it is not.

const CTX = { signal: new AbortController().signal } as never;
const DEPS = { env: {}, handlers: {}, now: () => 0 } as unknown as LaneDeps;

function cell(x: number, y = 64): PlanCell {
  return { at: { x, y, z: 0 }, prior: 'air', target: 'stone' };
}

const expand: PlanExpand = (body) => {
  const steps = body.steps as { x: number }[];
  return arrayCellSource(steps.map((s) => cell(s.x)));
};

/** Starts plans on the lane and holds the cursor where a test sets it. */
class StubLane {
  state: 'idle' | 'running' = 'idle';
  plan: LanePlan | null = null;
  cursor = 0;

  start(plan: LanePlan): boolean {
    if (this.plan !== null) return false;
    this.plan = plan;
    this.state = 'running';
    return true;
  }

  async step(): Promise<void> {}

  async pauseForReflex(): Promise<void> {}

  resume(): void {}

  async endForDeath(): Promise<void> {
    this.plan = null;
    this.state = 'idle';
  }

  checkpointState(): { cursor: number } | null {
    return this.plan === null ? null : { cursor: this.cursor };
  }
}

/** A store whose `stored` can be held open (to let the lane or a cancel move in between). */
function gatedStore() {
  const dropped: string[] = [];
  const hold = { on: false, failNext: false };
  let entered!: () => void;
  const enteredSeen = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const store: PlanQueueStore = {
    async stored() {
      if (hold.failNext) {
        hold.failNext = false;
        throw new Error('disk full');
      }
      if (hold.on) {
        entered();
        await gate;
      }
      return 1;
    },
    async dropped(planId) {
      dropped.push(planId);
    },
    progressed() {},
  };
  return { store, dropped, hold, enteredSeen, release: () => release() };
}

function chunk(planId: string, xs: number[], extra: Partial<PlanChunk> = {}): PlanChunk {
  return {
    planId,
    op: 'add',
    final: true,
    body: { palette: {}, steps: xs.map((x) => ({ x })) },
    ...extra,
  };
}

/** A queue with `p1` active on the stub lane, with the given store and yield hook. */
async function activeQueue(
  store: PlanQueueStore | undefined,
  xs: number[],
  yieldLoop?: () => Promise<void>,
) {
  const lane = new StubLane();
  const queue = new PlanQueue({
    lifeId: 'life-1',
    lane: lane as unknown as QueueLane,
    contention: contendFor(lane as never),
    expand,
    ...(store === undefined ? {} : { store }),
    ...(yieldLoop === undefined ? {} : { yieldLoop }),
  });
  await queue.submit(chunk('p1', xs));
  await queue.step(CTX, DEPS);
  return { lane, queue };
}

describe('replace of the active plan (review 6 F5)', () => {
  it('refuses when the active plan is cancelled while the replace is being stored', async () => {
    const gate = gatedStore();
    const { queue } = await activeQueue(gate.store, [0, 1, 2]);
    expect(queue.depth()).toBe(1);
    gate.hold.on = true;
    const replacing = queue.submit(chunk('p1', [0, 5], { op: 'replace' }));
    await gate.enteredSeen;
    expect(await queue.cancel('p1')).toBe(1);
    gate.release();
    expect(await replacing).toMatchObject({
      kind: 'refused',
      message: expect.stringContaining('changed while it was replaced'),
    });
    // Nothing is queued or active: the cancelled plan does not come back, and the record the
    // store took for the replace is dropped again.
    expect(queue.depth()).toBe(0);
    expect(gate.dropped).toEqual(['p1', 'p1']);
  });

  it('a store failure on the replace refuses it and the active plan keeps running', async () => {
    const gate = gatedStore();
    const { queue, lane } = await activeQueue(gate.store, [0, 1, 2]);
    gate.hold.failNext = true;
    expect(await queue.submit(chunk('p1', [0, 5], { op: 'replace' }))).toMatchObject({
      kind: 'refused',
      message: expect.stringContaining('not stored'),
    });
    expect(queue.depth()).toBe(1);
    expect(lane.plan?.planId).toBe('p1');
  });

  it('a replace of a long active plan yields between its placed-key slices (review 6 F4)', async () => {
    let yields = 0;
    const { queue, lane } = await activeQueue(
      undefined,
      Array.from({ length: 2000 }, (_, i) => i),
      async () => {
        yields++;
      },
    );
    lane.cursor = 1500;
    expect(
      await queue.submit(
        chunk(
          'p1',
          Array.from({ length: 2000 }, (_, i) => i),
          { op: 'replace' },
        ),
      ),
    ).toMatchObject({
      kind: 'queued',
      cells: 500,
    });
    // 1500 placed cells are read in slices of 512: two yields between the three slices.
    expect(yields).toBe(2);
  });
});
