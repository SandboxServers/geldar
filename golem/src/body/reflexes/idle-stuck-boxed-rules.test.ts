import { describe, expect, it } from 'vitest';
import type { BodyView } from '../view.ts';
import {
  BOXED_COOLDOWN_TICKS,
  BOXED_RUNS_PER_HOUR,
  boxedFromProbe,
  boxedGate,
  noteBoxedAttempt,
  resetBoxedIn,
} from './idle-stuck-boxed.ts';
import { WATCH_REACH, type WatchProbe } from './idle-stuck-probe.ts';

const probe = (reach: number | null, reachExit: boolean | null): WatchProbe =>
  ({ reach, reach_exit: reachExit }) as unknown as WatchProbe;

describe('idle_stuck boxed-in region rule (decision 0336)', () => {
  it('is boxed when the planner region is short of WATCH_REACH and has no way out', () => {
    expect(boxedFromProbe(probe(WATCH_REACH - 1, false))).toBe(true);
  });

  it('is not boxed when a reached cell is a way out, however small the region (a 3-high shaft)', () => {
    expect(boxedFromProbe(probe(3, true))).toBe(false);
  });

  it('is not boxed when the region reaches WATCH_REACH cells, even with no way out', () => {
    expect(boxedFromProbe(probe(WATCH_REACH, false))).toBe(false);
  });

  it('is never boxed on an unread probe', () => {
    expect(boxedFromProbe(probe(null, null))).toBe(false);
  });
});

describe('idle_stuck boxed-in attempt gate is per life (decision 0336)', () => {
  it('a respawn forgets the hour cap and the cooldown', () => {
    const view = {} as BodyView;
    const now = 100000;
    for (let i = 0; i < BOXED_RUNS_PER_HOUR; i++) {
      noteBoxedAttempt(view, now + i * BOXED_COOLDOWN_TICKS);
    }
    const later = now + BOXED_RUNS_PER_HOUR * BOXED_COOLDOWN_TICKS;
    expect(boxedGate(view, later)).toBe('cap');
    resetBoxedIn(view);
    expect(boxedGate(view, later)).toBe('ok');
  });
});
