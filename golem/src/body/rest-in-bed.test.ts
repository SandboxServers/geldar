import type { Bot } from 'mineflayer';
import { describe, expect, it, vi } from 'vitest';
import { MemorySink } from './records.ts';
import { type Reflex, ReflexRunner } from './reflex.ts';
import { allReflexesOn, type ReflexName } from './reflex-config.ts';
import { basicContext, basicView } from './reflexes/basic.fakes.ts';
import { blockedPathReflex } from './reflexes/blocked-path.ts';
import { createEatReflex } from './reflexes/eat.ts';
import { createFallStopReflex } from './reflexes/fall-stop.ts';
import { fightOrFleeReflex } from './reflexes/fight-or-flee.ts';
import { createHazardEscapeReflex } from './reflexes/hazard-escape.ts';
import { idleStuckReflex } from './reflexes/idle-stuck.ts';
import { panicBurrowReflex } from './reflexes/panic-burrow.ts';
import { retreatReflex } from './reflexes/retreat.ts';
import { darkShelterReflex } from './reflexes/shelter.ts';
import { unstickReflex } from './reflexes/unstick.ts';
import type { BodyView } from './view.ts';

/** A view over `base` that reports `asleep` and `ticksSinceHurt` as given; the other reads come from `base`. */
function restingView(base: BodyView, asleep: boolean, ticksSinceHurt: number | null): BodyView {
  return Object.create(base, {
    asleep: { value: asleep },
    ticksSinceHurt: { value: ticksSinceHurt },
  }) as BodyView;
}

/** A reflex that always fires, with the given suspension rule; its run is counted. */
function sleeper(name: ReflexName, suspended?: Reflex['suspendedWhileAsleep']) {
  const run = vi.fn(async () => ({ result: 'handled' as const }));
  const reflex: Reflex = {
    name,
    priority: 1,
    cooldownTicks: 0,
    check: () => ({ fired: true }),
    run,
    ...(suspended ? { suspendedWhileAsleep: suspended } : {}),
  };
  return { reflex, run };
}

/** A runner over one reflex and a view; a firing lands in the returned sink. */
function runnerFor(reflex: Reflex, view: BodyView) {
  const sink = new MemorySink();
  const runner = new ReflexRunner({
    reflexes: [reflex],
    config: allReflexesOn(),
    view,
    sink,
    lifeId: 'life',
    bodyGeneration: 1,
    context: () => basicContext(view, {} as Bot).ctx,
  });
  return { runner, sink };
}

const SUSPENDED_NAMES: ReflexName[] = [
  'eat',
  'blocked_path',
  'unstick',
  'idle_stuck',
  'dark_shelter',
  'panic_burrow',
];

describe('rest in bed (decision 0214): the flag', () => {
  it('is set on the six reflexes that rest in bed and on no other', () => {
    const all: Reflex[] = [
      createEatReflex(),
      blockedPathReflex,
      unstickReflex,
      idleStuckReflex,
      darkShelterReflex,
      panicBurrowReflex,
      createFallStopReflex(),
      fightOrFleeReflex,
      retreatReflex,
      createHazardEscapeReflex(),
    ];
    const flagged = all.filter((r) => r.suspendedWhileAsleep !== undefined).map((r) => r.name);
    expect(flagged.sort()).toEqual([...SUSPENDED_NAMES].sort());
  });
});

describe('rest in bed (decision 0214): the runner while asleep', () => {
  it.each(['unstick', 'blocked_path', 'idle_stuck', 'dark_shelter', 'panic_burrow'] as const)(
    'does not run %s while the Body sleeps, with no damage on record',
    async (name) => {
      const view = restingView(basicView().view, true, null);
      const { reflex, run } = sleeper(name, () => true);
      const { runner } = runnerFor(reflex, view);
      await runner.onTick(100);
      expect(run).not.toHaveBeenCalled();
    },
  );

  it('runs a suspended reflex when the Body is awake', async () => {
    const view = restingView(basicView().view, false, null);
    const { reflex, run } = sleeper('unstick', () => true);
    await runnerFor(reflex, view).runner.onTick(100);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('runs a suspended reflex while asleep when damage came 20 ticks ago, and not 21 ticks ago', async () => {
    const base = basicView().view;
    const hurt20 = sleeper('unstick', () => true);
    await runnerFor(hurt20.reflex, restingView(base, true, 20)).runner.onTick(100);
    expect(hurt20.run).toHaveBeenCalledTimes(1);

    const hurt21 = sleeper('unstick', () => true);
    await runnerFor(hurt21.reflex, restingView(base, true, 21)).runner.onTick(100);
    expect(hurt21.run).not.toHaveBeenCalled();
  });

  it('runs a suspended reflex while asleep when damage came this tick', async () => {
    const { reflex, run } = sleeper('panic_burrow', () => true);
    await runnerFor(reflex, restingView(basicView().view, true, 0)).runner.onTick(100);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('runs a reflex with no suspension rule while asleep (fight_or_flee, retreat, hazard_escape, fall_stop)', async () => {
    const { reflex, run } = sleeper('fight_or_flee');
    await runnerFor(reflex, restingView(basicView().view, true, null)).runner.onTick(100);
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe('rest in bed (decision 0214): eat while asleep', () => {
  it('is skipped at hunger 5 with no damage', async () => {
    const { view } = basicView({ hunger: 5, foods: ['bread'] });
    const asleep = restingView(view, true, null);
    const { runner, sink } = runnerFor(createEatReflex(), asleep);
    await runner.onTick(100);
    expect(sink.reflexes).toHaveLength(0);
  });

  it('runs at hunger 4 while asleep', async () => {
    const { view } = basicView({ hunger: 4, foods: ['bread'] });
    const { runner, sink } = runnerFor(createEatReflex(), restingView(view, true, null));
    await runner.onTick(100);
    expect(sink.reflexes).toHaveLength(1);
  });

  it('runs at hunger 5 while asleep when damage came 20 ticks ago, and is skipped at 21', async () => {
    const { view } = basicView({ hunger: 5, foods: ['bread'] });
    const at20 = runnerFor(createEatReflex(), restingView(view, true, 20));
    await at20.runner.onTick(100);
    expect(at20.sink.reflexes).toHaveLength(1);

    const at21 = runnerFor(createEatReflex(), restingView(view, true, 21));
    await at21.runner.onTick(100);
    expect(at21.sink.reflexes).toHaveLength(0);
  });

  it('runs at hunger 5 when awake', async () => {
    const { view } = basicView({ hunger: 5, foods: ['bread'] });
    const { runner, sink } = runnerFor(createEatReflex(), restingView(view, false, null));
    await runner.onTick(100);
    expect(sink.reflexes).toHaveLength(1);
  });

  it('suspends only at hunger above 4 (the predicate)', () => {
    const suspended = createEatReflex().suspendedWhileAsleep;
    expect(suspended?.(basicView({ hunger: 4 }).view)).toBe(false);
    expect(suspended?.(basicView({ hunger: 5 }).view)).toBe(true);
  });
});
