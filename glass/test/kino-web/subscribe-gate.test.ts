// Decision 0166: the page's subscribe gate keeps the relay's limit (a burst of 8, then one per 2 s, a
// bucket for a change of agent and one for a change of mode), so surfing and a restored wall are not refused.

import { describe, expect, it } from 'vitest';
import { SUBSCRIBE_BURST, SUBSCRIBE_REFILL_MS } from '../../src/kino/relay.ts';
import {
  GATE_BURST,
  GATE_REFILL_MS,
  type GateClock,
  SubscribeGate,
} from '../../web/kino/panes/subscribe-gate.ts';

/** A clock whose timers run when the test moves time on. */
function fakeClock(): GateClock & { advance(ms: number): void } {
  let t = 0;
  let timers: { at: number; fn: () => void; id: number }[] = [];
  let next = 1;
  return {
    now: () => t,
    setTimer(fn, ms) {
      const id = next++;
      timers.push({ at: t + ms, fn, id });
      return id;
    },
    clearTimer(h) {
      timers = timers.filter((x) => x.id !== h);
    },
    advance(ms) {
      const end = t + ms;
      for (;;) {
        const due = timers.filter((x) => x.at <= end).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        timers = timers.filter((x) => x !== due);
        t = due.at;
        due.fn();
      }
      t = end;
    },
  };
}

describe('subscribe gate', () => {
  it('mirrors the relay limit', () => {
    expect(GATE_BURST).toBe(SUBSCRIBE_BURST);
    expect(GATE_REFILL_MS).toBe(SUBSCRIBE_REFILL_MS);
  });

  it('sends 8 at once, holds the 9th until a token refills, then one per 2 s', () => {
    const clock = fakeClock();
    const gate = new SubscribeGate(clock);
    const sent: string[] = [];
    for (let i = 1; i <= 10; i++) gate.request(`m${i}`, 'target', () => sent.push(`m${i}`));
    expect(sent).toEqual(['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8']);
    clock.advance(1999);
    expect(sent).toHaveLength(8);
    clock.advance(1);
    expect(sent.at(-1)).toBe('m9');
    clock.advance(2000);
    expect(sent.at(-1)).toBe('m10');
  });

  it('an immediate second step replaces the waiting one (latest wins) and keeps its place', () => {
    const clock = fakeClock();
    const gate = new SubscribeGate(clock, 1, 2000);
    const sent: string[] = [];
    gate.request('a', 'target', () => sent.push('a:1'));
    gate.request('b', 'target', () => sent.push('b:1'));
    gate.request('a', 'target', () => sent.push('a:2'));
    gate.request('b', 'target', () => sent.push('b:2'));
    expect(sent).toEqual(['a:1']);
    clock.advance(2000);
    // b's two steps sent once; a's second step is new (its first already went) and follows.
    expect(sent).toEqual(['a:1', 'b:2']);
    clock.advance(2000);
    expect(sent).toEqual(['a:1', 'b:2', 'a:2']);
  });

  it('waits out a delay (channel surfing settles, a restored wall is spaced), and a new step restarts it', () => {
    const clock = fakeClock();
    const gate = new SubscribeGate(clock);
    const sent: string[] = [];
    gate.request('a', 'target', () => sent.push('B'), 400);
    clock.advance(300);
    gate.request('a', 'target', () => sent.push('C'), 400);
    clock.advance(300);
    expect(sent).toEqual([]);
    expect(gate.waiting('a')).toBe(true);
    clock.advance(100);
    expect(sent).toEqual(['C']);
    expect(gate.waiting('a')).toBe(false);
  });

  it('keeps a bucket per kind: mode changes do not spend agent changes', () => {
    const clock = fakeClock();
    const gate = new SubscribeGate(clock, 1, 2000);
    const sent: string[] = [];
    gate.request('a', 'mode', () => sent.push('mode'));
    gate.request('b', 'target', () => sent.push('target'));
    gate.request('c', 'mode', () => sent.push('mode2'));
    expect(sent).toEqual(['mode', 'target']);
    clock.advance(2000);
    expect(sent).toEqual(['mode', 'target', 'mode2']);
  });

  it('a waiting mode change that becomes an agent change spends the agent bucket', () => {
    const clock = fakeClock();
    const gate = new SubscribeGate(clock, 1, 2000);
    const sent: string[] = [];
    gate.request('x', 'target', () => sent.push('x'));
    gate.request('a', 'mode', () => sent.push('a-mode'), 100);
    gate.request('a', 'target', () => sent.push('a-target'), 100);
    clock.advance(100);
    expect(sent).toEqual(['x']);
    clock.advance(1900);
    expect(sent).toEqual(['x', 'a-target']);
  });

  it('drops a closed monitor', () => {
    const clock = fakeClock();
    const gate = new SubscribeGate(clock, 1, 2000);
    const sent: string[] = [];
    gate.request('a', 'target', () => sent.push('a'));
    gate.request('b', 'target', () => sent.push('b'));
    gate.cancel('b');
    clock.advance(10_000);
    expect(sent).toEqual(['a']);
  });
});
