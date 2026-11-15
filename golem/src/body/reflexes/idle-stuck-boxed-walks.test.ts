import { Vec3 } from 'vec3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Block } from '../../actions/bot-types.ts';
import type { BodyView } from '../view.ts';
import { idleStuckReflex } from './idle-stuck.ts';
import { BOXED_TICKS, isBoxedIn } from './idle-stuck-boxed.ts';
import { GridWorld, settableView } from './reflexes.fakes.ts';
import { failedWalksAt, noteGoto, noteWalkOutcome } from './unstick.ts';

const SPOT = { x: 0, y: 64, z: 0 };

/** A stone floor at y 63 under open ground, wide enough that a 40-cell walk never meets its edge. */
function openGround(): GridWorld {
  const world = new GridWorld();
  world.fill(new Vec3(-60, 63, -60), new Vec3(60, 63, 60), 'stone');
  return world;
}

/** Open ground with a closed 7-cell air pocket at the origin, walled, roofed and floored in stone (Tommy's shape). */
function pocketWorld(): GridWorld {
  const world = openGround();
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

/** A still Body in the pocket, on the floor, awake, dry, by day, with no Mind action and no own placement. */
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

/** A goto that ended `failed(blocked)` where the Body stands. */
function blockedWalk(view: BodyView): void {
  noteGoto(view, 'failed', 'blocked', 'partial: goal unreachable', false, SPOT);
}

/** A mine whose walk ended `failed` with `no_effect`: it dug, but gained nothing (the Tommy run). */
function failedMine(view: BodyView): void {
  noteGoto(
    view,
    'failed',
    'no_effect',
    'expected to gain 4 items; you gained 0',
    false,
    SPOT,
    'mine',
  );
}

/** An unstick run that ended `failed` where the Body stands. */
function failedUnstick(view: BodyView): void {
  noteWalkOutcome(view, 'unstick', 'failed', 'blocked', SPOT);
}

/** Open ground with a closed 3-cell pocket of feet cells: (0,64,0), (1,64,0), (1,64,1), roofed and walled in stone. */
function threeCellWorld(): GridWorld {
  const world = openGround();
  world.fill(new Vec3(-2, 64, -2), new Vec3(2, 66, 2), 'stone');
  for (const [x, y, z] of [
    [0, 64, 0],
    [1, 64, 0],
    [1, 64, 1],
    [0, 65, 0],
    [1, 65, 0],
    [1, 65, 1],
  ] as const) {
    world.fill(new Vec3(x, y, z), new Vec3(x, y, z), null);
  }
  return world;
}

/** Moves the Body's position on a view (the same view keeps its walk record). */
function moveTo(view: BodyView, spot: { x: number; y: number; z: number }): void {
  (view as unknown as { position: { x: number; y: number; z: number } }).position = spot;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('boxed-in walk record counts failed unstick and mine runs (decision 0336)', () => {
  it('a closed pocket by day with one failed mine and two failed unstick runs is boxed in after 120 s', () => {
    const view = bodyIn(pocketWorld());
    failedMine(view);
    failedUnstick(view);
    failedUnstick(view);
    idleStuckReflex.check(view);
    expect(idleStuckReflex.check(at(view, BOXED_TICKS - 1))).toBeNull();
    expect(idleStuckReflex.check(at(view, BOXED_TICKS))).toEqual({
      reason: 'boxed_in',
      idle_seconds: 120,
    });
  });

  it('two unstick failures 1.4 blocks apart in a 3-cell pocket are one spot: boxed in after the clock', () => {
    const view = bodyIn(threeCellWorld());
    failedUnstick(view);
    const inside = { x: 1, y: 64, z: 1 };
    moveTo(view, inside);
    noteWalkOutcome(view, 'unstick', 'failed', 'blocked', inside);
    expect(failedWalksAt(view, inside)).toBe(true);
    idleStuckReflex.check(view);
    expect(idleStuckReflex.check(at(view, BOXED_TICKS - 1))).toBeNull();
    expect(idleStuckReflex.check(at(view, BOXED_TICKS))).toEqual({
      reason: 'boxed_in',
      idle_seconds: 120,
    });
  });

  it('failures in two places, one inside the pocket and one far outside, do not accumulate', () => {
    const view = bodyIn(threeCellWorld());
    failedUnstick(view);
    const far = { x: 10, y: 64, z: 10 };
    moveTo(view, far);
    noteWalkOutcome(view, 'unstick', 'failed', 'blocked', far);
    expect(failedWalksAt(view, far)).toBe(false);
    moveTo(view, SPOT);
    expect(failedWalksAt(view, SPOT)).toBe(false);
  });

  it('a no_effect mine between two blocked walks does not clear the record', () => {
    const view = bodyIn(pocketWorld());
    blockedWalk(view);
    failedMine(view);
    blockedWalk(view);
    expect(isBoxedIn(view, SPOT)).toBe(true);
  });

  it('a completed unstick at the same spot keeps the record; one that moves the Body away clears it', () => {
    const view = bodyIn(pocketWorld());
    blockedWalk(view);
    blockedWalk(view);
    noteWalkOutcome(view, 'unstick', 'completed', undefined, SPOT);
    expect(isBoxedIn(view, SPOT)).toBe(true);
    noteWalkOutcome(view, 'unstick', 'completed', undefined, { x: 3, y: 64, z: 0 });
    expect(isBoxedIn(view, SPOT)).toBe(false);
  });

  it('a sleeping Body in a closed room never fires, even with failed mine and unstick runs', () => {
    const view = bodyIn(pocketWorld(), { asleep: true });
    failedMine(view);
    failedUnstick(view);
    failedUnstick(view);
    expect(isBoxedIn(view, SPOT)).toBe(true);
    idleStuckReflex.check(view);
    expect(idleStuckReflex.check(at(view, BOXED_TICKS * 2))).toBeNull();
  });

  it('a 1.7-block unstick inside the closed pocket does not reset the record (Tommy)', () => {
    const view = bodyIn(pocketWorld());
    blockedWalk(view);
    blockedWalk(view);
    noteWalkOutcome(view, 'unstick', 'completed', undefined, { x: 1.7, y: 64, z: 0 });
    expect(isBoxedIn(view, SPOT)).toBe(true);
  });

  it('an unstick that leaves the pocket for open ground resets the record', () => {
    const view = bodyIn(pocketWorld());
    blockedWalk(view);
    blockedWalk(view);
    noteWalkOutcome(view, 'unstick', 'completed', undefined, { x: 5, y: 64, z: 0 });
    expect(isBoxedIn(view, SPOT)).toBe(false);
  });

  it('an unstick more than 6 blocks from the first failure resets the record', () => {
    const view = bodyIn(pocketWorld());
    blockedWalk(view);
    blockedWalk(view);
    noteWalkOutcome(view, 'unstick', 'completed', undefined, { x: 7, y: 64, z: 0 });
    expect(isBoxedIn(view, SPOT)).toBe(false);
  });

  it('a Body with a Mind action running never fires, even with failed mine and unstick runs', () => {
    const view = bodyIn(pocketWorld(), { actionRunning: true });
    failedMine(view);
    failedUnstick(view);
    failedUnstick(view);
    idleStuckReflex.check(view);
    expect(idleStuckReflex.check(at(view, BOXED_TICKS * 2))).toBeNull();
  });
});
