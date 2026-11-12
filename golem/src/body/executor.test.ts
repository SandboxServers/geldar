import { describe, expect, it } from 'vitest';
import { receiptIdFor } from './derived-id.ts';
import {
  executorHarness,
  fakeId,
  GENERATION,
  LIFE,
  planFor,
  scriptedProgram,
  thought,
  waits,
} from './executor.fakes.ts';
import type { RejectReason } from './validity.ts';

const FAR = { max_world_ticks: 1000 };
void FAR;

describe('submit: validity', () => {
  const cases: Array<[string, Parameters<typeof planFor>[1], RejectReason]> = [
    ['a dead life', { lifeId: 'ag_dead_01' }, 'wrong_life'],
    ['a stale generation', { bodyGeneration: GENERATION - 1 }, 'stale_generation'],
    ['an old snapshot revision', { snapshotRevision: 1 }, 'stale_snapshot'],
    ['an expired plan', { expiresTick: 0 }, 'expired'],
  ];
  it.each(cases)('refuses %s and runs nothing', async (_name, change, reason) => {
    const h = executorHarness();
    const result = await h.executor.submit(
      thought({ actions: waits(2), intent: {} }),
      planFor(2, change),
    );
    expect(result.rejection?.reason).toBe(reason);
    expect(result.actions).toEqual([]);
    expect(result.intent).toBe('none');
    expect(h.handlers.runs).toEqual([]);
    expect(h.sink.actions).toEqual([]);
    expect(h.sink.intents).toEqual([]);
    expect(h.executor.intentId).toBeNull();
  });

  it('uses the snapshot window option', async () => {
    const tight = executorHarness({ window: 0 });
    const r1 = await tight.executor.submit(
      thought({ actions: waits(1) }),
      planFor(1, { snapshotRevision: 4 }),
    );
    expect(r1.rejection?.reason).toBe('stale_snapshot');
    const roomy = executorHarness({ window: 4 });
    const r2 = await roomy.executor.submit(
      thought({ actions: waits(1) }),
      planFor(1, { snapshotRevision: 2 }),
    );
    expect(r2.rejection).toBeNull();
  });

  it('stops the list when the plan expires between two actions', async () => {
    const h = executorHarness();
    h.runtime.actions.get('wait'); // registered
    const original = h.handlers.wait.run;
    h.handlers.wait.run = async (ctx, action) => {
      h.view.tick = 2000;
      return original(ctx, action);
    };
    const result = await h.executor.submit(thought({ actions: waits(3) }), planFor(3));
    expect(result.actions).toHaveLength(1);
    expect(result.rejection?.reason).toBe('expired');
    expect(h.handlers.runs).toEqual(['wait:1']);
  });

  it('refuses a malformed thought and mismatched ids', async () => {
    const h = executorHarness();
    const bad = await h.executor.submit({ reasoning: 'x', actions: [{ do: 'nope' }] }, planFor(1));
    expect(bad.rejection?.reason).toBe('invalid_plan');
    const seven = await h.executor.submit(thought({ actions: waits(7) }), planFor(7));
    expect(seven.rejection?.reason).toBe('invalid_plan');
    const ids = await h.executor.submit(thought({ actions: waits(2) }), planFor(1));
    expect(ids.rejection?.reason).toBe('invalid_plan');
    const noIntentId = planFor(0);
    delete noIntentId.intentId;
    const missing = await h.executor.submit(thought({ intent: {} }), noIntentId);
    expect(missing.rejection?.reason).toBe('invalid_plan');
    expect(h.handlers.runs).toEqual([]);
  });
});

describe('submit: actions', () => {
  it('runs actions in order and records each state change and one final receipt', async () => {
    const h = executorHarness();
    const plan = planFor(3);
    const result = await h.executor.submit(thought({ actions: waits(3) }), plan);
    expect(h.handlers.runs).toEqual(['wait:1', 'wait:2', 'wait:3']);
    expect(result.failedAt).toBeNull();
    expect(result.actions.map((a) => a.record.state)).toEqual([
      'completed',
      'completed',
      'completed',
    ]);
    expect(h.sink.actions.map((r) => `${r.sequence}:${r.state}`)).toEqual([
      '0:accepted',
      '0:running',
      '0:completed',
      '1:accepted',
      '1:running',
      '1:completed',
      '2:accepted',
      '2:running',
      '2:completed',
    ]);
    expect(h.sink.receipts).toHaveLength(3);
    expect(h.sink.receipts.every((r) => r.phase === 'committed')).toBe(true);
    const last = h.sink.actions[2];
    expect(last?.receipt_id).toBe(h.sink.receipts[0]?.receipt_id);
    expect(last?.life_id).toBe(LIFE);
    expect(last?.intent_id).toBeNull();
  });

  it('derives each receipt id from its action and phase', async () => {
    const h = executorHarness();
    const actions = [{ do: 'wait', seconds: 1 }, { do: 'eat' }];
    await h.executor.submit(thought({ actions, intent: {} }), planFor(2));
    const ids = h.sink.actions.filter((a) => a.state !== 'accepted' && a.state !== 'running');
    expect(ids.map((a) => a.receipt_id)).toEqual([
      receiptIdFor(ids[0]?.action_id ?? '', 'committed'),
      receiptIdFor(ids[1]?.action_id ?? '', 'aborted'),
    ]);
    expect(h.sink.receipts.map((r) => r.receipt_id)).toEqual(ids.map((a) => a.receipt_id));
  });

  it('stops at the first failure, aborts its receipt, wakes with action_failed, skips the intent', async () => {
    const h = executorHarness();
    const actions = [{ do: 'wait', seconds: 1 }, { do: 'eat' }, { do: 'wait', seconds: 2 }];
    const result = await h.executor.submit(thought({ actions, intent: {} }), planFor(3));
    expect(h.handlers.runs).toEqual(['wait:1', 'eat']);
    expect(result.failedAt).toBe(1);
    expect(result.actions).toHaveLength(2);
    expect(result.intent).toBe('skipped');
    expect(h.sink.receipts.map((r) => r.phase)).toEqual(['committed', 'aborted']);
    expect(h.sink.wakes.map((w) => w.reason)).toEqual(['action_failed']);
    expect(h.sink.wakes[0]?.detail).toBe(
      'action 1 (eat) did not complete; completed before it: wait; not run: wait',
    );
    expect(h.sink.intents).toEqual([]);
  });

  it('accepts exactly six actions', async () => {
    const h = executorHarness();
    const result = await h.executor.submit(thought({ actions: waits(6) }), planFor(6));
    expect(result.rejection).toBeNull();
    expect(h.handlers.runs).toHaveLength(6);
  });

  it('does not run an action twice for the same action_id', async () => {
    const h = executorHarness();
    const plan = planFor(2);
    const first = await h.executor.submit(thought({ actions: waits(2) }), plan);
    const recordsAfterFirst = h.sink.actions.length;
    const second = await h.executor.submit(thought({ actions: waits(2) }), plan);
    expect(h.handlers.runs).toEqual(['wait:1', 'wait:2']);
    expect(second.actions.every((a) => a.duplicate)).toBe(true);
    expect(second.actions.map((a) => a.record)).toEqual(first.actions.map((a) => a.record));
    expect(h.sink.actions).toHaveLength(recordsAfterFirst);
    expect(h.sink.receipts).toHaveLength(2);
  });

  it('returns the stored result of a failed action on redelivery, without a second wake or run', async () => {
    const h = executorHarness();
    const plan = planFor(1);
    const eat = thought({ actions: [{ do: 'eat' }] });
    await h.executor.submit(eat, plan);
    const again = await h.executor.submit(eat, plan);
    expect(again.actions[0]?.record.state).toBe('failed');
    expect(again.failedAt).toBe(0);
    expect(h.handlers.runs).toEqual(['eat']);
    expect(h.sink.receipts).toHaveLength(1);
  });

  it('serves a duplicate delivered while the first is still running', async () => {
    const h = executorHarness();
    let open: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (open = resolve));
    const original = h.handlers.wait.run;
    h.handlers.wait.run = async (ctx, action) => {
      await gate;
      return original(ctx, action);
    };
    const plan = planFor(1);
    const first = h.executor.submit(thought({ actions: waits(1) }), plan);
    const second = h.executor.submit(thought({ actions: waits(1) }), plan);
    open();
    const [a, b] = await Promise.all([first, second]);
    expect(h.handlers.runs).toEqual(['wait:1']);
    expect(a.actions[0]?.duplicate).toBe(false);
    expect(b.actions[0]?.duplicate).toBe(true);
  });

  it('ignores a duplicate action id even when the plan has since gone stale', async () => {
    const h = executorHarness();
    const plan = planFor(1);
    await h.executor.submit(thought({ actions: waits(1) }), plan);
    h.revision.current = 50;
    const again = await h.executor.submit(thought({ actions: waits(1) }), plan);
    expect(again.rejection).toBeNull();
    expect(again.actions[0]?.duplicate).toBe(true);
    expect(h.handlers.runs).toHaveLength(1);
  });
});

describe('submit: intents', () => {
  it('carries the intent on the accepted change only', async () => {
    const h = executorHarness();
    const sent = thought({ actions: waits(1), intent: {} });
    await h.executor.submit(sent, planFor(1));
    const [accepted, running] = h.sink.intents;
    expect(accepted?.state).toBe('accepted');
    expect(accepted?.intent).toEqual((sent as { intent: unknown }).intent);
    expect(accepted?.intent).toBeDefined();
    expect(running?.intent).toBeUndefined();
  });

  it('starts the intent after its actions, running the program with the arguments', async () => {
    const h = executorHarness();
    const result = await h.executor.submit(thought({ actions: waits(1), intent: {} }), planFor(1));
    expect(result.intent).toBe('started');
    expect(h.executor.intentState).toBe('running');
    expect(h.sink.intents.map((c) => c.state)).toEqual(['accepted', 'running']);
    expect(h.program.current).toBeDefined();
    expect((h.program.current as ReturnType<typeof scriptedProgram>).log.started).toEqual([
      { n: 1 },
    ]);
  });

  it('replaces the current intent, which ends cancelled', async () => {
    const h = executorHarness();
    await h.executor.submit(thought({ intent: {} }), planFor(0, { n: 1 }));
    h.program.current = scriptedProgram([{ status: 'running' }]);
    const second = await h.executor.submit(thought({ intent: {} }), planFor(0, { n: 2 }));
    expect(second.intent).toBe('started');
    expect(h.executor.intentId).toBe(fakeId('in', 2));
    const first = h.sink.intents.filter((c) => c.intentId === fakeId('in', 1)).map((c) => c.state);
    expect(first).toEqual(['accepted', 'running', 'cancelled']);
  });

  it('does not start the same intent id twice', async () => {
    const h = executorHarness();
    const plan = planFor(0);
    await h.executor.submit(thought({ intent: {} }), plan);
    const again = await h.executor.submit(thought({ intent: {} }), plan);
    expect(again.intent).toBe('duplicate');
    expect(h.sink.intents.filter((c) => c.state === 'accepted')).toHaveLength(1);
  });

  it('pauses the running intent for immediate actions and resumes it', async () => {
    const h = executorHarness();
    await h.executor.submit(thought({ intent: {} }), planFor(0, { n: 1 }));
    await h.executor.submit(thought({ actions: waits(1) }), planFor(1, { n: 2 }));
    expect(h.sink.intents.map((c) => c.state)).toEqual([
      'accepted',
      'running',
      'paused',
      'running',
    ]);
    expect(h.executor.intentState).toBe('running');
  });

  it('fails an unknown precondition closed, never starts the program, and wakes the Mind', async () => {
    const h = executorHarness();
    const result = await h.executor.submit(
      thought({ intent: { preconditions: ['field_is_known'] } }),
      planFor(0),
    );
    expect(result.intent).toBe('precondition_failed');
    expect((h.program.current as ReturnType<typeof scriptedProgram>).log.started).toEqual([]);
    expect(h.sink.intents.map((c) => c.state)).toEqual(['accepted', 'failed']);
    expect(h.sink.intents[1]?.detail).toContain('unknown precondition');
    expect(h.sink.wakes.map((w) => w.reason)).toEqual(['precondition_failed']);
    expect(h.executor.intentId).toBeNull();
  });

  it('starts when a known precondition holds and fails when it does not', async () => {
    const h = executorHarness();
    const blocked = await h.executor.submit(
      thought({ intent: { preconditions: ['seeds_available'] } }),
      planFor(0, { n: 1 }),
    );
    expect(blocked.intent).toBe('precondition_failed');
    h.view.inventory.wheat_seeds = 4;
    const ok = await h.executor.submit(
      thought({ intent: { preconditions: ['seeds_available'] } }),
      planFor(0, { n: 2 }),
    );
    expect(ok.intent).toBe('started');
  });

  it('refuses a program that is not registered', async () => {
    const h = executorHarness();
    const result = await h.executor.submit(thought({ intent: { program: 'build' } }), planFor(0));
    expect(result.intent).toBe('unsupported_program');
    expect(h.sink.intents.map((c) => c.state)).toEqual(['accepted', 'failed']);
  });

  it('starts the program from its arguments even when the thought carries a checkpoint', async () => {
    const h = executorHarness();
    const t = thought({ intent: {} }) as { intent: Record<string, unknown> };
    t.intent.checkpoint = { left: 2 };
    expect((await h.executor.submit(t, planFor(0))).intent).toBe('started');
    const log = (h.program.current as ReturnType<typeof scriptedProgram>).log;
    expect(log.started).toEqual([{ n: 1 }]);
    expect(log.resumed).toEqual([]);
  });

  it('resume() restores the program from the intent checkpoint instead of starting it', async () => {
    const h = executorHarness();
    const t = thought({ intent: {} }) as { intent: Record<string, unknown> };
    t.intent.checkpoint = { left: 2 };
    const disposition = await h.executor.resume(
      t.intent as unknown as Parameters<typeof h.executor.resume>[0],
      fakeId('in', 1),
    );
    expect(disposition).toBe('started');
    const log = (h.program.current as ReturnType<typeof scriptedProgram>).log;
    expect(log.resumed).toEqual([{ left: 2 }]);
    expect(log.started).toEqual([]);
  });

  it('refuses the intent when the plan went stale while the immediate actions ran', async () => {
    const h = executorHarness();
    const original = h.handlers.wait.run;
    h.handlers.wait.run = async (ctx, action) => {
      h.view.tick = 2000;
      return original(ctx, action);
    };
    const result = await h.executor.submit(thought({ actions: waits(1), intent: {} }), planFor(1));
    expect(result.actions).toHaveLength(1);
    expect(result.rejection?.reason).toBe('expired');
    expect(result.intent).toBe('skipped');
    expect(h.executor.intentId).toBeNull();
    expect(h.sink.intents).toEqual([]);
  });
});
