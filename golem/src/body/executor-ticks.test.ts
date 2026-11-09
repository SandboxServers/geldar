import { describe, expect, it } from 'vitest';
import { fakeReflex } from './body.fakes.ts';
import {
  executorHarness,
  GENERATION,
  LIFE,
  planFor,
  type scriptedProgram,
  thought,
} from './executor.fakes.ts';
import type { Reflex } from './reflex.ts';

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
