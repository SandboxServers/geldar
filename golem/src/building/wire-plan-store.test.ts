import { describe, expect, it } from 'vitest';
import type { PlanCell } from './cell-do.ts';
import { contendFor } from './contention.ts';
import { PlanLane } from './lane.ts';
import { encodeCheckpoint } from './plan-checkpoint.ts';
import { CHUNK_LIMIT_BYTES, chunkKey, type PlanKv } from './plan-store.ts';
import { PlanQueue, type PlanQueueStore } from './queue.ts';
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

function setup(
  options: { store?: PlanQueueStore | null; plans?: MemoryKv; checkpoints?: MemoryKv } = {},
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
    expand: (body) => (body as unknown as { cells: PlanCell[] }).cells,
    ...(options.store === undefined
      ? { store: persistence }
      : options.store === null
        ? {}
        : { store: options.store }),
  });
  return { plans, checkpoints, persistence, lane, queue, lines };
}

/** A plan body whose fake expander returns the given cells. */
function body(cells: PlanCell[]) {
  return { palette: {}, steps: [], cells } as unknown as {
    palette: Record<string, unknown>;
    steps: unknown[];
  };
}

describe('PlanPersistence through the queue', () => {
  it('stores a queued plan in chunks and reads it back whole', async () => {
    const { plans, persistence, queue } = setup();
    const cells = cellsOf(3000, 100);
    const reply = await queue.submit({ planId: 'p1', op: 'add', final: true, body: body(cells) });
    expect(reply.kind).toBe('queued');
    const chunks = [...plans.data.keys()].length;
    expect(chunks).toBeGreaterThan(1);
    for (const value of plans.data.values()) {
      expect(Buffer.byteLength(value, 'utf8')).toBeLessThanOrEqual(CHUNK_LIMIT_BYTES);
    }
    expect(await persistence.readCells('p1', chunks)).toEqual(cells);
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
