import { describe, expect, it } from 'vitest';
import { completed } from '../../actions/outcome.ts';
import { ActionRegistry } from '../../actions/registry.ts';
import { MemorySink } from '../records.ts';
import { ReflexRunner } from '../reflex.ts';
import { allReflexesOn } from '../reflex-config.ts';
import { basicContext, basicView, eatRegistry, gridBot } from './basic.fakes.ts';
import { createBasicReflexes } from './basic.ts';
import { createEatReflex } from './eat.ts';

describe('eat reflex: check', () => {
  it('fires at hunger 14 with food, not at 15', () => {
    const reflex = createEatReflex();
    const { view, state } = basicView({ hunger: 15, foods: ['bread'] });
    expect(reflex.check(view)).toBeNull();
    state.hunger = 14;
    expect(reflex.check(view)).toEqual({ hunger: 14, foods: 1 });
  });

  it('does not fire without food, or with only foods the eat action refuses', () => {
    const reflex = createEatReflex();
    const { view, state } = basicView({ hunger: 4 });
    expect(reflex.check(view)).toBeNull();
    state.foods = ['rotten_flesh', 'spider_eye'];
    expect(reflex.check(view)).toBeNull();
    state.foods = ['rotten_flesh', 'bread'];
    expect(reflex.check(view)).toEqual({ hunger: 4, foods: 1 });
  });
});

describe('eat reflex: run', () => {
  it('cancels the running action, then runs the eat action once', async () => {
    const { view } = basicView({ hunger: 10, foods: ['bread'] });
    const { registry, runs } = eatRegistry('completed');
    const { ctx, cancels } = basicContext(view, gridBot({}).bot, registry);
    const outcome = await createEatReflex().run({ hunger: 10, foods: 1 }, ctx);
    expect(outcome.result).toBe('handled');
    expect(runs()).toBe(1);
    expect(cancels()).toBe(1);
  });

  it('reports a failed meal with the action reason', async () => {
    const { view } = basicView({ hunger: 10, foods: ['bread'] });
    const { registry } = eatRegistry('failed');
    const { ctx } = basicContext(view, gridBot({}).bot, registry);
    const outcome = await createEatReflex().run({}, ctx);
    expect(outcome).toEqual({ result: 'failed', detail: 'not_possible' });
  });

  it('does not start a meal while the Body is already eating', async () => {
    const { view } = basicView({ hunger: 10, foods: ['bread'] });
    const { registry, runs } = eatRegistry('completed');
    const held = gridBot({});
    (held.bot as unknown as { usingHeldItem: boolean }).usingHeldItem = true;
    const { ctx } = basicContext(view, held.bot, registry);
    const outcome = await createEatReflex().run({}, ctx);
    expect(outcome).toEqual({ result: 'abandoned', detail: 'already eating' });
    expect(runs()).toBe(0);
  });

  it('does not overlap two of its own meals', async () => {
    const { view } = basicView({ hunger: 10, foods: ['bread'] });
    const { registry, runs } = eatRegistry('completed');
    const { ctx } = basicContext(view, gridBot({}).bot, registry);
    const reflex = createEatReflex();
    const [first, second] = await Promise.all([reflex.run({}, ctx), reflex.run({}, ctx)]);
    expect([first.result, second.result].sort()).toEqual(['abandoned', 'handled']);
    expect(runs()).toBe(1);
  });
});

describe('eat reflex: under the runner', () => {
  it('writes one reflex_fired record and respects its cooldown', async () => {
    const { view } = basicView({ hunger: 8, foods: ['bread'] });
    const { registry, runs } = eatRegistry('completed');
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
    await runner.onTick(100);
    await runner.onTick(101);
    expect(runs()).toBe(1);
    expect(sink.reflexes).toHaveLength(1);
    expect(sink.reflexes[0]).toMatchObject({ name: 'eat', outcome: { result: 'handled' } });
    await runner.onTick(300);
    expect(runs()).toBe(2);
  });
});

describe('eat reflex: one per Body', () => {
  it('two Bodies eat at the same time: the flag is not shared', async () => {
    const one = basicView({ hunger: 10, foods: ['bread'] });
    const two = basicView({ hunger: 10, foods: ['bread'] });
    const a = eatRegistry('completed');
    const b = eatRegistry('completed');
    const ctxA = basicContext(one.view, gridBot({}).bot, a.registry).ctx;
    const ctxB = basicContext(two.view, gridBot({}).bot, b.registry).ctx;
    const [first, second] = await Promise.all([
      createEatReflex().run({}, ctxA),
      createEatReflex().run({}, ctxB),
    ]);
    expect([first.result, second.result]).toEqual(['handled', 'handled']);
  });

  it('createBasicReflexes builds fresh instances on every call', () => {
    const [x] = createBasicReflexes().filter((r) => r.name === 'eat');
    const [y] = createBasicReflexes().filter((r) => r.name === 'eat');
    expect(x).toBeDefined();
    expect(x).not.toBe(y);
  });
});

describe('eat reflex: time scale', () => {
  it('runs the eat action at the runtime time scale', async () => {
    const { view } = basicView({ hunger: 10, foods: ['bread'] });
    const seen: number[] = [];
    const registry = new ActionRegistry();
    registry.register({
      kind: 'eat',
      timeoutMs: 1000,
      run: async (actx) => {
        seen.push(actx.timeScale);
        return completed({ item: 'bread' });
      },
    });
    const { ctx } = basicContext(view, gridBot({}).bot, registry);
    ctx.timeScale = 4;
    await createEatReflex().run({ hunger: 10, foods: 1 }, ctx);
    expect(seen).toEqual([4]);
  });
});
