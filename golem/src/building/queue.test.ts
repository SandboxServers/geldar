import { describe, expect, it } from 'vitest';
import { completed, failed } from '../actions/outcome.ts';
import type { PlanCell } from './cell-do.ts';
import { arrayCellSource, type CellSource, cellsOf } from './cell-source.ts';
import { contendFor } from './contention.ts';
import type { PlanCheckpointState } from './plan-checkpoint.ts';
import { type PlanChunk, type PlanExpand, PlanQueue } from './queue.ts';
import { planHandler } from './queue-action.ts';

const CTX = { signal: new AbortController().signal } as never;
const DEPS = { env: {}, handlers: {}, now: () => 0 } as never;

function cell(x: number): PlanCell {
  return { at: { x, y: 64, z: 0 }, prior: 'air', target: 'stone' };
}

/** Steps are `{ x }`; a step with `bad: true` does not expand. */
const expand: PlanExpand = (body) => {
  const steps = body.steps as { x: number; bad?: boolean }[];
  if (steps.some((s) => s.bad === true)) throw new Error('bad step');
  return arrayCellSource(steps.map((s) => cell(s.x)));
};

/** A lane fake with the PlanLane surface the queue uses: one cell per `step`. */
class FakeLane {
  state: 'idle' | 'running' | 'paused' = 'idle';
  plan: { planId: string; cells: readonly PlanCell[] } | null = null;
  cursor = 0;
  started: string[] = [];
  ran: string[] = [];
  drops = 0;
  pauses = 0;

  start(plan: { planId: string; source: CellSource; total: number }): boolean {
    if (this.plan !== null) return false;
    this.plan = { planId: plan.planId, cells: cellsOf(plan.source) };
    this.cursor = 0;
    this.state = 'running';
    this.started.push(plan.planId);
    return true;
  }

  async step(): Promise<void> {
    if (this.state !== 'running' || this.plan === null) return;
    this.ran.push(`${this.plan.planId}:${this.cursor}`);
    this.cursor++;
    if (this.cursor >= this.plan.cells.length) {
      this.plan = null;
      this.state = 'idle';
    }
  }

  async pauseForReflex(): Promise<void> {
    if (this.plan === null) return;
    this.pauses++;
    this.state = 'paused';
  }

  resume(): void {
    if (this.state === 'paused' && this.plan !== null) this.state = 'running';
  }

  async endForDeath(): Promise<void> {
    this.drops++;
    this.plan = null;
    this.state = 'idle';
    this.cursor = 0;
  }

  checkpointState(): PlanCheckpointState | null {
    return this.plan === null ? null : ({ cursor: this.cursor } as PlanCheckpointState);
  }
}

function fixture() {
  const lane = new FakeLane();
  const contention = contendFor(lane);
  const queue = new PlanQueue({ lifeId: 'life-1', lane, contention, expand });
  return { lane, contention, queue };
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

describe('plan queue (BLD-14)', () => {
  it('add in three chunks then a final starts the plan', async () => {
    const { lane, queue } = fixture();
    expect(await queue.submit(chunk('p1', [0], { final: false, seq: 0 }))).toEqual({
      kind: 'uploading',
      nextSeq: 1,
    });
    expect(await queue.submit(chunk('p1', [1], { final: false, seq: 1 }))).toEqual({
      kind: 'uploading',
      nextSeq: 2,
    });
    expect(await queue.submit(chunk('p1', [2], { seq: 2 }))).toEqual({
      kind: 'queued',
      cells: 3,
      position: 1,
    });
    expect(lane.started).toEqual([]);
    await queue.step(CTX, DEPS);
    expect(lane.started).toEqual(['p1']);
    expect(lane.plan?.cells.map((c) => c.at.x)).toEqual([0, 1, 2]);
    expect(lane.ran).toEqual(['p1:0']);
  });

  it('a bad seq refuses and drops the upload; the Mind sends again from seq 0', async () => {
    const { queue } = fixture();
    await queue.submit(chunk('p1', [0], { final: false, seq: 0 }));
    expect(await queue.submit(chunk('p1', [2], { seq: 2 }))).toMatchObject({ kind: 'refused' });
    expect(await queue.submit(chunk('p1', [1], { seq: 1 }))).toMatchObject({ kind: 'refused' });
    expect(await queue.submit(chunk('p1', [5], { final: false, seq: 0 }))).toEqual({
      kind: 'uploading',
      nextSeq: 1,
    });
  });

  it('a chunk that is not final and has no seq is refused', async () => {
    const { lane, queue } = fixture();
    expect(await queue.submit(chunk('p1', [0], { final: false }))).toMatchObject({
      kind: 'refused',
    });
    await queue.step(CTX, DEPS);
    expect(lane.started).toEqual([]);
  });

  it('a plan that does not expand is refused and nothing is queued', async () => {
    const { lane, queue } = fixture();
    const bad = chunk('p9', [], { body: { palette: {}, steps: [{ x: 1, bad: true }] } });
    expect(await queue.submit(bad)).toMatchObject({ kind: 'refused' });
    await queue.step(CTX, DEPS);
    expect(lane.started).toEqual([]);
  });

  it('one plan runs at a time and the next starts when the first ends', async () => {
    const { lane, queue } = fixture();
    await queue.submit(chunk('p1', [0]));
    await queue.submit(chunk('p2', [0]));
    await queue.step(CTX, DEPS);
    expect(lane.started).toEqual(['p1']);
    await queue.step(CTX, DEPS);
    expect(lane.started).toEqual(['p1', 'p2']);
  });

  it('a duplicate plan_id is refused while queued or active', async () => {
    const { queue } = fixture();
    await queue.submit(chunk('p1', [0, 1]));
    expect(await queue.submit(chunk('p1', [0]))).toMatchObject({ kind: 'refused' });
    await queue.step(CTX, DEPS);
    expect(await queue.submit(chunk('p1', [0]))).toMatchObject({ kind: 'refused' });
  });

  it('replace discards unexecuted cells and keeps the placed ones', async () => {
    const { lane, queue } = fixture();
    await queue.submit(chunk('p1', [0, 1, 2, 3]));
    await queue.step(CTX, DEPS);
    await queue.step(CTX, DEPS);
    expect(lane.ran).toEqual(['p1:0', 'p1:1']);
    expect(await queue.submit(chunk('p1', [0, 1, 4, 5], { op: 'replace' }))).toEqual({
      kind: 'queued',
      cells: 2,
      position: 1,
    });
    expect(lane.drops).toBe(1);
    await queue.step(CTX, DEPS);
    expect(lane.started).toEqual(['p1', 'p1']);
    expect(lane.plan?.cells.map((c) => c.at.x)).toEqual([4, 5]);
  });

  it('replace of a queued plan keeps its place and of an unknown plan is refused', async () => {
    const { queue } = fixture();
    await queue.submit(chunk('p1', [0, 1]));
    await queue.submit(chunk('p2', [0]));
    await queue.submit(chunk('p3', [0]));
    expect(await queue.submit(chunk('p2', [7, 8], { op: 'replace' }))).toEqual({
      kind: 'queued',
      cells: 2,
      position: 2,
    });
    expect(await queue.submit(chunk('zz', [1], { op: 'replace' }))).toMatchObject({
      kind: 'refused',
    });
  });

  it('cancel stops within one slice and a queued plan is removed', async () => {
    const { lane, queue } = fixture();
    await queue.submit(chunk('p1', [0, 1, 2, 3, 4]));
    await queue.submit(chunk('p2', [0]));
    await queue.step(CTX, DEPS);
    expect(await queue.cancel('p1')).toBe(1);
    expect(lane.drops).toBe(1);
    expect(await queue.cancel('p2')).toBe(1);
    await queue.step(CTX, DEPS);
    await queue.step(CTX, DEPS);
    expect(lane.ran).toEqual(['p1:0']);
    expect(lane.started).toEqual(['p1']);
  });

  it('cancel of an unknown plan removes nothing; cancel all clears the queue and uploads', async () => {
    const { queue } = fixture();
    await queue.submit(chunk('p1', [0, 1]));
    await queue.submit(chunk('p2', [0]));
    await queue.submit(chunk('p3', [0], { final: false, seq: 0 }));
    expect(await queue.cancel('zzz')).toBe(0);
    expect(await queue.cancel('all')).toBe(2);
    expect(await queue.submit(chunk('p3', [1], { seq: 1 }))).toMatchObject({ kind: 'refused' });
  });

  it('a gather intent pauses the lane at once, the lane resumes when the intent ends, and a reflex still outranks both', async () => {
    const { lane, contention, queue } = fixture();
    await queue.submit(chunk('p1', [0, 1]));
    await queue.step(CTX, DEPS);
    await contention.hold('gather');
    expect(lane.state).toBe('paused');
    await queue.step(CTX, DEPS);
    expect(lane.ran).toEqual(['p1:0']);
    contention.release('gather');
    expect(lane.state).toBe('running');
    await queue.step(CTX, DEPS);
    expect(lane.ran).toEqual(['p1:0', 'p1:1']);

    await queue.submit(chunk('p2', [0, 1]));
    await queue.step(CTX, DEPS);
    await contention.hold('reflex');
    await contention.hold('gather');
    contention.release('gather');
    expect(lane.state).toBe('paused');
    contention.release('reflex');
    expect(lane.state).toBe('running');
  });

  it('a plan started while an intent holds the lane does not run until the intent ends', async () => {
    const { lane, contention, queue } = fixture();
    await contention.hold('travel');
    await queue.submit(chunk('p1', [0]));
    await queue.step(CTX, DEPS);
    expect(lane.started).toEqual(['p1']);
    expect(lane.ran).toEqual([]);
    contention.release('travel');
    await queue.step(CTX, DEPS);
    expect(lane.ran).toEqual(['p1:0']);
  });
});

describe('contention gate (BLD-14)', () => {
  it('the first hold pauses, the last release resumes, and an unknown release does nothing', async () => {
    const { lane, contention } = fixture();
    await queueStart(lane);
    await contention.hold('a');
    await contention.hold('b');
    expect(lane.pauses).toBe(1);
    contention.release('zzz');
    contention.release('a');
    expect(lane.state).toBe('paused');
    contention.release('b');
    expect(lane.state).toBe('running');
    expect(contention.held).toBe(false);
  });
});

async function queueStart(lane: FakeLane): Promise<void> {
  lane.start({ planId: 'x', source: arrayCellSource([cell(0), cell(1)]), total: 2 });
}

describe('plan action with the queue (BLD-14)', () => {
  it('an add runs through the queue and cancel all answers with the count', async () => {
    const { queue } = fixture();
    const handler = planHandler(true, queue);
    const add = { do: 'plan', op: 'add', plan_id: 'p1', palette: {}, steps: [{ x: 0 }] };
    expect(await handler.run(CTX, { ...add, final: true } as never)).toEqual(
      completed({ state: 'queued', cells: 1, position: 1 }),
    );
    expect(await handler.run(CTX, { do: 'plan', op: 'cancel', plan_id: 'all' } as never)).toEqual(
      completed({ cancelled: 1 }),
    );
  });

  it('a refused chunk reports not_possible with the reason', async () => {
    const { queue } = fixture();
    const handler = planHandler(true, queue);
    const out = await handler.run(CTX, {
      do: 'plan',
      op: 'add',
      plan_id: 'p1',
      palette: {},
      steps: [{ x: 1 }],
      final: true,
      seq: 1,
    } as never);
    expect(out).toEqual(
      failed('not_possible', 'plan p1: expected seq 0, got 1; send again from seq 0'),
    );
  });

  it('with the flag off the action is refused, and with no queue it stays not_implemented', async () => {
    const off = planHandler(false);
    const add = { do: 'plan', op: 'add', plan_id: 'p1', palette: {}, steps: [{ x: 0 }] } as never;
    await expect(off.run(CTX, add)).resolves.toMatchObject({ status: 'failed' });
    await expect(planHandler(true).run(CTX, add)).rejects.toThrow('not_implemented: plan');
  });
});
