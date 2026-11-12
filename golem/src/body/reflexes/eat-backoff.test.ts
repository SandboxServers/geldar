import { describe, expect, it } from 'vitest';
import { MemorySink } from '../records.ts';
import { ReflexRunner } from '../reflex.ts';
import { allReflexesOn } from '../reflex-config.ts';
import { basicContext, basicView, eatRegistry, gridBot } from './basic.fakes.ts';
import { createEatReflex, EAT_BACKOFF_CAP_TICKS } from './eat.ts';

function runnerFor(outcome: 'completed' | 'failed', init: Parameters<typeof basicView>[0]) {
  const { view, state } = basicView(init);
  const { registry, runs } = eatRegistry(outcome);
  const { ctx } = basicContext(view, gridBot({}).bot, registry);
  const sink = new MemorySink();
  const runner = new ReflexRunner({
    reflexes: [createEatReflex()],
    config: allReflexesOn(),
    view,
    sink,
    lifeId: 'life',
    bodyGeneration: 1,
    context: () => ctx,
  });
  const at = (tick: number) => {
    state.tick = tick;
    return runner.onTick(tick);
  };
  return { runner, runs, sink, at };
}

describe('eat reflex: health trigger', () => {
  it('fires at hunger 17 when hurt, so health can regenerate, but not at full health', () => {
    const reflex = createEatReflex();
    const { view, state } = basicView({ hunger: 17, foods: ['bread'], health: 20 });
    expect(reflex.check(view)).toBeNull();
    state.health = 2.28;
    expect(reflex.check(view)).toEqual({ hunger: 17, foods: 1 });
    state.hunger = 18;
    expect(reflex.check(view)).toBeNull();
  });
});

describe('eat reflex: backoff', () => {
  it('doubles the wait after each failed meal and writes a reflex record each time', async () => {
    const { at, runs, sink } = runnerFor('failed', { hunger: 4, foods: ['bread'] });
    await at(1000);
    expect(runs()).toBe(1);
    await at(1199);
    expect(runs()).toBe(1);
    await at(1200);
    expect(runs()).toBe(2);
    await at(1599);
    expect(runs()).toBe(2);
    await at(1600);
    expect(runs()).toBe(3);
    expect(sink.reflexes).toHaveLength(3);
    expect(sink.reflexes[0]).toMatchObject({ name: 'eat', outcome: { result: 'failed' } });
  });

  it('stops doubling at the cap', async () => {
    const { at, runs } = runnerFor('failed', { hunger: 4, foods: ['bread'] });
    let tick = 0;
    for (let i = 0; i < 8; i += 1) {
      await at(tick);
      tick += EAT_BACKOFF_CAP_TICKS;
    }
    const before = runs();
    expect(before).toBe(8);
    await at(tick - 1);
    expect(runs()).toBe(before);
    await at(tick);
    expect(runs()).toBe(before + 1);
  });

  it('a meal that works clears the backoff', async () => {
    const failing = runnerFor('failed', { hunger: 4, foods: ['bread'] });
    await failing.at(0);
    const ok = runnerFor('completed', { hunger: 4, foods: ['bread'] });
    await ok.at(0);
    await ok.at(100);
    expect(ok.runs()).toBe(2);
  });
});
