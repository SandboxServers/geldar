import { describe, expect, it } from 'vitest';
import type { BodyView } from '../view.ts';
import { IDLE_TICKS, IDLE_TICKS_ON_OWN, idleStuckReflex } from './idle-stuck.ts';
import { settableView } from './reflexes.fakes.ts';
import { noteGoto } from './unstick.ts';

/** A pillar top: the Body stands on a block it placed itself (decision 0330). */
const TOP = { x: -308.5, y: 66, z: 322.5 };

interface Live {
  tick: number | null;
  position: { x: number; y: number; z: number };
  enclosed: boolean;
  canStepOff: boolean | null;
  onOwnPlacement: boolean | null;
  isNight: boolean | undefined;
  actionRunning: boolean | undefined;
  asleep: boolean | undefined;
  riding: boolean | undefined;
}

/** A still Body on its own pillar top, open to the sky, with no Mind action running. */
function pillar(over: Partial<Live> = {}): Live & BodyView {
  return Object.assign(
    settableView(),
    {
      tick: 0,
      position: { ...TOP },
      enclosed: false,
      canStepOff: true,
      onOwnPlacement: true,
      isNight: false,
      actionRunning: false,
      asleep: false,
      riding: false,
    },
    over,
  ) as unknown as Live & BodyView;
}

/** Sets the world tick of a live view and returns it. */
function at(view: Live & BodyView, tick: number): Live & BodyView {
  view.tick = tick;
  return view;
}

/** A goto that ended `failed(blocked)` where the Body stood at `spot`. */
function blockedWalk(view: BodyView, spot: { x: number; y: number; z: number } = TOP): void {
  noteGoto(view, 'failed', 'blocked', 'partial: goal unreachable', false, spot);
}

describe('idle_stuck no_path trigger (decision 0332)', () => {
  it('fires on its own pillar after 120 s still with two blocked walks from this spot, not at 60 s', () => {
    const view = pillar();
    blockedWalk(view);
    blockedWalk(view);
    idleStuckReflex.check(view);
    expect(idleStuckReflex.check(at(view, IDLE_TICKS))).toBeNull();
    expect(idleStuckReflex.check(at(view, IDLE_TICKS_ON_OWN - 1))).toBeNull();
    expect(idleStuckReflex.check(at(view, IDLE_TICKS_ON_OWN))).toEqual({
      reason: 'no_path',
      idle_seconds: 120,
    });
  });

  it('does not fire on one blocked walk, nor when a completed goto sits between the two', () => {
    const one = pillar();
    blockedWalk(one);
    idleStuckReflex.check(one);
    expect(idleStuckReflex.check(at(one, IDLE_TICKS_ON_OWN))).toBeNull();

    const broken = pillar();
    blockedWalk(broken);
    noteGoto(broken, 'completed', undefined, undefined, false, TOP);
    blockedWalk(broken);
    idleStuckReflex.check(broken);
    expect(idleStuckReflex.check(at(broken, IDLE_TICKS_ON_OWN))).toBeNull();
  });

  it('does not count blocked walks from another spot (more than one block away)', () => {
    const view = pillar();
    const elsewhere = { x: TOP.x + 3, y: TOP.y, z: TOP.z };
    blockedWalk(view, elsewhere);
    blockedWalk(view, elsewhere);
    idleStuckReflex.check(view);
    expect(idleStuckReflex.check(at(view, IDLE_TICKS_ON_OWN))).toBeNull();
  });

  it('does not fire for an agent waiting on its pillar with no failed walk', () => {
    const view = pillar();
    idleStuckReflex.check(view);
    expect(idleStuckReflex.check(at(view, IDLE_TICKS_ON_OWN))).toBeNull();
  });

  it('does not fire for a free agent (not on its own placement) even after two blocked walks', () => {
    const view = pillar({ onOwnPlacement: false });
    blockedWalk(view);
    blockedWalk(view);
    idleStuckReflex.check(view);
    expect(idleStuckReflex.check(at(view, IDLE_TICKS))).toBeNull();
    expect(idleStuckReflex.check(at(view, IDLE_TICKS_ON_OWN))).toBeNull();
  });

  it('leaves an enclosed Body to the enclosure rules, at night as well', () => {
    const view = pillar({ enclosed: true, isNight: true });
    blockedWalk(view);
    blockedWalk(view);
    idleStuckReflex.check(view);
    expect(idleStuckReflex.check(at(view, IDLE_TICKS_ON_OWN))).toBeNull();
  });
});
