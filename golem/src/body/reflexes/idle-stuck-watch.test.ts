import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BodyView } from '../view.ts';
import { IDLE_TICKS, idleStuckReflex } from './idle-stuck.ts';
import { settableView } from './reflexes.fakes.ts';

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
      },
    ]);
    idleStuckReflex.check(at(view, IDLE_TICKS + IDLE_TICKS - 1));
    expect(watchLines(log)).toHaveLength(1);
    idleStuckReflex.check(at(view, IDLE_TICKS * 2));
    expect(watchLines(log)).toHaveLength(2);
    expect(watchLines(log)[1]?.idle_seconds).toBe(120);
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
});
