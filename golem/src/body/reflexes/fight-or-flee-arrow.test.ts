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
