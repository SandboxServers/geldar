import { Vec3 } from 'vec3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Block } from '../../actions/bot-types.ts';
import { DEFAULT_DIAG_SINK } from '../../actions/stall-diag.ts';
import type { BodyView } from '../view.ts';
import { idleStuckReflex } from './idle-stuck.ts';
import { BOXED_HOLE_TICKS, BOXED_NIGHT_TICKS, BOXED_TICKS } from './idle-stuck-boxed.ts';
import { markHoleForTest } from './panic-burrow.ts';
import { GridWorld, settableView } from './reflexes.fakes.ts';
import { noteGoto } from './unstick.ts';

const SPOT = { x: 0, y: 64, z: 0 };

/** The 7-cell pocket of `idle-stuck-boxed.test.ts`: stone floor and walls, open air inside. */
function pocketWorld(): GridWorld {
  const world = new GridWorld();
  world.fill(new Vec3(-60, 63, -60), new Vec3(60, 63, 60), 'stone');
  world.fill(new Vec3(-2, 64, -2), new Vec3(2, 66, 2), 'stone');
  const air: [number, number, number][] = [
    [0, 64, 0],
    [1, 64, 0],
    [-1, 64, 0],
    [0, 64, 1],
    [0, 64, -1],
    [0, 65, 0],
    [1, 65, 0],
  ];
  for (const [x, y, z] of air) world.fill(new Vec3(x, y, z), new Vec3(x, y, z), null);
  return world;
}

/** A still Body in the pocket: awake, dry, not on its own placement, no Mind action. */
function bodyIn(world: GridWorld, over: Record<string, unknown> = {}): BodyView {
  return Object.assign(
    settableView(),
    {
      tick: 0,
      position: { ...SPOT },
      health: 20,
      enclosed: false,
      canStepOff: true,
      noSafeExit: false,
      onOwnPlacement: false,
      isNight: false,
      actionRunning: false,
      asleep: false,
      riding: false,
      inFluid: null,
      terrainAt: (at: Vec3) => world.blockAt(at) as unknown as Block,
    },
    over,
  ) as unknown as BodyView;
}

function at(view: BodyView, tick: number): BodyView {
  (view as unknown as { tick: number }).tick = tick;
  return view;
}

/** Two goto outcomes that ended `failed(blocked)` where the Body stands. */
function twoBlockedWalks(view: BodyView): void {
  noteGoto(view, 'failed', 'blocked', 'partial: goal unreachable', false, SPOT);
  noteGoto(view, 'failed', 'blocked', 'partial: goal unreachable', false, SPOT);
}

/** A hostile mob at 4 blocks, as the view's hostile read reports it. */
const HOSTILE = () => [{ name: 'zombie', distance: 4 }];

afterEach(() => {
  vi.restoreAllMocks();
});

describe('idle_stuck boxed-in at night and after the Body dug its own hole (decision 0336, owner default)', () => {
  it('at night a boxed Body waits 600 s, not 120 s', () => {
    const view = bodyIn(pocketWorld(), { isNight: true });
    twoBlockedWalks(view);
    idleStuckReflex.check(view);
    expect(idleStuckReflex.check(at(view, BOXED_TICKS))).toBeNull();
    expect(idleStuckReflex.check(at(view, BOXED_NIGHT_TICKS - 1))).toBeNull();
    expect(idleStuckReflex.check(at(view, BOXED_NIGHT_TICKS))).toEqual({
      reason: 'boxed_in',
      idle_seconds: 600,
    });
  });

  it('at night a hostile within 16 blocks holds the boxed trigger off, and it fires once the hostile is gone', () => {
    const view = bodyIn(pocketWorld(), { isNight: true, nearbyHostiles: HOSTILE });
    twoBlockedWalks(view);
    idleStuckReflex.check(view);
    expect(idleStuckReflex.check(at(view, BOXED_NIGHT_TICKS))).toBeNull();
    (view as unknown as { nearbyHostiles: () => unknown[] }).nearbyHostiles = () => [];
    expect(idleStuckReflex.check(at(view, BOXED_NIGHT_TICKS))).toEqual({
      reason: 'boxed_in',
      idle_seconds: 600,
    });
  });

  it('by day a hostile does not hold the boxed trigger off', () => {
    const view = bodyIn(pocketWorld(), { nearbyHostiles: HOSTILE });
    twoBlockedWalks(view);
    idleStuckReflex.check(view);
    expect(idleStuckReflex.check(at(view, BOXED_TICKS))).toEqual({
      reason: 'boxed_in',
      idle_seconds: 120,
    });
  });

  it('a view that cannot say whether it is night waits the night clock', () => {
    const view = bodyIn(pocketWorld(), { isNight: undefined });
    twoBlockedWalks(view);
    idleStuckReflex.check(view);
    expect(idleStuckReflex.check(at(view, BOXED_TICKS))).toBeNull();
    expect(idleStuckReflex.check(at(view, BOXED_NIGHT_TICKS))).not.toBeNull();
  });

  it('does not fire within 15 minutes after the Body dug its own hole, and fires once they pass', () => {
    const logs = vi.spyOn(DEFAULT_DIAG_SINK, 'log').mockImplementation(() => undefined);
    const view = bodyIn(pocketWorld());
    markHoleForTest(view, 0);
    twoBlockedWalks(view);
    idleStuckReflex.check(view);
    expect(idleStuckReflex.check(at(view, BOXED_TICKS))).toBeNull();
    expect(idleStuckReflex.check(at(view, BOXED_HOLE_TICKS - 1))).toBeNull();
    expect(idleStuckReflex.check(at(view, BOXED_HOLE_TICKS))).toEqual({
      reason: 'boxed_in',
      idle_seconds: 900,
    });
    expect(logs).not.toHaveBeenCalledWith(expect.stringContaining('cap reached'));
  });
});
