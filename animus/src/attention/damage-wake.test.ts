import { describe, expect, it } from 'vitest';
import { FakeMemoryStore } from '../fakes/memory.fakes.ts';
import type { MindEvent, WakeDecision } from '../ports/index.ts';
import { Attention } from './controller.ts';
import { ManualTiming } from './timing.fakes.ts';

const LIFE = 'ag_adam_04';
const ME = { name: 'Adam', username: 'Adam_B0T' };

let seq = 0;
const at = (tick: number) => ({
  eventId: `ev_dmg_${++seq}`,
  lifeId: LIFE,
  tick,
  day: 3,
  at: '2026-11-09T00:00:00Z',
});
const damage = (tick: number): MindEvent =>
  ({ ...at(tick), type: 'damage', payload: { health: 14, amount: 2 } }) as MindEvent;
const death = (tick: number): MindEvent =>
  ({ ...at(tick), type: 'death', payload: {} }) as MindEvent;

function rig() {
  const time = new ManualTiming();
  const attention = new Attention({
    lifeId: LIFE,
    identity: ME,
    config: { minWakeupSpacingS: 20, fallbackWakeupTicks: 6000, overheardToDigest: true },
    tickRate: 20,
    journal: new FakeMemoryStore(),
    clock: time,
    scheduler: time,
  });
  const decisions: WakeDecision[] = [];
  attention.onDecision((d) => decisions.push(d));
  return { time, attention, decisions };
}

describe('damage with no intent running', () => {
  it('a burst of five damage events is one unexpected_damage wake', () => {
    const r = rig();
    for (let i = 0; i < 5; i++) {
      r.attention.onEvent(damage(i));
      if (i < 4) r.time.advance(200);
    }
    // Five hits in 800 ms: the burst window (1 s from the first hit) has not closed yet.
    expect(r.decisions).toHaveLength(0);
    r.time.advance(200);
    expect(r.decisions).toHaveLength(1);
    expect(r.decisions[0]).toMatchObject({ reason: 'unexpected_damage', priority: 2 });
    expect(r.decisions[0]?.events).toHaveLength(5);
    // One wake, not one per hit: nothing more follows the burst while the thought runs.
    r.attention.thoughtStarted();
    r.time.advance(5_000);
    expect(r.decisions).toHaveLength(1);
  });

  it('after the damage thought, silence still wakes idle a period later', () => {
    const r = rig();
    r.attention.onEvent(damage(0));
    r.time.advance(1_000);
    expect(r.decisions).toHaveLength(1);
    r.attention.thoughtStarted();
    r.attention.thoughtSettled('planned');
    r.time.advance(59_999);
    expect(r.decisions).toHaveLength(1);
    r.time.advance(1);
    expect(r.decisions).toHaveLength(2);
    expect(r.decisions[1]).toMatchObject({ reason: 'idle', events: [] });
  });

  it('a death ends the life: later damage and the idle watchdog stay quiet', () => {
    const r = rig();
    r.attention.onEvent(damage(0));
    r.time.advance(1_000);
    expect(r.decisions).toHaveLength(1);
    r.attention.onEvent(death(1));
    r.attention.onEvent(damage(2));
    r.time.advance(120_000);
    expect(r.decisions).toHaveLength(1);
  });
});
