import { describe, expect, it } from 'vitest';
import { fakeReflex } from './body.fakes.ts';
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
import type { Reflex } from './reflex.ts';
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

  it('resumes the program from the intent checkpoint instead of starting it', async () => {
    const h = executorHarness();
    const t = thought({ intent: {} }) as { intent: Record<string, unknown> };
    t.intent.checkpoint = { left: 2 };
    await h.executor.submit(t, planFor(0));
    const log = (h.program.current as ReturnType<typeof scriptedProgram>).log;
    expect(log.resumed).toEqual([{ left: 2 }]);
    expect(log.started).toEqual([]);
  });
});

describe('ticks: program steps', () => {
  it('steps once per tick and completes the intent, waking only when goal_completed is listed', async () => {
    for (const listed of [true, false]) {
      const h = executorHarness({ script: [{ status: 'running' }, { status: 'completed' }] });
      await h.executor.submit(
        thought({ intent: { wake_on: listed ? ['goal_completed'] : [] } }),
        planFor(0),
      );
      await h.executor.onTick(1);
      expect(h.executor.intentState).toBe('running');
      await h.executor.onTick(2);
      expect(h.executor.intentId).toBeNull();
      expect(h.sink.intents.at(-1)?.state).toBe('completed');
      expect(h.sink.wakes.map((w) => w.reason)).toEqual(listed ? ['goal_completed'] : []);
    }
  });

  it('fails the intent and wakes with action_failed when the program fails', async () => {
    const h = executorHarness({ script: [{ status: 'failed', message: 'no path' }] });
    await h.executor.submit(thought({ intent: {} }), planFor(0));
    await h.executor.onTick(1);
    expect(h.sink.intents.at(-1)).toMatchObject({ state: 'failed', detail: 'no path' });
    expect(h.sink.wakes.map((w) => w.reason)).toEqual(['action_failed']);
  });

  it('interrupts the intent when the program asks for the Mind', async () => {
    const h = executorHarness({
      script: [{ status: 'wake', reason: 'precondition_failed', message: 'no seeds' }],
    });
    await h.executor.submit(thought({ intent: {} }), planFor(0));
    await h.executor.onTick(1);
    expect(h.sink.intents.at(-1)?.state).toBe('interrupted');
    expect(h.sink.wakes[0]).toMatchObject({ reason: 'precondition_failed', detail: 'no seeds' });
  });

  it('subscribes to the tick source on start and unsubscribes on stop, ending the intent interrupted', async () => {
    const h = executorHarness();
    await h.executor.submit(thought({ intent: {} }), planFor(0));
    h.executor.start();
    expect(h.ticks.listeners()).toBe(1);
    await h.executor.stop();
    expect(h.ticks.listeners()).toBe(0);
    expect(h.sink.intents.at(-1)?.state).toBe('interrupted');
  });
});

describe('ticks: limits', () => {
  it('ends the intent with a limit_reached wake at max_world_ticks', async () => {
    const h = executorHarness();
    h.view.tick = 100;
    await h.executor.submit(thought({ intent: { limits: { ticks: 50 } } }), planFor(0));
    await h.executor.onTick(149);
    expect(h.executor.intentState).toBe('running');
    await h.executor.onTick(150);
    expect(h.sink.intents.at(-1)).toMatchObject({
      state: 'failed',
      detail: 'max_world_ticks reached',
    });
    expect(h.sink.wakes.map((w) => w.reason)).toEqual(['limit_reached']);
    expect((h.program.current as ReturnType<typeof scriptedProgram>).log.steps).toBe(1);
  });

  it('ends the intent with a limit_reached wake at max_block_operations', async () => {
    const h = executorHarness();
    await h.executor.submit(thought({ intent: { limits: { ops: 5 } } }), planFor(0));
    h.executor.noteBlockOperations(4);
    await h.executor.onTick(1);
    expect(h.executor.intentState).toBe('running');
    h.executor.noteBlockOperations(1);
    await h.executor.onTick(2);
    expect(h.sink.intents.at(-1)?.detail).toBe('max_block_operations reached');
    expect(h.sink.wakes.map((w) => w.reason)).toEqual(['limit_reached']);
  });
});

describe('ticks: wake_on', () => {
  it('directly_addressed wakes only when listed', async () => {
    const listed = executorHarness();
    await listed.executor.submit(
      thought({ intent: { wake_on: ['directly_addressed'] } }),
      planFor(0),
    );
    expect(await listed.executor.notifyAddressed('pike')).toBe(true);
    expect(listed.sink.intents.at(-1)?.state).toBe('interrupted');
    expect(listed.sink.wakes.map((w) => w.reason)).toEqual(['directly_addressed']);

    const unlisted = executorHarness();
    await unlisted.executor.submit(
      thought({ intent: { wake_on: ['goal_completed'] } }),
      planFor(0),
    );
    expect(await unlisted.executor.notifyAddressed('pike')).toBe(false);
    expect(unlisted.executor.intentState).toBe('running');
    expect(unlisted.sink.wakes).toEqual([]);
  });

  it('unexpected_damage interrupts the intent and wakes', async () => {
    const h = executorHarness();
    await h.executor.submit(thought({ intent: { wake_on: ['unexpected_damage'] } }), planFor(0));
    await h.executor.onTick(1);
    h.view.health = 14;
    await h.executor.onTick(2);
    expect(h.sink.wakes.map((w) => w.reason)).toEqual(['unexpected_damage']);
    expect(h.sink.intents.at(-1)?.state).toBe('interrupted');
  });

  it('new_agent_within_8 wakes when an agent arrives', async () => {
    const h = executorHarness();
    await h.executor.submit(thought({ intent: { wake_on: ['new_agent_within_8'] } }), planFor(0));
    await h.executor.onTick(1);
    expect(h.sink.wakes).toEqual([]);
    h.agents.within[8] = ['pike'];
    await h.executor.onTick(2);
    expect(h.sink.wakes.map((w) => w.reason)).toEqual(['new_agent_within_8']);
  });

  it('precondition_failed wakes when a precondition stops holding mid-run', async () => {
    const h = executorHarness();
    h.view.inventory.wheat_seeds = 1;
    await h.executor.submit(
      thought({ intent: { preconditions: ['seeds_available'], wake_on: ['precondition_failed'] } }),
      planFor(0),
    );
    await h.executor.onTick(1);
    expect(h.executor.intentState).toBe('running');
    h.view.inventory.wheat_seeds = 0;
    await h.executor.onTick(2);
    expect(h.sink.wakes[0]).toMatchObject({
      reason: 'precondition_failed',
      detail: 'seeds_available failed',
    });
    expect(h.sink.intents.at(-1)?.state).toBe('interrupted');
  });

  it('does not recheck preconditions mid-run when precondition_failed is not listed', async () => {
    const h = executorHarness();
    h.view.inventory.wheat_seeds = 1;
    await h.executor.submit(
      thought({ intent: { preconditions: ['seeds_available'] } }),
      planFor(0),
    );
    h.view.inventory.wheat_seeds = 0;
    await h.executor.onTick(1);
    expect(h.executor.intentState).toBe('running');
    expect(h.sink.wakes).toEqual([]);
  });
});

describe('ticks: reflexes', () => {
  function reflexHarness(active: { on: boolean }, raiseWake: boolean) {
    const base: Reflex = fakeReflex('eat', { priority: 1, hold: true, active: () => active.on });
    const reflex: Reflex = {
      ...base,
      run: async (trigger, ctx) => {
        if (raiseWake) ctx.sink.wake({ reason: 'reflex_danger', tick: ctx.tick, intentId: null });
        return base.run(trigger, ctx);
      },
    };
    return { reflex, release: () => (base as ReturnType<typeof fakeReflex>).release() };
  }

  it('pauses the intent while a reflex runs, aborts the step, and resumes it afterwards', async () => {
    const active = { on: true };
    const r = reflexHarness(active, false);
    const h = executorHarness({ reflexes: [r.reflex], hold: true });
    await h.executor.submit(thought({ intent: {} }), planFor(0));
    const program = h.program.current as ReturnType<typeof scriptedProgram>;
    const stepping = h.executor.onTick(1);
    // A step is in flight (the reflex has not fired yet); the reflex fires on the next tick.
    const fired = h.runtime.reflexRunner.onTick(2);
    expect(h.runtime.reflexRunner.busy).toBe(true);
    await h.executor.onTick(2);
    await stepping;
    expect(h.executor.intentState).toBe('paused');
    expect(program.log.aborted).toEqual([true]);
    const stepsWhilePaused = program.log.steps;
    await h.executor.onTick(3);
    expect(program.log.steps).toBe(stepsWhilePaused);
    active.on = false;
    r.release();
    await fired;
    const resumed = h.executor.onTick(4);
    await Promise.resolve();
    program.releaseStep();
    await resumed;
    expect(h.sink.intents.map((c) => c.state)).toEqual([
      'accepted',
      'running',
      'paused',
      'running',
    ]);
    expect(program.log.steps).toBe(stepsWhilePaused + 1);
  });

  it('does not resume the intent when the reflex raised a wake', async () => {
    const active = { on: true };
    const r = reflexHarness(active, true);
    const h = executorHarness({ reflexes: [r.reflex] });
    await h.executor.submit(thought({ intent: {} }), planFor(0));
    const fired = h.runtime.reflexRunner.onTick(1);
    await h.executor.onTick(1);
    expect(h.executor.intentState).toBe('paused');
    active.on = false;
    r.release();
    await fired;
    await h.executor.onTick(2);
    expect(h.sink.intents.map((c) => c.state)).toEqual([
      'accepted',
      'running',
      'paused',
      'interrupted',
    ]);
    expect(h.executor.intentId).toBeNull();
    // The reflex raised the wake itself: the executor adds no second one.
    expect(h.sink.wakes.map((w) => w.reason)).toEqual(['reflex_danger']);
  });

  it('discards a failed step result when a reflex ran during the step', async () => {
    const h = executorHarness({
      script: [{ status: 'failed', message: 'cancelled by reflex' }, { status: 'running' }],
      hold: true,
    });
    await h.executor.submit(thought({ intent: {} }), planFor(0));
    const program = h.program.current as ReturnType<typeof scriptedProgram>;
    const stepping = h.executor.onTick(1);
    h.tap.reflexFired({
      name: 'eat',
      lifeId: LIFE,
      bodyGeneration: GENERATION,
      tick: 1,
      trigger: {},
      outcome: { result: 'handled' },
    });
    program.releaseStep();
    await stepping;
    expect(h.executor.intentState).toBe('running');
    expect(h.sink.wakes).toEqual([]);
  });

  it('trusts a failed step result when no reflex ran', async () => {
    const h = executorHarness({ script: [{ status: 'failed', message: 'real failure' }] });
    await h.executor.submit(thought({ intent: {} }), planFor(0));
    await h.executor.onTick(1);
    expect(h.sink.intents.at(-1)?.state).toBe('failed');
  });
});
