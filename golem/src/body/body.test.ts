import { join } from 'node:path';
import type { Receipt } from '@geldar/contract';
import { describe, expect, it } from 'vitest';
import { repoRoot } from '../config.ts';
import { watchWorldTicks } from '../world-clock.ts';
import {
  fakeBot,
  fakeReflex,
  fakeView,
  hangingWait,
  instantWait,
  manualTicks,
} from './body.fakes.ts';
import {
  allReflexesOn,
  BodyRuntime,
  loadReflexConfig,
  MemorySink,
  parseReflexConfig,
  REFLEX_NAMES,
  type Reflex,
  type ReflexConfig,
} from './index.ts';
import { createBodyView } from './view.ts';

function runtimeWith(
  reflexes: Reflex[],
  reflexConfig: ReflexConfig = allReflexesOn(),
  sink = new MemorySink(),
) {
  const ticks = manualTicks();
  const runtime = new BodyRuntime({
    lifeId: 'ag_test_01',
    bodyGeneration: 3,
    bot: fakeBot(),
    ticks: ticks.source,
    sink,
    reflexes,
    reflexConfig,
    view: fakeView(),
  });
  return { runtime, ticks, sink };
}

describe('ReflexRunner', () => {
  it('runs only the highest-priority triggering reflex per tick, and records it', async () => {
    const low = fakeReflex('eat', { priority: 1 });
    const high = fakeReflex('retreat', { priority: 9, trigger: { health: 4 } });
    const { runtime, sink } = runtimeWith([low, high]);
    await runtime.reflexRunner.onTick(100);
    expect(high.log).toEqual(['run@100']);
    expect(low.log).toEqual([]);
    expect(sink.reflexes).toHaveLength(1);
    expect(sink.reflexes[0]).toMatchObject({
      name: 'retreat',
      lifeId: 'ag_test_01',
      bodyGeneration: 3,
      tick: 100,
      trigger: { health: 4 },
      outcome: { result: 'handled' },
    });
  });

  it('falls through to a lower priority reflex when the higher one does not trigger', async () => {
    const low = fakeReflex('eat', { priority: 1 });
    const high = fakeReflex('retreat', { priority: 9, active: () => false });
    const { runtime } = runtimeWith([low, high]);
    await runtime.reflexRunner.onTick(5);
    expect(low.log).toEqual(['run@5']);
  });

  it('honours the cooldown, counted from the tick it fired', async () => {
    const eat = fakeReflex('eat', { priority: 1, cooldownTicks: 5 });
    const { runtime } = runtimeWith([eat]);
    for (const tick of [10, 11, 14, 15, 16]) await runtime.reflexRunner.onTick(tick);
    expect(eat.log).toEqual(['run@10', 'run@15']);
  });

  it('never checks or runs a disabled reflex', async () => {
    let checks = 0;
    const eat = fakeReflex('eat', {
      priority: 1,
      active: () => {
        checks += 1;
        return true;
      },
    });
    const burrow = fakeReflex('panic_burrow', { priority: 0 });
    const config = parseReflexConfig({ eat: false });
    const { runtime, sink } = runtimeWith([eat, burrow], config);
    await runtime.reflexRunner.onTick(1);
    expect(checks).toBe(0);
    expect(eat.log).toEqual([]);
    expect(burrow.log).toEqual(['run@1']);
    expect(sink.reflexes.map((r) => r.name)).toEqual(['panic_burrow']);
  });

  it('runs nothing when the shard has reflexes switched off', async () => {
    const eat = fakeReflex('eat', { priority: 1 });
    const { runtime, sink } = runtimeWith([eat], parseReflexConfig({ enabled: false }));
    await runtime.reflexRunner.onTick(1);
    expect(eat.log).toEqual([]);
    expect(sink.reflexes).toEqual([]);
  });

  it('runs one reflex at a time: ticks during a run are skipped', async () => {
    const slow = fakeReflex('eat', { priority: 1, hold: true });
    const other = fakeReflex('retreat', { priority: 9, active: () => false });
    const { runtime, sink } = runtimeWith([slow, other]);
    const first = runtime.reflexRunner.onTick(1);
    expect(runtime.reflexRunner.busy).toBe(true);
    // Even a reflex that would now trigger waits for the running one.
    const second = runtime.reflexRunner.onTick(2);
    expect(slow.log).toEqual(['run@1']);
    slow.release();
    await Promise.all([first, second]);
    expect(runtime.reflexRunner.busy).toBe(false);
    expect(sink.reflexes).toHaveLength(1);
  });

  it('records a throwing reflex as failed and keeps going', async () => {
    const bad = fakeReflex('eat', {
      priority: 1,
      onRun: () => Promise.reject(new Error('boom')),
    });
    const { runtime, sink } = runtimeWith([bad]);
    await runtime.reflexRunner.onTick(1);
    expect(sink.reflexes[0]?.outcome).toEqual({ result: 'failed', detail: 'boom' });
  });

  it('rejects two reflexes with the same name', () => {
    expect(() =>
      runtimeWith([fakeReflex('eat', { priority: 1 }), fakeReflex('eat', { priority: 2 })]),
    ).toThrow(/duplicate reflex eat/);
  });
});

describe('BodyRuntime', () => {
  it('feeds world ticks to the runner from start() to stop()', async () => {
    const eat = fakeReflex('eat', { priority: 1 });
    const { runtime, ticks } = runtimeWith([eat]);
    ticks.emit(1);
    expect(eat.log).toEqual([]);
    runtime.start();
    runtime.start();
    expect(ticks.listeners()).toBe(1);
    ticks.emit(2);
    await runtime.stop();
    expect(ticks.listeners()).toBe(0);
    ticks.emit(3);
    expect(eat.log).toEqual(['run@2']);
  });

  it('lets a reflex pre-empt a running action by cancelling it', async () => {
    const wait = hangingWait();
    const retreat = fakeReflex('retreat', {
      priority: 9,
      onRun: (cancelAction) => cancelAction(),
    });
    const { runtime } = runtimeWith([retreat]);
    runtime.actions.register(wait);
    const running = runtime.runAction({ do: 'wait', seconds: 5 });
    await Promise.resolve();
    expect(runtime.actionRunning).toBe(true);
    await runtime.reflexRunner.onTick(7);
    const run = await running;
    expect(run.state).toBe('cancelled');
    expect(wait.started()).toBe(1);
    expect(runtime.actionRunning).toBe(false);
  });

  it('runs one action at a time and frees the slot when it ends', async () => {
    const { runtime } = runtimeWith([]);
    runtime.actions.register(hangingWait());
    const first = runtime.runAction({ do: 'wait', seconds: 1 });
    await expect(runtime.runAction({ do: 'wait', seconds: 1 })).rejects.toThrow(/already running/);
    await runtime.cancelAction();
    expect((await first).state).toBe('cancelled');
  });

  it('cancels a running action on stop', async () => {
    const { runtime } = runtimeWith([]);
    runtime.actions.register(hangingWait());
    const running = runtime.runAction({ do: 'wait', seconds: 1 });
    await runtime.stop();
    expect((await running).state).toBe('cancelled');
    await expect(runtime.runAction({ do: 'wait', seconds: 1 })).rejects.toThrow(/stopped/);
  });

  it('completes an action that finishes by itself', async () => {
    const { runtime } = runtimeWith([]);
    runtime.actions.register(instantWait());
    expect((await runtime.runAction({ do: 'wait', seconds: 1 })).state).toBe('completed');
  });

  it('starts with no programs registered', () => {
    expect(runtimeWith([]).runtime.programs.names()).toEqual([]);
  });
});

describe('MemorySink', () => {
  it('keeps every transition once, in order, as a copy', () => {
    const sink = new MemorySink();
    const change = {
      intentId: 'in_1',
      lifeId: 'ag_test_01',
      bodyGeneration: 1,
      state: 'running' as const,
      tick: 4,
    };
    sink.intentChanged(change);
    sink.intentChanged({ ...change, state: 'completed', tick: 9 });
    change.state = 'failed' as never;
    expect(sink.intents.map((c) => c.state)).toEqual(['running', 'completed']);

    const receipt = { receipt_id: 'rc_1', phase: 'prepared' } as Receipt;
    sink.receipt(receipt);
    receipt.phase = 'committed';
    expect(sink.receipts).toHaveLength(1);
    expect(sink.receipts[0]?.phase).toBe('prepared');

    sink.wake({ reason: 'goal_completed', tick: 9, intentId: 'in_1' });
    expect(sink.wakes).toHaveLength(1);
    expect(sink.actions).toEqual([]);
    expect(sink.reflexes).toEqual([]);
  });
});

describe('reflex config', () => {
  it('reads one flag per spec reflex from the Phase 0 shard file', async () => {
    const config = await loadReflexConfig(join(repoRoot(), 'shards', 'phase0.yaml'));
    expect(config.enabled).toBe(true);
    expect(Object.keys(config.flags)).toEqual([...REFLEX_NAMES]);
    expect(Object.values(config.flags).every((on) => on)).toBe(true);
  });

  it('defaults missing flags to on and refuses unknown keys and non-booleans', () => {
    expect(parseReflexConfig({ eat: false }).flags.retreat).toBe(true);
    expect(parseReflexConfig(undefined)).toEqual(allReflexesOn());
    expect(() => parseReflexConfig({ fall_stp: false })).toThrow(/not a reflex/);
    expect(() => parseReflexConfig({ eat: 'no' })).toThrow(/true or false/);
  });
});

describe('createBodyView', () => {
  it('measures a fall from the highest point since the ground, and resets on landing', () => {
    const bot = fakeBot();
    const view = createBodyView(bot);
    const entity = bot.entity as unknown as { position: { y: number }; onGround: boolean };
    entity.onGround = false;
    for (const y of [66, 65, 62]) {
      entity.position.y = y;
      bot.emit('physicsTick');
    }
    expect(view.fallingDistance).toBe(4);
    entity.onGround = true;
    bot.emit('physicsTick');
    expect(view.fallingDistance).toBe(0);
    view.dispose();
  });
});

describe('BodyRuntime on the physics tick', () => {
  function physicsRuntime(reflex: Reflex) {
    const bot = fakeBot();
    const runtime = new BodyRuntime({
      lifeId: 'ag_test_01',
      bodyGeneration: 1,
      bot,
      ticks: (listener) => watchWorldTicks(bot, listener),
      sink: new MemorySink(),
      reflexes: [reflex],
      view: fakeView(),
    });
    const time = (age: number): void => {
      (bot as unknown as { time: { age: number } }).time.age = age;
      bot.emit('time' as never);
    };
    const physics = async (n = 1): Promise<void> => {
      for (let i = 0; i < n; i++) {
        bot.emit('physicsTick' as never);
        await Promise.resolve();
        await Promise.resolve();
      }
    };
    return { runtime, bot, time, physics };
  }

  it('fires a reflex within one physics tick, not one time packet', async () => {
    const lava = fakeReflex('retreat', { priority: 1 });
    const { runtime, time, physics } = physicsRuntime(lava);
    time(100);
    runtime.start();
    await physics();
    expect(lava.log).toEqual(['run@101']);
    await runtime.stop();
  });

  it('counts the cooldown in world ticks across physics ticks and time packets', async () => {
    const eat = fakeReflex('eat', { priority: 1, cooldownTicks: 5 });
    const { runtime, time, physics } = physicsRuntime(eat);
    time(100);
    runtime.start();
    await physics(10);
    expect(eat.log).toEqual(['run@101', 'run@106']);
    // A time packet that agrees with the estimate neither double-fires nor skips ticks.
    time(110);
    await physics(2);
    expect(eat.log).toEqual(['run@101', 'run@106', 'run@111']);
    await runtime.stop();
  });

  it('never fires twice in one physics tick and ignores a time packet on its own', async () => {
    const eat = fakeReflex('eat', { priority: 1 });
    const { runtime, time, physics } = physicsRuntime(eat);
    time(100);
    runtime.start();
    time(120);
    time(140);
    expect(eat.log).toEqual([]);
    await physics();
    expect(eat.log).toEqual(['run@141']);
    await runtime.stop();
  });

  it('stops firing after stop()', async () => {
    const eat = fakeReflex('eat', { priority: 1 });
    const { runtime, bot, time, physics } = physicsRuntime(eat);
    time(100);
    runtime.start();
    await runtime.stop();
    await physics(3);
    expect(eat.log).toEqual([]);
    expect(bot.listenerCount('physicsTick' as never)).toBe(0);
    expect(bot.listenerCount('time' as never)).toBe(0);
  });
});
