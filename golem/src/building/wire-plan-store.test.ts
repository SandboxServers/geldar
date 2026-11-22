import { describe, expect, it, vi } from 'vitest';
import type { PlanCell } from './cell-do.ts';
import { arrayCellSource, type CellSource } from './cell-source.ts';
import { contendFor } from './contention.ts';
import { PlanLane } from './lane.ts';
import { encodeCheckpoint } from './plan-checkpoint.ts';
import { CHUNK_LIMIT_BYTES, chunkKey, type PlanKv } from './plan-store.ts';
import {
  type PlanBody,
  type PlanExpand,
  PlanQueue,
  type PlanQueueStore,
  type QueueLane,
} from './queue.ts';
import { createPlanSource, pinOrigin } from './wire-expand.ts';
import { PlanPersistence, resumePlanLane } from './wire-plan-store.ts';

/** An in-memory bucket; `failPut` makes every write reject. */
type MemoryKv = PlanKv & { data: Map<string, string> };

function memoryKv(options: { failPut?: boolean } = {}): MemoryKv {
  const data = new Map<string, string>();
  return {
    data,
    async put(key, value) {
      if (options.failPut) throw new Error('bucket down');
      data.set(key, value);
      return data.size;
    },
    async get(key) {
      return data.get(key) ?? null;
    },
    async delete(key) {
      data.delete(key);
    },
  };
}

function cellsOf(count: number, pad = 0): PlanCell[] {
  return Array.from({ length: count }, (_, i) => ({
    at: { x: i, y: 64, z: 0 },
    prior: null,
    target: `stone${'x'.repeat(pad)}`,
  }));
}

const LIFE = 'life-1';
const FEET = () => ({ x: 0, y: 64, z: 0 });

/** The fake expander: a body's steps are the cells themselves. */
const fakeExpand: PlanExpand = (body) => arrayCellSource(body.steps as PlanCell[]);

/** A plan body whose fake expander returns the given cells (as its steps). */
function body(cells: PlanCell[]): PlanBody {
  return { palette: {}, steps: cells };
}

/** Every cell a source holds, read to its end. */
function readAll(source: CellSource): PlanCell[] {
  const out: PlanCell[] = [];
  for (let cell = source.at(0); cell !== undefined; cell = source.at(out.length)) out.push(cell);
  return out;
}

/** The chunk keys of one plan in a bucket. */
function chunksOf(plans: MemoryKv, planId: string): number {
  return [...plans.data.keys()].filter((k) => k.startsWith(`${LIFE}.${planId}.`)).length;
}

function setup(
  options: {
    store?: PlanQueueStore | null;
    plans?: MemoryKv;
    checkpoints?: MemoryKv;
    expand?: PlanExpand;
    pin?: (body: PlanBody) => PlanBody;
  } = {},
) {
  const plans = options.plans ?? memoryKv();
  const checkpoints = options.checkpoints ?? memoryKv();
  const lines: string[] = [];
  const persistence = new PlanPersistence({
    lifeId: LIFE,
    plans,
    checkpoints,
    log: (line) => lines.push(line),
  });
  const lane = new PlanLane();
  const queue = new PlanQueue({
    lifeId: LIFE,
    lane,
    contention: contendFor(lane),
    expand: options.expand ?? fakeExpand,
    ...(options.pin === undefined ? {} : { pin: options.pin }),
    ...(options.store === undefined
      ? { store: persistence }
      : options.store === null
        ? {}
        : { store: options.store }),
  });
  return { plans, checkpoints, persistence, lane, queue, lines };
}

/**
 * A lane that holds no cells: it starts when given a plan and stays running. With `dies`, its
 * first step ends the run (idle, as a death does), so the queue's store path runs without a bot.
 */
function fakeLane(dies = false): QueueLane {
  const lane = {
    state: 'idle' as QueueLane['state'],
    start() {
      lane.state = 'running' as QueueLane['state'];
      return true;
    },
    async step() {
      if (dies) lane.state = 'idle' as QueueLane['state'];
    },
    async pauseForReflex() {},
    resume() {},
    async endForDeath() {
      lane.state = 'idle' as QueueLane['state'];
    },
    checkpointState: () => null,
  };
  return lane as QueueLane;
}

/** The encoded checkpoint of this life at cursor 4 of the given plan. */
function checkpointOf(planId: string, chunks: number): string {
  return encodeCheckpoint({
    life_id: LIFE,
    plan_id: planId,
    chunks,
    cursor: 4,
    counts: {},
    skipped: [],
  });
}

describe('PlanPersistence through the queue', () => {
  it('stores a queued plan as its steps in chunks and reads the body back', async () => {
    const { plans, persistence, queue } = setup();
    const cells = cellsOf(3000, 100);
    const reply = await queue.submit({ planId: 'p1', op: 'add', final: true, body: body(cells) });
    expect(reply.kind).toBe('queued');
    const chunks = [...plans.data.keys()].length;
    expect(chunks).toBeGreaterThan(1);
    for (const value of plans.data.values()) {
      expect(Buffer.byteLength(value, 'utf8')).toBeLessThanOrEqual(CHUNK_LIMIT_BYTES);
    }
    expect(await persistence.readRecord('p1', chunks)).toEqual({
      format: 2,
      body: body(cells),
    });
  });

  it('a radius-120 sphere add stores under 64 KiB: the steps, not the cells', async () => {
    const palette = { s: { block: 'stone' } };
    const { plans, queue } = setup({
      expand: createPlanSource(FEET),
      pin: (b) => pinOrigin(b, FEET),
    });
    const sphere = {
      palette,
      steps: [{ op: 'sphere', pal: 's', center: { x: 0, y: 64, z: 0 }, radius: 120 }],
    };
    const reply = await queue.submit({ planId: 'p1', op: 'add', final: true, body: sphere });
    expect(reply).toMatchObject({ kind: 'queued' });
    // A big plan: the cells would be far over the limit, so the record is the steps alone.
    expect(reply.kind === 'queued' && reply.cells).toBeGreaterThan(100_000);
    const stored = [...plans.data.values()].reduce((n, v) => n + Buffer.byteLength(v, 'utf8'), 0);
    expect(stored).toBeLessThan(64 * 1024);
  });

  it('refuses the plan and queues nothing when the store write fails', async () => {
    const failing = setup({ plans: memoryKv({ failPut: true }) });
    const reply = await failing.queue.submit({
      planId: 'p1',
      op: 'add',
      final: true,
      body: body(cellsOf(2)),
    });
    expect(reply).toMatchObject({ kind: 'refused' });
    expect(reply.kind === 'refused' && reply.message).toContain('not stored');
    // Nothing was kept, so the same plan is not known and a second try reaches the store again.
    const again = await failing.queue.submit({
      planId: 'p1',
      op: 'add',
      final: true,
      body: body(cellsOf(2)),
    });
    expect(again.kind).toBe('refused');
  });

  it('removes the chunks when a queued plan is cancelled', async () => {
    const { plans, queue } = setup();
    await queue.submit({ planId: 'p1', op: 'add', final: true, body: body(cellsOf(3000, 100)) });
    expect(plans.data.size).toBeGreaterThan(0);
    expect(await queue.cancel('p1')).toBe(1);
    expect([...plans.data.keys()].filter((k) => k.startsWith(`${LIFE}.p1.`))).toEqual([]);
  });

  it('drops the surplus chunks when a plan is replaced by a shorter one', async () => {
    const { plans, queue } = setup();
    await queue.submit({ planId: 'p1', op: 'add', final: true, body: body(cellsOf(3000, 100)) });
    const before = plans.data.size;
    expect(before).toBeGreaterThan(1);
    await queue.submit({ planId: 'p1', op: 'replace', final: true, body: body(cellsOf(2)) });
    expect([...plans.data.keys()]).toEqual([chunkKey(LIFE, 'p1', 0)]);
  });

  it('replace of a waiting plan stores the steps of the replacement', async () => {
    const { plans, persistence, queue } = setup();
    await queue.submit({ planId: 'p1', op: 'add', final: true, body: body(cellsOf(10)) });
    await queue.submit({ planId: 'p2', op: 'add', final: true, body: body(cellsOf(10)) });
    const steps = cellsOf(3);
    const reply = await queue.submit({
      planId: 'p2',
      op: 'replace',
      final: true,
      body: body(steps),
    });
    expect(reply).toMatchObject({ kind: 'queued', position: 2 });
    expect(await persistence.readRecord('p2', chunksOf(plans, 'p2'))).toEqual({
      format: 2,
      body: body(steps),
    });
  });

  it('an active plan replaced keeps storing cells (the known gap), not steps', async () => {
    const plans = memoryKv();
    const lane = fakeLane();
    const persistence = new PlanPersistence({
      lifeId: LIFE,
      plans,
      checkpoints: memoryKv(),
      log: () => {},
    });
    const queue = new PlanQueue({
      lifeId: LIFE,
      lane,
      contention: contendFor(lane as unknown as PlanLane),
      expand: fakeExpand,
      store: persistence,
    });
    await queue.submit({ planId: 'p1', op: 'add', final: true, body: body(cellsOf(10)) });
    await queue.step({} as never, {} as never);
    expect(lane.state).toBe('running');
    const reply = await queue.submit({
      planId: 'p1',
      op: 'replace',
      final: true,
      body: body(cellsOf(4)),
    });
    expect(reply).toMatchObject({ kind: 'queued', cells: 4 });
    expect(await persistence.readRecord('p1', chunksOf(plans, 'p1'))).toEqual({
      format: 1,
      cells: cellsOf(4),
    });
  });

  it('a plan that ends in the lane (a death) leaves no record behind', async () => {
    const plans = memoryKv();
    const lane = fakeLane(true);
    const queue = new PlanQueue({
      lifeId: LIFE,
      lane,
      contention: contendFor(lane as unknown as PlanLane),
      expand: fakeExpand,
      store: new PlanPersistence({ lifeId: LIFE, plans, checkpoints: memoryKv(), log: () => {} }),
    });
    await queue.submit({ planId: 'p1', op: 'add', final: true, body: body(cellsOf(10)) });
    expect(plans.data.size).toBeGreaterThan(0);
    await queue.step({} as never, {} as never);
    expect(plans.data.size).toBe(0);
  });

  it('keeps going when the store has no hook (in memory, as before)', async () => {
    const { plans, queue } = setup({ store: null });
    const reply = await queue.submit({
      planId: 'p1',
      op: 'add',
      final: true,
      body: body(cellsOf(2)),
    });
    expect(reply.kind).toBe('queued');
    expect(plans.data.size).toBe(0);
  });
});

describe('resumePlanLane', () => {
  it('returns none when no checkpoint is saved', async () => {
    const { persistence, queue } = setup();
    expect(await resumePlanLane(queue, persistence)).toBe('none');
  });

  it('puts the saved plan back from its checkpoint cursor', async () => {
    const cells = cellsOf(10);
    const first = setup();
    await first.queue.submit({ planId: 'p1', op: 'add', final: true, body: body(cells) });
    const chunks = first.plans.data.size;
    first.checkpoints.data.set(
      `${LIFE}.plan`,
      encodeCheckpoint({
        life_id: LIFE,
        plan_id: 'p1',
        chunks,
        cursor: 4,
        counts: {},
        skipped: [],
      }),
    );
    // A new process: same buckets, empty queue and lane.
    const second = setup({ plans: first.plans, checkpoints: first.checkpoints });
    expect(await resumePlanLane(second.queue, second.persistence)).toBe('resumed');
    expect(second.lane.state).toBe('running');
    expect(second.lane.checkpointState()).toMatchObject({ plan_id: 'p1', cursor: 4 });
  });

  it('a format 1 record stored before this change still loads and runs', async () => {
    const cells = cellsOf(10);
    const first = setup();
    await first.persistence.stored('p1', { format: 1, cells });
    const chunks = first.plans.data.size;
    first.checkpoints.data.set(`${LIFE}.plan`, checkpointOf('p1', chunks));
    const second = setup({ plans: first.plans, checkpoints: first.checkpoints });
    expect(await second.persistence.readRecord('p1', chunks)).toEqual({ format: 1, cells });
    expect(await resumePlanLane(second.queue, second.persistence)).toBe('resumed');
    expect(second.lane.state).toBe('running');
    expect(second.lane.checkpointState()).toMatchObject({ plan_id: 'p1', cursor: 4 });
  });

  describe.each([
    ['box', { op: 'box', pal: 's', from: { x: 0, y: 60, z: 0 }, to: { x: 3, y: 61, z: 3 } }],
    ['sphere', { op: 'sphere', pal: 's', center: { x: 2, y: 62, z: 2 }, radius: 3 }],
  ])('a %s plan persisted and resumed mid-plan', (_name, step) => {
    it('places the same remaining cells as an uninterrupted run, even from new feet', async () => {
      const palette = { s: { block: 'stone' } };
      const feetAtAdd = () => ({ x: 10, y: 64, z: -4 });
      const feetAfterRestart = () => ({ x: -30, y: 70, z: 22 });
      const planBody = { palette, steps: [step], origin: 'here' };
      const uninterrupted = readAll(createPlanSource(feetAtAdd)(pinOrigin(planBody, feetAtAdd)));
      expect(uninterrupted.length).toBeGreaterThan(4);

      const first = setup({
        expand: createPlanSource(feetAtAdd),
        pin: (b) => pinOrigin(b, feetAtAdd),
      });
      await first.queue.submit({ planId: 'p1', op: 'add', final: true, body: planBody });
      const chunks = chunksOf(first.plans, 'p1');
      first.checkpoints.data.set(`${LIFE}.plan`, checkpointOf('p1', chunks));

      const second = setup({
        plans: first.plans,
        checkpoints: first.checkpoints,
        expand: createPlanSource(feetAfterRestart),
        pin: (b) => pinOrigin(b, feetAfterRestart),
      });
      const started = vi.spyOn(second.lane, 'start');
      expect(await resumePlanLane(second.queue, second.persistence)).toBe('resumed');
      const plan = started.mock.calls[0]?.[0];
      expect(plan?.total).toBe(uninterrupted.length);
      const remaining: PlanCell[] = [];
      for (let i = 4; ; i++) {
        const cell = plan?.source.at(i);
        if (cell === undefined) break;
        remaining.push(cell);
      }
      expect(remaining).toEqual(uninterrupted.slice(4));
    });
  });

  it('keeps the active plan checkpoint when a waiting plan is cancelled', async () => {
    const first = setup();
    await first.queue.submit({ planId: 'p1', op: 'add', final: true, body: body(cellsOf(10)) });
    const chunks = first.plans.data.size;
    await first.queue.submit({ planId: 'p2', op: 'add', final: true, body: body(cellsOf(10)) });
    const key = `${LIFE}.plan`;
    first.checkpoints.data.set(key, checkpointOf('p1', chunks));
    expect(await first.queue.cancel('p2')).toBe(1);
    expect(first.checkpoints.data.get(key)).toBe(checkpointOf('p1', chunks));
    const second = setup({ plans: first.plans, checkpoints: first.checkpoints });
    expect(await resumePlanLane(second.queue, second.persistence)).toBe('resumed');
    expect(second.lane.checkpointState()).toMatchObject({ plan_id: 'p1' });
  });

  it('removes the checkpoint when the active plan itself is cancelled', async () => {
    const first = setup();
    await first.queue.submit({ planId: 'p1', op: 'add', final: true, body: body(cellsOf(10)) });
    const key = `${LIFE}.plan`;
    first.checkpoints.data.set(key, checkpointOf('p1', first.plans.data.size));
    expect(await first.queue.cancel('p1')).toBe(1);
    expect(first.checkpoints.data.has(key)).toBe(false);
  });

  it('fails without running anything when a chunk of the plan is missing', async () => {
    const cells = cellsOf(3000, 100);
    const first = setup();
    await first.queue.submit({ planId: 'p1', op: 'add', final: true, body: body(cells) });
    const chunks = first.plans.data.size;
    first.checkpoints.data.set(
      `${LIFE}.plan`,
      encodeCheckpoint({
        life_id: LIFE,
        plan_id: 'p1',
        chunks,
        cursor: 0,
        counts: {},
        skipped: [],
      }),
    );
    first.plans.data.delete(chunkKey(LIFE, 'p1', 1));
    const second = setup({ plans: first.plans, checkpoints: first.checkpoints });
    const lines: string[] = [];
    expect(await resumePlanLane(second.queue, second.persistence, (l) => lines.push(l))).toBe(
      'failed',
    );
    expect(second.lane.state).toBe('idle');
    expect(lines.some((l) => l.includes('not resumed'))).toBe(true);
  });
});
