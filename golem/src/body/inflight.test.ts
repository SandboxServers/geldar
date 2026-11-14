import type { ActionRecord } from '@geldar/contract';
import { describe, expect, it, vi } from 'vitest';
import { receiptIdFor } from './derived-id.ts';
import { planFor } from './executor.fakes.ts';
import { runPlanAction } from './executor-action.ts';
import { INTERRUPTED_DETAIL, InflightStore } from './inflight.ts';
import { MemorySink } from './records.ts';
import { fakeKv } from './restart.fakes.ts';
import type { BodyRuntime } from './runtime.ts';

const LIFE = 'life_inflight_test';
const KEY = `${LIFE}.inflight`;
const ACTION = 'ac_inflight_test';

/** The record a give writes while it runs (state `running`), as `runPlanAction` builds it. */
function givingRecord(): ActionRecord {
  return {
    action_id: ACTION,
    intent_id: null,
    life_id: LIFE,
    body_generation: 1,
    sequence: 1,
    source_snapshot_id: 'snap_1',
    snapshot_revision: 1,
    expires_tick: 9000,
    kind: 'give',
    args: { do: 'give', item: 'bread', count: 2 },
    state: 'running',
    result: null,
    receipt_id: null,
  } as ActionRecord;
}

/** A key as the previous run left it: open, with the give's record. */
function openValue(): string {
  return JSON.stringify({ phase: 'open', record: givingRecord(), item: 'bread', count: 2 });
}

/** A runtime with a sink, one completed or failed action, and the store under test. */
function runtimeWith(
  store: InflightStore | null,
  sink: MemorySink,
  outcome: 'completed' | 'failed',
) {
  return {
    sink,
    inflight: store,
    runAction: vi.fn(async () =>
      outcome === 'completed'
        ? {
            state: 'completed',
            result: { status: 'completed', latency_ms: 0, world_ticks: null, detail: {} },
          }
        : {
            state: 'failed',
            result: {
              status: 'failed',
              reason: 'blocked',
              latency_ms: 0,
              world_ticks: null,
              detail: {},
            },
          },
    ),
  };
}

const give = { do: 'give', item: 'bread', count: 2, to: 'ag_other_01' } as never;

describe('an open give left by a crash', () => {
  it('a crash between prepare and commit publishes one aborted receipt and one failed action, then deletes the key', async () => {
    const kv = fakeKv();
    kv.seed(KEY, openValue());
    const sink = new MemorySink();

    await new InflightStore({ kv, lifeId: LIFE, sink, now: () => new Date(0) }).recover();

    expect(sink.receipts).toHaveLength(1);
    expect(sink.receipts[0]).toMatchObject({
      receipt_id: receiptIdFor(ACTION, 'aborted'),
      action_id: ACTION,
      life_id: LIFE,
      phase: 'aborted',
      item: 'bread',
      count: 2,
      detail: INTERRUPTED_DETAIL,
    });
    expect(sink.actions).toHaveLength(1);
    expect(sink.actions[0]).toMatchObject({
      action_id: ACTION,
      state: 'failed',
      receipt_id: receiptIdFor(ACTION, 'aborted'),
      result: { status: 'failed', reason: 'interrupted', message: INTERRUPTED_DETAIL },
    });
    expect(kv.peek(KEY)).toBeUndefined();
  });

  it('a key marked closed is only deleted: no aborted receipt, no failed action', async () => {
    const kv = fakeKv();
    kv.seed(KEY, JSON.stringify({ phase: 'closed', action_id: ACTION }));
    const sink = new MemorySink();

    await new InflightStore({ kv, lifeId: LIFE, sink }).recover();

    expect(sink.receipts).toHaveLength(0);
    expect(sink.actions).toHaveLength(0);
    expect(kv.peek(KEY)).toBeUndefined();
  });

  it('starting twice with the same key publishes the same derived ids', async () => {
    const kv = fakeKv();
    const first = new MemorySink();
    const second = new MemorySink();
    kv.seed(KEY, openValue());
    await new InflightStore({ kv, lifeId: LIFE, sink: first, now: () => new Date(0) }).recover();
    kv.seed(KEY, openValue());
    await new InflightStore({
      kv,
      lifeId: LIFE,
      sink: second,
      now: () => new Date(5_000),
    }).recover();

    expect(second.receipts[0]?.receipt_id).toBe(first.receipts[0]?.receipt_id);
    expect(second.receipts[0]?.receipt_id).toBe(receiptIdFor(ACTION, 'aborted'));
    expect(second.actions[0]?.receipt_id).toBe(first.actions[0]?.receipt_id);
  });

  it('a key that cannot be read is deleted and nothing is published', async () => {
    const kv = fakeKv();
    kv.seed(KEY, '{not json');
    const sink = new MemorySink();
    const log = vi.fn();

    await new InflightStore({ kv, lifeId: LIFE, sink, log }).recover();

    expect(sink.receipts).toHaveLength(0);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('unreadable'));
    expect(kv.peek(KEY)).toBeUndefined();
  });
});

describe('a give that finishes normally', () => {
  it('writes the key after prepared, removes it after the outcome, and nothing is published at the next start', async () => {
    const kv = fakeKv();
    const sink = new MemorySink();
    const store = new InflightStore({ kv, lifeId: LIFE, sink });
    const runtime = runtimeWith(store, sink, 'completed');
    let duringRun: string | undefined;
    runtime.runAction.mockImplementationOnce(async () => {
      duringRun = kv.peek(KEY);
      return {
        state: 'completed',
        result: { status: 'completed', latency_ms: 0, world_ticks: null, detail: {} },
      } as never;
    });

    await runPlanAction(
      runtime as unknown as BodyRuntime,
      () => new Date(0),
      give,
      ACTION,
      1,
      planFor(1),
    );

    expect(JSON.parse(duringRun ?? '{}')).toMatchObject({ phase: 'open', item: 'bread', count: 2 });
    await vi.waitFor(() => expect(kv.peek(KEY)).toBeUndefined());
    expect(sink.receipts.map((r) => r.phase)).toEqual(['prepared', 'committed']);

    const next = new MemorySink();
    await new InflightStore({ kv, lifeId: LIFE, sink: next }).recover();
    expect(next.receipts).toHaveLength(0);
    expect(next.actions).toHaveLength(0);
  });

  it('a give whose key cannot be written does not run; it is reported as an internal failure', async () => {
    const kv = fakeKv();
    kv.failPuts(1);
    const sink = new MemorySink();
    const store = new InflightStore({ kv, lifeId: LIFE, sink, log: () => undefined });
    const runtime = runtimeWith(store, sink, 'completed');

    const report = await runPlanAction(
      runtime as unknown as BodyRuntime,
      () => new Date(0),
      give,
      ACTION,
      1,
      planFor(1),
    );

    expect(runtime.runAction).not.toHaveBeenCalled();
    expect(report.record.result).toMatchObject({ status: 'failed', reason: 'internal' });
    expect(sink.receipts.map((r) => r.phase)).toEqual(['prepared', 'aborted']);
  });

  it('a non-economic action never touches the key', async () => {
    const kv = fakeKv();
    const sink = new MemorySink();
    const runtime = runtimeWith(new InflightStore({ kv, lifeId: LIFE, sink }), sink, 'failed');

    await runPlanAction(
      runtime as unknown as BodyRuntime,
      () => new Date(0),
      { do: 'wait', ticks: 1 } as never,
      'ac_wait',
      1,
      planFor(1),
    );

    expect(kv.puts).toBe(0);
    expect(kv.deletes).toBe(0);
  });
});
