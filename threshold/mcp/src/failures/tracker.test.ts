import type { SimEvent } from '@geldar/mcp-mock';
import { describe, expect, it } from 'vitest';
import { FailureTracker, factEvents, REPEAT_THRESHOLD } from './tracker.ts';

const LIFE = 'ag_ranger_01';
const HOME = { x: 195, y: 67, z: 211 };
const MIN = 60_000;
const GOTO = { do: 'goto', target: HOME };

function outcome(seq: number, ok: boolean, name = 'goto', reason = 'blocked'): SimEvent {
  return {
    seq,
    tick: seq,
    atMs: seq,
    kind: ok ? 'action' : 'action_failed',
    name,
    ...(ok ? {} : { reason }),
  } as unknown as SimEvent;
}

/** Submits one goto and observes its failure, `n` times, at the same place. */
function fails(t: FailureTracker, n: number, from = 1, at = HOME, nowMs = 0): string[] {
  let facts: string[] = [];
  for (let i = 0; i < n; i++) {
    t.submitted(LIFE, [GOTO]);
    facts = t.observe(LIFE, [outcome(from + i, false)], at, nowMs);
  }
  return facts;
}

describe('FailureTracker', () => {
  it('states nothing below the threshold and the fact at it', () => {
    const t = new FailureTracker();
    expect(fails(t, REPEAT_THRESHOLD - 1)).toEqual([]);
    expect(fails(t, 1, REPEAT_THRESHOLD)).toEqual([
      'goto 195,67,211 has failed 3 times in a row (blocked).',
    ]);
  });

  it('counts further failures and says how long the position is unchanged', () => {
    const t = new FailureTracker();
    t.observe(LIFE, [], HOME, 0);
    const facts = fails(t, 4, 1, HOME, 12 * MIN);
    expect(facts).toEqual([
      'goto 195,67,211 has failed 4 times in a row (blocked); position unchanged for 12 minutes.',
    ]);
  });

  it('does not count an outcome twice when the same events are read again', () => {
    const t = new FailureTracker();
    fails(t, 3);
    const again = t.observe(
      LIFE,
      [outcome(1, false), outcome(2, false), outcome(3, false)],
      HOME,
      0,
    );
    expect(again[0]).toContain('3 times');
  });

  it('keeps separate goals apart', () => {
    const t = new FailureTracker();
    fails(t, 2);
    t.submitted(LIFE, [{ do: 'goto', target: { x: 1, y: 2, z: 3 } }]);
    expect(t.observe(LIFE, [outcome(3, false)], HOME, 0)).toEqual([]);
  });

  it('resets on any success', () => {
    const t = new FailureTracker();
    fails(t, 3);
    t.submitted(LIFE, [{ do: 'mine', block: 'oak_log', count: 1 }]);
    expect(t.observe(LIFE, [outcome(4, true, 'mine')], HOME, 0)).toEqual([]);
    expect(fails(t, 1, 5)).toEqual([]);
  });

  it('resets when the position moves more than 3 blocks, and not for 3', () => {
    const t = new FailureTracker();
    fails(t, 3);
    expect(t.observe(LIFE, [], { ...HOME, x: HOME.x + 3 }, 0)).toHaveLength(1);
    expect(t.observe(LIFE, [], { ...HOME, x: HOME.x + 4 }, 0)).toEqual([]);
  });

  it('bounds the goals it remembers', () => {
    const t = new FailureTracker();
    for (let i = 0; i < 30; i++) {
      t.submitted(LIFE, [{ do: 'goto', target: { x: i, y: 1, z: 1 } }]);
      t.observe(LIFE, [outcome(i + 1, false)], HOME, 0);
    }
    // The oldest goal was dropped: failing it twice more does not reach three.
    t.submitted(LIFE, [{ do: 'goto', target: { x: 0, y: 1, z: 1 } }]);
    expect(t.observe(LIFE, [outcome(100, false)], HOME, 0)).toEqual([]);
  });

  it('tells a sleep with the same place, health and belongings from one that differs', () => {
    const t = new FailureTracker();
    const snap = (x: number, health = 20) =>
      ({ self: { position: { x, y: 1, z: 1 }, health, inventory: [] } }) as never;
    expect(t.sameAsLastSleep(LIFE, snap(1))).toBe(false);
    expect(t.sameAsLastSleep(LIFE, snap(1))).toBe(true);
    expect(t.sameAsLastSleep(LIFE, snap(2))).toBe(false);
    expect(t.sameAsLastSleep(LIFE, snap(2, 19))).toBe(false);
  });

  it('emits facts as events without advice', () => {
    const [e] = factEvents(['goto 1,2,3 has failed 3 times in a row.'], 0, 5);
    expect(e).toMatchObject({ seq: 1, type: 'action_failed', tick: 5 });
  });
});
