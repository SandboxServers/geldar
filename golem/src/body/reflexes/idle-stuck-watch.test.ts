import { Vec3 } from 'vec3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Block } from '../../actions/bot-types.ts';
import type { BodyView } from '../view.ts';
import { IDLE_TICKS, IDLE_TICKS_ON_OWN, idleStuckReflex } from './idle-stuck.ts';
import { GridWorld, settableView } from './reflexes.fakes.ts';
import { noteGoto } from './unstick.ts';

/** A still Body on open ground it can step off: no trigger fires, so only the watch line can speak. */
const SPOT = { x: -265.5, y: 35, z: 196.5 };

interface Live {
  tick: number | null;
  position: { x: number; y: number; z: number };
  enclosed: boolean;
  canStepOff: boolean | null;
  onOwnPlacement: boolean | null;
  actionRunning: boolean | undefined;
  asleep: boolean | undefined;
  riding: boolean | undefined;
  /** The planner's safe-drop test (BodyView.noSafeExit): true, false, or null for an unread cell. */
  noSafeExit?: boolean | null;
  /** The block read the watch probe uses (BodyView.terrainAt); missing leaves the probe fields null. */
  terrainAt?: BodyView['terrainAt'];
}

function still(over: Partial<Live> = {}): Live & BodyView {
  return Object.assign(
    settableView(),
    {
      tick: 0,
      position: { ...SPOT },
      enclosed: false,
      canStepOff: true,
      onOwnPlacement: false,
      actionRunning: false,
      asleep: false,
      riding: false,
    },
    over,
  ) as unknown as Live & BodyView;
}

function at(view: Live & BodyView, tick: number, position = view.position): Live & BodyView {
  view.tick = tick;
  view.position = position;
  return view;
}

/** The operator lines the watch wrote, parsed. */
function watchLines(log: { mock: { calls: unknown[][] } }): Record<string, unknown>[] {
  return log.mock.calls
    .map((call) => JSON.parse(String(call[0])) as Record<string, unknown>)
    .filter((line) => line.event === 'idle_stuck_watch');
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('idle_stuck operator watch line (decision 0332)', () => {
  it('writes one line a minute while still, starting at the first minute, with the four facts', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const view = still({ enclosed: true, canStepOff: false, onOwnPlacement: true });
    idleStuckReflex.check(view);
    idleStuckReflex.check(at(view, IDLE_TICKS - 1));
    expect(watchLines(log)).toHaveLength(0);
    idleStuckReflex.check(at(view, IDLE_TICKS));
    expect(watchLines(log)).toEqual([
      {
        event: 'idle_stuck_watch',
        idle_seconds: 60,
        enclosed: true,
        canStepOff: false,
        onOwnPlacement: true,
        noSafeExit: null,
        high_ledge: { still: false, notEnclosed: false, noSafeExit: false, notInWater: true },
        moves: null,
        reach: null,
        reach_exit: null,
        boxed_in: false,
        boxed: {
          reach: null,
          reach_exit: null,
          failedWalks: 0,
          night: false,
          wait_s: 120,
          held: null,
          gate: 'wait',
        },
      },
    ]);
    idleStuckReflex.check(at(view, IDLE_TICKS + IDLE_TICKS - 1));
    expect(watchLines(log)).toHaveLength(1);
    idleStuckReflex.check(at(view, IDLE_TICKS * 2));
    expect(watchLines(log)).toHaveLength(2);
    expect(watchLines(log)[1]?.idle_seconds).toBe(120);
  });

  it('logs noSafeExit and the high_ledge conditions; still turns true only at the 120 s clock', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const view = still({ noSafeExit: true });
    idleStuckReflex.check(view);
    idleStuckReflex.check(at(view, IDLE_TICKS));
    expect(watchLines(log)[0]).toMatchObject({
      noSafeExit: true,
      high_ledge: { still: false, notEnclosed: true, noSafeExit: true, notInWater: true },
    });
    idleStuckReflex.check(at(view, IDLE_TICKS_ON_OWN));
    expect(watchLines(log)[1]).toMatchObject({
      noSafeExit: true,
      high_ledge: { still: true, notEnclosed: true, noSafeExit: true, notInWater: true },
    });
  });

  it('carries the first four planner moves, the reach and the exit flag for a closed pocket', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const world = new GridWorld();
    world.fill(new Vec3(-60, 63, -60), new Vec3(60, 63, 60), 'stone');
    world.fill(new Vec3(-2, 64, -2), new Vec3(2, 66, 2), 'stone');
    world.fill(new Vec3(-1, 64, -1), new Vec3(1, 65, 1), null);
    const terrainAt = (cell: Vec3) => world.blockAt(cell) as unknown as Block;
    const view = still({ position: { x: 0, y: 64, z: 0 }, terrainAt });
    idleStuckReflex.check(view);
    idleStuckReflex.check(at(view, IDLE_TICKS));
    expect(watchLines(log)[0]).toMatchObject({
      moves: [
        { dx: 1, dz: 0, dy: 0, kind: 'walk', drop: 0, landing: 'stone' },
        { dx: -1, dz: 0, dy: 0, kind: 'walk', drop: 0, landing: 'stone' },
        { dx: 0, dz: 1, dy: 0, kind: 'walk', drop: 0, landing: 'stone' },
        { dx: 0, dz: -1, dy: 0, kind: 'walk', drop: 0, landing: 'stone' },
      ],
      reach: 9,
      reach_exit: false,
    });
  });

  it('writes nothing while a Mind action runs or the Body moves, and restarts the minute on a move', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const busy = still({ actionRunning: true });
    idleStuckReflex.check(busy);
    idleStuckReflex.check(at(busy, IDLE_TICKS * 3));
    expect(watchLines(log)).toHaveLength(0);

    const view = still();
    idleStuckReflex.check(view);
    idleStuckReflex.check(at(view, IDLE_TICKS, { ...SPOT, x: SPOT.x + 2 }));
    expect(watchLines(log)).toHaveLength(0);
    // The minute restarts at the move (tick 1200): the first line comes a full minute later, at 2400.
    idleStuckReflex.check(at(view, IDLE_TICKS * 2 - 1, { ...SPOT, x: SPOT.x + 2 }));
    expect(watchLines(log)).toHaveLength(0);
    idleStuckReflex.check(at(view, IDLE_TICKS * 2, { ...SPOT, x: SPOT.x + 2 }));
    expect(watchLines(log)).toHaveLength(1);
  });

  it('carries the boxed object: probe, failed walks, night, wait, hold and the first gate', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const world = new GridWorld();
    world.fill(new Vec3(-60, 63, -60), new Vec3(60, 63, 60), 'stone');
    world.fill(new Vec3(-2, 64, -2), new Vec3(2, 66, 2), 'stone');
    world.fill(new Vec3(-1, 64, -1), new Vec3(1, 65, 1), null);
    const terrainAt = (cell: Vec3) => world.blockAt(cell) as unknown as Block;
    const here = { x: 0, y: 64, z: 0 };
    const view = Object.assign(still({ position: here, terrainAt }), { isNight: false });
    noteGoto(view, 'failed', 'blocked', 'partial: goal unreachable', false, here);
    noteGoto(view, 'failed', 'blocked', 'partial: goal unreachable', false, here);
    idleStuckReflex.check(view);
    idleStuckReflex.check(at(view, IDLE_TICKS));
    expect(watchLines(log)[0]?.boxed).toEqual({
      reach: 9,
      reach_exit: false,
      failedWalks: 2,
      night: false,
      wait_s: 120,
      held: null,
      gate: 'wait',
    });
    idleStuckReflex.check(at(view, IDLE_TICKS * 2));
    expect(watchLines(log)[1]?.boxed).toEqual({
      reach: 9,
      reach_exit: false,
      failedWalks: 2,
      night: false,
      wait_s: 120,
      held: null,
      gate: 'none',
    });
  });
});
