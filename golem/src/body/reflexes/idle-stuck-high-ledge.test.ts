import { describe, expect, it } from 'vitest';
import { completed, failed } from '../../actions/outcome.ts';
import { ActionRegistry } from '../../actions/registry.ts';
import { fakeBot } from '../body.fakes.ts';
import type { ReflexContext, Trigger } from '../reflex.ts';
import type { BodyView } from '../view.ts';
import { IDLE_TICKS, IDLE_TICKS_ON_OWN, idleStuckReflex } from './idle-stuck.ts';
import { settableView } from './reflexes.fakes.ts';

type Mutable = { -readonly [K in keyof BodyView]: BodyView[K] };

/** A Body on a high ledge (decision 0333): no safe move, not enclosed, on a natural block, on dry land. */
function highLedge(over: Partial<Mutable> = {}): Mutable {
  return Object.assign(
    settableView(),
    {
      tick: 0,
      position: { x: 0, y: 70, z: 0 },
      enclosed: false,
      canStepOff: true,
      noSafeExit: true,
      inFluid: null,
      actionRunning: false,
      asleep: false,
      riding: false,
      isNight: false,
      onOwnPlacement: false,
    },
    over,
  ) as unknown as Mutable;
}

function at(view: Mutable, tick: number): Mutable {
  view.tick = tick;
  return view;
}

/** A registry whose `unstick` completes (`free`) or fails (`trapped`), counting its calls. */
function unstickRegistry(outcome: 'free' | 'trapped') {
  const registry = new ActionRegistry();
  let calls = 0;
  registry.register({
    kind: 'unstick',
    timeoutMs: 1000,
    run: async () => {
      calls++;
      return outcome === 'free' ? completed({ method: 'step' }) : failed('blocked', 'trapped');
    },
  });
  return { registry, calls: () => calls };
}

function ctxAt(view: Mutable, registry: ActionRegistry, tick: number): ReflexContext {
  view.tick = tick;
  return {
    bot: fakeBot(),
    view,
    registry,
    tick,
    timeScale: 1,
    signal: new AbortController().signal,
    cancelAction: async () => {},
  } as unknown as ReflexContext;
}

describe('idle_stuck high_ledge trigger (decision 0333)', () => {
  it('fires on a high ledge at 120 s, not at 60 s or at 119 s', () => {
    const view = highLedge();
    expect(idleStuckReflex.check(view)).toBeNull();
    expect(idleStuckReflex.check(at(view, IDLE_TICKS))).toBeNull();
    expect(idleStuckReflex.check(at(view, IDLE_TICKS_ON_OWN - 1))).toBeNull();
    expect(idleStuckReflex.check(at(view, IDLE_TICKS_ON_OWN))).toEqual({
      reason: 'high_ledge',
      idle_seconds: 120,
    });
  });

  it('does not fire in the open with a safe move (noSafeExit false), nor when a cell is unread (null)', () => {
    for (const noSafeExit of [false, null]) {
      const view = highLedge({ noSafeExit });
      expect(idleStuckReflex.check(view)).toBeNull();
      expect(idleStuckReflex.check(at(view, IDLE_TICKS_ON_OWN))).toBeNull();
    }
  });

  it('does not fire enclosed at night, in water, or while a Mind action runs', () => {
    const night = highLedge({ enclosed: true, isNight: true });
    expect(idleStuckReflex.check(night)).toBeNull();
    expect(idleStuckReflex.check(at(night, IDLE_TICKS_ON_OWN))).toBeNull();

    const water = highLedge({ inFluid: 'water' });
    expect(idleStuckReflex.check(water)).toBeNull();
    expect(idleStuckReflex.check(at(water, IDLE_TICKS_ON_OWN))).toBeNull();

    const busy = highLedge({ actionRunning: true });
    expect(idleStuckReflex.check(busy)).toBeNull();
    expect(idleStuckReflex.check(at(busy, IDLE_TICKS_ON_OWN))).toBeNull();
  });
});

describe('high_ledge unstick cap and freed rule (decision 0333)', () => {
  const trigger = (reason: string) => ({ reason, idle_seconds: 120 }) as Trigger;

  it('allows 12 high_ledge runs in an hour and refuses the 13th with cap reached', async () => {
    const { registry, calls } = unstickRegistry('free');
    const view = highLedge({ noSafeExit: false });
    for (let i = 0; i < 12; i++) {
      const out = await idleStuckReflex.run(trigger('high_ledge'), ctxAt(view, registry, 1000 + i));
      expect(out.result).toBe('handled');
    }
    const refused = await idleStuckReflex.run(trigger('high_ledge'), ctxAt(view, registry, 1012));
    expect(refused.result).toBe('abandoned');
    expect(refused.detail).toContain('capped at 12 runs an hour (cap reached)');
    expect(calls()).toBe(12);
  });

  it('keeps the 6-run cap for every other reason (the 7th refused)', async () => {
    const { registry, calls } = unstickRegistry('free');
    const view = highLedge();
    for (let i = 0; i < 6; i++) {
      const out = await idleStuckReflex.run(trigger('enclosed'), ctxAt(view, registry, 1000 + i));
      expect(out.result).toBe('handled');
    }
    const refused = await idleStuckReflex.run(trigger('enclosed'), ctxAt(view, registry, 1006));
    expect(refused.result).toBe('abandoned');
    expect(refused.detail).toContain('capped at 6 runs an hour (cap reached)');
    expect(calls()).toBe(6);
  });

  it('a high_ledge run is not freed while a safe move still exists (noSafeExit true)', async () => {
    const { registry } = unstickRegistry('free');
    const out = await idleStuckReflex.run(
      trigger('high_ledge'),
      ctxAt(highLedge(), registry, 1000),
    );
    expect(out.result).toBe('failed');
    expect(out.detail).toContain('left the body on a ledge');
  });
});
