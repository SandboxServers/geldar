import type { Bot } from 'mineflayer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { completed, failed } from '../../actions/outcome.ts';
import { ActionRegistry } from '../../actions/registry.ts';
import { MemorySink } from '../records.ts';
import { type Reflex, type ReflexContext, ReflexRunner } from '../reflex.ts';
import { allReflexesOn } from '../reflex-config.ts';
import type { BodyView } from '../view.ts';
import { createBasicReflexes } from './basic.ts';
import {
  IDLE_TICKS,
  idleStuckReflex,
  noteActionEnd,
  noteShelterRefusal,
  runUnstick,
  SAME_REFUSAL_SPOT,
} from './idle-stuck.ts';
import { markBurrowForTest, panicBurrowReflex } from './panic-burrow.ts';
import { settableView } from './reflexes.fakes.ts';
import { darkShelterReflex, shelterReflexes } from './shelter.ts';

/** Zack's ledge (decision 0196 case): feet cell on a stone ledge. */
const ZACK = { x: -265.5, y: 35, z: 196.5 };

interface Live {
  tick: number | null;
  position: { x: number; y: number; z: number };
  enclosed: boolean;
  canStepOff: boolean | null;
  actionRunning: boolean | undefined;
  asleep: boolean | undefined;
  riding: boolean | undefined;
  isNight: boolean | undefined;
  onOwnPlacement?: boolean | null;
}

/** A stuck, still Body with no action, not asleep, not riding; the fields are plain so a test can move them. */
function stuck(over: Partial<Live> = {}): Live & BodyView {
  return Object.assign(
    settableView(),
    {
      tick: 0,
      position: { ...ZACK },
      enclosed: true,
      canStepOff: false,
      actionRunning: false,
      asleep: false,
      riding: false,
    },
    over,
  ) as unknown as Live & BodyView;
}

/** Sets the world tick (and optionally the position) of a live view, and returns it. */
function at(view: Live & BodyView, tick: number, position?: { x: number; y: number; z: number }) {
  view.tick = tick;
  if (position) view.position = position;
  return view;
}

/** A registry whose `unstick` returns the given outcome and counts its calls. */
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

function ctxFor(view: BodyView, registry: ActionRegistry, tick: number): ReflexContext {
  // The world tick of the view moves with the call, so a run's end is read from the view.
  (view as unknown as Live).tick = tick;
  return {
    bot: {} as Bot,
    view,
    registry,
    tick,
    timeScale: 1,
    signal: new AbortController().signal,
    cancelAction: async () => {},
  } as unknown as ReflexContext;
}

describe('idle_stuck trigger (B1)', () => {
  it('fires after 60 s still and enclosed with no action running, not before', () => {
    const view = stuck();
    expect(idleStuckReflex.check(view)).toBeNull();
    expect(idleStuckReflex.check(at(view, IDLE_TICKS - 1))).toBeNull();
    expect(idleStuckReflex.check(at(view, IDLE_TICKS))).toEqual({
      reason: 'enclosed',
      idle_seconds: 60,
    });
  });

  it('fires on a ledge the Body cannot step off (not enclosed)', () => {
    const view = stuck({ enclosed: false, canStepOff: false });
    idleStuckReflex.check(view);
    expect(idleStuckReflex.check(at(view, IDLE_TICKS))).toEqual({
      reason: 'ledge',
      idle_seconds: 60,
    });
  });

  it('does not fire for a ranger standing in the open (it can step off)', () => {
    const view = stuck({ enclosed: false, canStepOff: true });
    idleStuckReflex.check(view);
    expect(idleStuckReflex.check(at(view, IDLE_TICKS * 5))).toBeNull();
  });

  it('does not fire while an action runs, and a finished action restarts the 60 s', () => {
    const view = stuck({ actionRunning: true });
    idleStuckReflex.check(view);
    expect(idleStuckReflex.check(at(view, IDLE_TICKS * 2))).toBeNull();
    at(view, IDLE_TICKS * 2);
    view.actionRunning = false;
    noteActionEnd(view);
    expect(idleStuckReflex.check(at(view, IDLE_TICKS * 2 + IDLE_TICKS - 1))).toBeNull();
    expect(idleStuckReflex.check(at(view, IDLE_TICKS * 3))).not.toBeNull();
  });

  it('does not fire when the Mind issued a goto in the window (the goto ended after the still start)', () => {
    const view = stuck();
    idleStuckReflex.check(view);
    at(view, 600);
    noteActionEnd(view);
    expect(idleStuckReflex.check(at(view, IDLE_TICKS))).toBeNull();
    expect(idleStuckReflex.check(at(view, 600 + IDLE_TICKS))).not.toBeNull();
  });

  it('does not fire while asleep or riding, and not on unknown reads', () => {
    const asleep = stuck({ asleep: true });
    idleStuckReflex.check(asleep);
    expect(idleStuckReflex.check(at(asleep, IDLE_TICKS * 2))).toBeNull();
    const riding = stuck({ riding: true });
    idleStuckReflex.check(riding);
    expect(idleStuckReflex.check(at(riding, IDLE_TICKS * 2))).toBeNull();
    const unknown = stuck({ actionRunning: undefined, asleep: undefined });
    idleStuckReflex.check(unknown);
    expect(idleStuckReflex.check(at(unknown, IDLE_TICKS * 2))).toBeNull();
  });

  it('restarts the still clock on a move of half a block or more, and not on less', () => {
    const view = stuck();
    idleStuckReflex.check(view);
    at(view, 1000, { x: ZACK.x + 0.4, y: ZACK.y, z: ZACK.z });
    expect(idleStuckReflex.check(view)).toBeNull();
    expect(idleStuckReflex.check(at(view, IDLE_TICKS + 500))).not.toBeNull();
    at(view, 1000, { x: ZACK.x + 1, y: ZACK.y, z: ZACK.z });
    expect(idleStuckReflex.check(view)).toBeNull();
    expect(idleStuckReflex.check(at(view, 1000 + IDLE_TICKS - 1))).toBeNull();
  });

  it('keeps its priority below every other reflex of the shelter and basic groups', () => {
    for (const other of [...shelterReflexes, ...createBasicReflexes()]) {
      if (other.name === idleStuckReflex.name) continue;
      expect(idleStuckReflex.priority).toBeLessThan(other.priority);
    }
    expect(idleStuckReflex.priority).toBeLessThan(panicBurrowReflex.priority);
  });
});

describe('idle_stuck run, backoff and log line', () => {
  it('runs unstick once and logs one line with the reason, result, backoff and position', async () => {
    const view = stuck();
    const { registry, calls } = unstickRegistry('trapped');
    const trigger = { reason: 'enclosed', idle_seconds: 60 };
    const outcome = await idleStuckReflex.run(trigger, ctxFor(view, registry, IDLE_TICKS));
    expect(calls()).toBe(1);
    expect(outcome).toEqual({
      result: 'failed',
      detail:
        'idle_stuck (enclosed): unstick found no way out; backoff 60s at (-265.5, 35.0, 196.5)',
    });
    expect(outcome.detail?.includes('\n')).toBe(false);
  });

  it('backs off 60 s, doubling per failed run, capped at 10 min, and refuses inside the wait', async () => {
    const view = stuck();
    const { registry, calls } = unstickRegistry('trapped');
    const details: string[] = [];
    let tick = IDLE_TICKS;
    for (const want of [60, 120, 240, 480, 600]) {
      const outcome = await runUnstick(ctxFor(view, registry, tick), 'idle_stuck (enclosed)');
      details.push(outcome.detail ?? '');
      expect(outcome.detail).toContain(`backoff ${want}s`);
      const wait = want * 20;
      const refused = await runUnstick(ctxFor(view, registry, tick + wait - 20), 'idle_stuck');
      expect(refused).toEqual({
        result: 'abandoned',
        detail: 'idle_stuck: unstick backing off 1s at (-265.5, 35.0, 196.5)',
      });
      tick += wait;
    }
    expect(calls()).toBe(5);
    expect(details).toHaveLength(5);
  });

  it('clears the backoff on a run that frees the Body', async () => {
    const view = stuck();
    const trapped = unstickRegistry('trapped');
    await runUnstick(ctxFor(view, trapped.registry, IDLE_TICKS), 'idle_stuck (enclosed)');
    const free = unstickRegistry('free');
    const freed = await runUnstick(ctxFor(view, free.registry, IDLE_TICKS * 2), 'idle_stuck');
    expect(freed).toEqual({
      result: 'handled',
      detail: 'idle_stuck: unstick freed the body; backoff 0s at (-265.5, 35.0, 196.5)',
    });
    const again = await runUnstick(
      ctxFor(view, trapped.registry, IDLE_TICKS * 2 + 1),
      'idle_stuck',
    );
    expect(again.detail).toContain('backoff 60s');
  });

  it('resets the backoff on movement, so the next failed run waits 60 s again', async () => {
    const view = stuck();
    const { registry } = unstickRegistry('trapped');
    await runUnstick(ctxFor(view, registry, IDLE_TICKS), 'idle_stuck (enclosed)');
    at(view, IDLE_TICKS + 10, { x: ZACK.x + 2, y: ZACK.y, z: ZACK.z });
    idleStuckReflex.check(view);
    const next = await runUnstick(ctxFor(view, registry, IDLE_TICKS + 10), 'idle_stuck');
    expect(next.detail).toContain('backoff 60s');
  });
});

describe('idle_stuck B1: night, burrow, asleep and riding', () => {
  it('leaves an enclosed Body alone at night, when the shelter is its own', () => {
    const view = stuck({ enclosed: true, isNight: true });
    expect(idleStuckReflex.check(view)).toBeNull();
    expect(idleStuckReflex.check(at(view, IDLE_TICKS * 3))).toBeNull();
  });

  it('fires an enclosed Body by day, and a ledge at night', () => {
    const day = stuck({ enclosed: true, isNight: false });
    idleStuckReflex.check(day);
    expect(idleStuckReflex.check(at(day, IDLE_TICKS))).toEqual({
      reason: 'enclosed',
      idle_seconds: 60,
    });
    const ledge = stuck({ enclosed: false, canStepOff: false, isNight: true });
    idleStuckReflex.check(ledge);
    expect(idleStuckReflex.check(at(ledge, IDLE_TICKS))).toEqual({
      reason: 'ledge',
      idle_seconds: 60,
    });
  });

  it('never fires for a Body in a burrow it dug, asleep, or riding', () => {
    const burrow = stuck({ enclosed: true, isNight: false });
    markBurrowForTest(burrow);
    idleStuckReflex.check(burrow);
    expect(idleStuckReflex.check(at(burrow, IDLE_TICKS * 3))).toBeNull();
    for (const over of [{ asleep: true }, { riding: true }]) {
      const view = stuck({ enclosed: true, isNight: false, ...over });
      idleStuckReflex.check(view);
      expect(idleStuckReflex.check(at(view, IDLE_TICKS * 3))).toBeNull();
    }
  });
});

describe('idle_stuck runs: the wait, the run own movement, the hourly cap', () => {
  it('counts the wait from the end of a run that took 30 s', async () => {
    const view = stuck();
    const registry = new ActionRegistry();
    registry.register({
      kind: 'unstick',
      timeoutMs: 1000,
      run: async () => {
        at(view, IDLE_TICKS + 600);
        return failed('blocked', 'trapped');
      },
    });
    const first = await runUnstick(ctxFor(view, registry, IDLE_TICKS), 'idle_stuck');
    expect(first.detail).toContain('backoff 60s');
    const early = await runUnstick(ctxFor(view, registry, IDLE_TICKS + 600 + 1180), 'idle_stuck');
    expect(early.detail).toContain('backing off 1s');
    const later = await runUnstick(ctxFor(view, registry, IDLE_TICKS + 600 + 1200), 'idle_stuck');
    expect(later.detail).not.toContain('backing off');
  });

  it('does not count the run own movement as movement, so the next wait is the doubled one', async () => {
    const view = stuck();
    const registry = new ActionRegistry();
    registry.register({
      kind: 'unstick',
      timeoutMs: 1000,
      run: async () => {
        (view as Live).position = { x: ZACK.x + 1, y: ZACK.y, z: ZACK.z };
        return failed('blocked', 'trapped');
      },
    });
    await runUnstick(ctxFor(view, registry, IDLE_TICKS), 'idle_stuck (enclosed)');
    idleStuckReflex.check(at(view, IDLE_TICKS + 1200));
    const next = await runUnstick(ctxFor(view, registry, IDLE_TICKS + 1200), 'idle_stuck');
    expect(next.detail).toContain('backoff 120s');
  });

  it('starts at most six runs in an hour, and one more an hour after the first', async () => {
    const view = stuck();
    const { registry, calls } = unstickRegistry('trapped');
    const details: string[] = [];
    for (const tick of [0, 1200, 3600, 8400, 18000, 30000, 42000]) {
      details.push((await runUnstick(ctxFor(view, registry, tick), 'idle_stuck')).detail ?? '');
    }
    expect(calls()).toBe(6);
    expect(details[6]).toContain('capped at 6 runs an hour');
    const hourLater = await runUnstick(ctxFor(view, registry, 72000), 'idle_stuck');
    expect(calls()).toBe(7);
    expect(hourLater.detail).toContain('found no way out');
  });
});

describe('idle_stuck and the block underfoot (owner ruling 2026-11-14)', () => {
  it("fires on Zack's natural stone ledge, where the block underfoot is not the Body's own", () => {
    const view = stuck({ enclosed: false, canStepOff: false, onOwnPlacement: false });
    idleStuckReflex.check(view);
    expect(idleStuckReflex.check(at(view, IDLE_TICKS))).toEqual({
      reason: 'ledge',
      idle_seconds: 60,
    });
  });

  it('does not fire on a ledge the Body stands on by its own placement', () => {
    const view = stuck({ enclosed: false, canStepOff: false, onOwnPlacement: true });
    idleStuckReflex.check(view);
    expect(idleStuckReflex.check(at(view, IDLE_TICKS * 3))).toBeNull();
  });

  it('does not dig out a B2 refusal made on its own placement, and does on natural stone', async () => {
    const own = stuck({ onOwnPlacement: true });
    const ownRegistry = unstickRegistry('trapped');
    const ownDetails = await refuseAt(own, ownRegistry.registry, [ZACK, ZACK, ZACK]);
    expect(ownRegistry.calls()).toBe(0);
    expect(ownDetails[2]).not.toContain('3 refusals');
    const natural = stuck({ onOwnPlacement: false });
    const naturalRegistry = unstickRegistry('trapped');
    await refuseAt(natural, naturalRegistry.registry, [ZACK, ZACK, ZACK]);
    expect(naturalRegistry.calls()).toBe(1);
  });
});

describe('dark shelter refusals (B2)', () => {
  it('fires once on the third refusal in a row at one spot', () => {
    const view = stuck();
    expect(noteShelterRefusal(view, true)).toBe(false);
    expect(noteShelterRefusal(view, true)).toBe(false);
    expect(noteShelterRefusal(view, true)).toBe(true);
    expect(noteShelterRefusal(view, true)).toBe(false);
  });

  it('does not fire for refusals at different spots, or with a handled shelter between', () => {
    const view = stuck();
    expect(noteShelterRefusal(view, true)).toBe(false);
    at(view, 300, { x: ZACK.x + 5, y: ZACK.y, z: ZACK.z });
    expect(noteShelterRefusal(view, true)).toBe(false);
    at(view, 500, { ...ZACK });
    expect(noteShelterRefusal(view, true)).toBe(false);
    expect(noteShelterRefusal(view, false)).toBe(false);
    expect(noteShelterRefusal(view, true)).toBe(false);
    expect(noteShelterRefusal(view, true)).toBe(false);
  });

  it('counts a refusal within the same-spot radius, and not one beyond it', () => {
    const view = stuck();
    noteShelterRefusal(view, true);
    at(view, 200, { x: ZACK.x + SAME_REFUSAL_SPOT, y: ZACK.y, z: ZACK.z });
    noteShelterRefusal(view, true);
    at(view, 400, { x: ZACK.x + SAME_REFUSAL_SPOT + 0.5, y: ZACK.y, z: ZACK.z });
    expect(noteShelterRefusal(view, true)).toBe(false);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Runs dark shelter once per spot, each abandoned as `no suitable block`; returns the outcome details. */
async function refuseAt(
  view: Live & BodyView,
  registry: ActionRegistry,
  spots: { x: number; y: number; z: number }[],
  detail = 'no suitable block',
): Promise<string[]> {
  const details: string[] = [];
  let tick = 0;
  for (const spot of spots) {
    at(view, tick, spot);
    vi.spyOn(panicBurrowReflex, 'run').mockResolvedValueOnce({
      result: 'abandoned',
      detail,
    });
    const trigger = { light: 3, hostile: 'zombie', distance: 5, cause: 'dark' };
    const outcome = await darkShelterReflex.run(trigger, ctxFor(view, registry, tick));
    details.push(outcome.detail ?? '');
    tick += 100;
  }
  return details;
}

describe('idle_stuck B2: dark shelter refusals run unstick', () => {
  it('runs unstick once on the third refusal in a row at one spot', async () => {
    const view = stuck();
    const { registry, calls } = unstickRegistry('trapped');
    const details = await refuseAt(view, registry, [ZACK, ZACK, ZACK]);
    expect(calls()).toBe(1);
    expect(details[1]).not.toContain('3 refusals');
    expect(details[2]).toContain('dark_shelter (3 refusals): unstick found no way out');
  });

  it('does not run unstick for three refusals at three different spots', async () => {
    const view = stuck();
    const { registry, calls } = unstickRegistry('trapped');
    const far = [ZACK, { ...ZACK, x: ZACK.x + 5 }, { ...ZACK, x: ZACK.x + 10 }];
    const details = await refuseAt(view, registry, far);
    expect(calls()).toBe(0);
    expect(details[2]).not.toContain('3 refusals');
  });

  it('never runs unstick while a Mind action runs, even on the third refusal', async () => {
    const view = stuck({ actionRunning: true });
    const { registry, calls } = unstickRegistry('trapped');
    const details = await refuseAt(view, registry, [ZACK, ZACK, ZACK]);
    expect(calls()).toBe(0);
    expect(details[2]).not.toContain('3 refusals');
  });
});

describe('idle_stuck B2 guards: the B1 guards, the stuck test, and the refusal text', () => {
  it('does not dig out a Body that can step off, asleep, riding or in a burrow', async () => {
    const burrow = stuck();
    markBurrowForTest(burrow);
    for (const view of [
      stuck({ canStepOff: true }),
      stuck({ asleep: true }),
      stuck({ riding: true }),
      burrow,
    ]) {
      const { registry, calls } = unstickRegistry('trapped');
      const details = await refuseAt(view, registry, [ZACK, ZACK, ZACK]);
      expect(calls()).toBe(0);
      expect(details[2]).not.toContain('3 refusals');
    }
  });

  it('does not count a refusal whose text is not the shelter refusal', async () => {
    const view = stuck();
    const { registry, calls } = unstickRegistry('trapped');
    await refuseAt(view, registry, [ZACK, ZACK, ZACK], 'no block to dig out through');
    expect(calls()).toBe(0);
  });
});

/** A reflex that always fires and records its name in `order` when it runs. */
function firing(name: 'panic_burrow' | 'hazard_escape', priority: number, order: string[]): Reflex {
  return {
    name,
    priority,
    cooldownTicks: 100,
    check: () => ({}),
    run: async () => {
      order.push(name);
      return { result: 'handled' };
    },
  };
}

describe('idle_stuck priority under panic_burrow and hazard_escape', () => {
  it('lets hazard_escape and panic_burrow fire first, and idle_stuck only after they cool down', async () => {
    const view = stuck();
    idleStuckReflex.check(view);
    at(view, IDLE_TICKS);
    const order: string[] = [];
    const { registry, calls } = unstickRegistry('trapped');
    const runner = new ReflexRunner({
      reflexes: [
        idleStuckReflex,
        firing('panic_burrow', 30, order),
        firing('hazard_escape', 90, order),
      ],
      config: allReflexesOn(),
      view,
      sink: new MemorySink(),
      lifeId: 'life-1',
      bodyGeneration: 1,
      context: (tick) => ctxFor(view, registry, tick),
    });
    await runner.onTick(IDLE_TICKS);
    expect(order).toEqual(['hazard_escape']);
    expect(calls()).toBe(0);
    await runner.onTick(IDLE_TICKS + 1);
    expect(order).toEqual(['hazard_escape', 'panic_burrow']);
    expect(calls()).toBe(0);
    await runner.onTick(IDLE_TICKS + 2);
    expect(calls()).toBe(1);
  });
});
