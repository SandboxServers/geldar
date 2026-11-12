import { beforeEach, describe, expect, it, vi } from 'vitest';
import { moveNear } from '../../actions/pathing.ts';
import { type ArrowView, arrowBearing, type BodyView } from '../view.ts';
import { type CombatScene, calmScene, sceneContext, sceneView } from './combat.fakes.ts';
import { fightOrFleeReflex } from './fight-or-flee.ts';

vi.mock('../../actions/pathing.ts', () => ({ moveNear: vi.fn() }));

const walk = vi.mocked(moveNear);

beforeEach(() => {
  walk.mockReset();
});

/** An arrow `distance` blocks away on the given bearing, closing or not. */
function arrow(bearing: ArrowView['bearing'], distance = 3, closing = true): ArrowView {
  return { distance, position: { x: 0, y: 64, z: 0 }, bearing, closing };
}

/** The scene view with arrows that honour the radius the reflex asks for, and a yaw. */
function arrowView(arrows: ArrowView[], yaw = 0): BodyView {
  const scene: CombatScene = calmScene();
  return {
    ...sceneView(scene),
    yaw,
    arrowsNear: (radius = 16) => arrows.filter((a) => a.distance <= radius),
  };
}

describe('arrow bearing (mineflayer yaw: 0 faces -z)', () => {
  const self = { x: 0, z: 0 };

  it('reads an arrow ahead as front and behind as behind, on both signs', () => {
    expect(arrowBearing(0, self, { x: 0, z: -4 })).toBe('front');
    expect(arrowBearing(0, self, { x: 0, z: 4 })).toBe('behind');
  });

  it('reads an arrow to the east as right and to the west as left at yaw 0', () => {
    expect(arrowBearing(0, self, { x: 4, z: 0 })).toBe('right');
    expect(arrowBearing(0, self, { x: -4, z: 0 })).toBe('left');
  });

  it('turns with the yaw: at yaw pi/2 (facing west) the north arrow is right', () => {
    expect(arrowBearing(Math.PI / 2, self, { x: 0, z: -4 })).toBe('right');
    expect(arrowBearing(Math.PI / 2, self, { x: -4, z: 0 })).toBe('front');
  });
});

describe('fight_or_flee arrow trigger', () => {
  it('fires on a closing arrow within 6 blocks and carries its bearing', () => {
    const trigger = fightOrFleeReflex.check(arrowView([arrow('left')]));
    expect(trigger).toMatchObject({ cause: 'arrow', bearing: 'left', hostile: 'arrow' });
  });

  it('does not fire on an arrow that flies away', () => {
    expect(fightOrFleeReflex.check(arrowView([arrow('left', 3, false)]))).toBeNull();
  });

  it('does not fire on a closing arrow beyond 6 blocks', () => {
    expect(fightOrFleeReflex.check(arrowView([arrow('front', 7)]))).toBeNull();
  });

  it('does not throw and does not fire when the view has no arrow reads', () => {
    const view: BodyView = { ...sceneView(calmScene()) };
    expect(fightOrFleeReflex.check(view)).toBeNull();
  });
});

describe('fight_or_flee arrow sidestep', () => {
  /** Runs the reflex on an arrow and returns the goal the move was given. */
  async function sidestepGoal(bearing: ArrowView['bearing'], yaw = 0) {
    walk.mockResolvedValue({ ok: true } as never);
    const view = arrowView([arrow(bearing)], yaw);
    const trigger = fightOrFleeReflex.check(view);
    if (trigger === null) throw new Error('arrow did not fire');
    const ctx = sceneContext(calmScene(), { view });
    const outcome = await fightOrFleeReflex.run(trigger, ctx);
    expect(outcome.result).toBe('handled');
    return walk.mock.calls[0]?.[1];
  }

  it('an arrow on the left sends the Body right', async () => {
    expect(await sidestepGoal('left')).toMatchObject({ x: 3.5, z: 0.5 });
  });

  it('an arrow on the right sends the Body left', async () => {
    expect(await sidestepGoal('right')).toMatchObject({ x: -2.5, z: 0.5 });
  });

  it('an arrow in front or behind sends the Body right', async () => {
    expect(await sidestepGoal('front')).toMatchObject({ x: 3.5, z: 0.5 });
    expect(await sidestepGoal('behind')).toMatchObject({ x: 3.5, z: 0.5 });
  });

  it('follows the yaw: at yaw pi/2 a left arrow sends the Body toward -z', async () => {
    const goal = await sidestepGoal('left', Math.PI / 2);
    expect(goal?.x).toBeCloseTo(0.5, 6);
    expect(goal?.z).toBeCloseTo(-2.5, 6);
  });

  it('a failed move is a failed outcome and does not throw', async () => {
    walk.mockResolvedValue({ ok: false, reason: 'aborted' } as never);
    const view = arrowView([arrow('left')]);
    const trigger = fightOrFleeReflex.check(view);
    if (trigger === null) throw new Error('arrow did not fire');
    const outcome = await fightOrFleeReflex.run(trigger, sceneContext(calmScene(), { view }));
    expect(outcome).toMatchObject({ result: 'failed' });
    expect(outcome.detail).toContain('sidestep ended');
  });

  it('a move given an aborted signal is handed that signal (close cancels the step)', async () => {
    walk.mockResolvedValue({ ok: false, reason: 'aborted' } as never);
    const view = arrowView([arrow('right')]);
    const trigger = fightOrFleeReflex.check(view);
    if (trigger === null) throw new Error('arrow did not fire');
    const ctx = sceneContext(calmScene(), { view });
    await fightOrFleeReflex.run(trigger, ctx);
    expect(walk.mock.calls[0]?.[3]).toMatchObject({ signal: ctx.signal });
  });

  it('gives up at its 5 s wall deadline when the move never ends', async () => {
    vi.useFakeTimers();
    try {
      walk.mockImplementation(
        (...args) =>
          new Promise((resolve) => {
            args[3]?.signal?.addEventListener(
              'abort',
              () => resolve({ ok: false, reason: 'aborted' } as never),
              { once: true },
            );
          }) as never,
      );
      const view = arrowView([arrow('left')]);
      const trigger = fightOrFleeReflex.check(view);
      if (trigger === null) throw new Error('arrow did not fire');
      const run = fightOrFleeReflex.run(trigger, sceneContext(calmScene(), { view }));
      await vi.advanceTimersByTimeAsync(5_000);
      const outcome = await run;
      expect(outcome).toMatchObject({ result: 'failed' });
      expect(outcome.detail).toContain('sidestep ended');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('fight_or_flee arrow pause (sidestep backoff)', () => {
  /** Sets the Body's world tick (the tick source the reflex reads). */
  function setTick(view: BodyView, tick: number): void {
    (view as { tick: number }).tick = tick;
  }

  /** Runs the reflex at `tick` if the arrow trigger fires there; null when it does not. */
  async function fireAt(view: BodyView, tick: number) {
    setTick(view, tick);
    const trigger = fightOrFleeReflex.check(view);
    if (trigger === null) return null;
    const outcome = await fightOrFleeReflex.run(trigger, sceneContext(calmScene(), { view }));
    return { trigger, outcome };
  }

  /** Each tick is an arrow sidestep that is handled. */
  async function sidestepsAt(view: BodyView, ticks: number[]): Promise<void> {
    for (const tick of ticks) {
      expect((await fireAt(view, tick))?.outcome.result).toBe('handled');
    }
  }

  /** The arrow at `tick` is the one past the limit: it is a paused trigger, and its run gives up. */
  async function pauseAt(view: BodyView, tick: number): Promise<string> {
    const fired = await fireAt(view, tick);
    expect(fired?.trigger.paused).toBe(true);
    expect(fired?.outcome.result).toBe('abandoned');
    return fired?.outcome.detail ?? '';
  }

  beforeEach(() => {
    walk.mockResolvedValue({ ok: true } as never);
  });

  it('sidesteps 4 arrows in 15 s, then the 5th is suppressed with one give-up event', async () => {
    const view = arrowView([arrow('left')]);
    await sidestepsAt(view, [0, 40, 80, 120]);
    expect(await pauseAt(view, 160)).toBe('arrow sidestep paused: still under fire (15s)');
    expect(walk).toHaveBeenCalledTimes(4);
    // While paused the check is silent, so no second event is logged.
    setTick(view, 200);
    expect(fightOrFleeReflex.check(view)).toBeNull();
  });

  it('resumes sidestepping when the 15 s pause ends', async () => {
    const view = arrowView([arrow('left')]);
    await sidestepsAt(view, [0, 40, 80, 120]);
    await pauseAt(view, 160);
    await sidestepsAt(view, [460, 500, 540, 580]);
    expect(walk).toHaveBeenCalledTimes(8);
  });

  it('a sidestep older than 15 s no longer counts toward the limit', async () => {
    const view = arrowView([arrow('left')]);
    await sidestepsAt(view, [0, 100, 200, 300]);
    await sidestepsAt(view, [310]);
    expect(walk).toHaveBeenCalledTimes(5);
  });

  it('doubles the pause on each pause in a row (15 s, 30 s, 60 s, 120 s) and caps it at 120 s', async () => {
    const view = arrowView([arrow('left')]);
    await sidestepsAt(view, [0, 40, 80, 120]);
    expect(await pauseAt(view, 160)).toContain('(15s)');
    await sidestepsAt(view, [460, 500, 540, 580]);
    expect(await pauseAt(view, 600)).toContain('(30s)');
    await sidestepsAt(view, [1200, 1240, 1280, 1320]);
    expect(await pauseAt(view, 1340)).toContain('(60s)');
    await sidestepsAt(view, [2540, 2580, 2620, 2660]);
    expect(await pauseAt(view, 2680)).toContain('(120s)');
    await sidestepsAt(view, [5080, 5120, 5160, 5200]);
    expect(await pauseAt(view, 5220)).toContain('(120s)');
  });

  it('starts over at 15 s after a quiet minute with no arrow', async () => {
    const view = arrowView([arrow('left')]);
    await sidestepsAt(view, [0, 40, 80, 120]);
    expect(await pauseAt(view, 160)).toContain('(15s)');
    await sidestepsAt(view, [460, 500, 540, 580]);
    expect(await pauseAt(view, 600)).toContain('(30s)');
    await sidestepsAt(view, [3000]);
    await sidestepsAt(view, [3040, 3080, 3120]);
    expect(await pauseAt(view, 3160)).toContain('(15s)');
  });
});
