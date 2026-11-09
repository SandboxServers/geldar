import type { Intent } from '@geldar/contract';
import { describe, expect, it } from 'vitest';
import { makeId } from '../ids.ts';
import { PlayerSim } from './player-sim.ts';
import { parseScenario } from './scenario.ts';

// day_length_seconds 24 gives 1000 ticks a second: tick t is reached at t ms.
function build(over: Record<string, unknown> = {}): PlayerSim {
  const scenario = parseScenario(
    JSON.stringify({
      name: 'test',
      day_length_seconds: 24,
      character: {
        name: 'Aldric',
        life_id: 'ag_aldric_01',
        position: { x: 0, y: 64, z: 0 },
        facts: ['has_axe'],
      },
      reflex: { hunger_interval_ticks: 100000, eat_below: 14 },
      ...over,
    }),
  );
  let n = 0;
  return new PlayerSim({ scenario, startMs: 0, nextId: (p) => makeId(p, ++n) });
}

function intent(ticks: number, wakeOn: string[] = ['goal_completed']): Intent {
  return {
    goal: 'go',
    program: 'travel',
    arguments: { mock_ticks: ticks },
    preconditions: ['has_axe'],
    wake_on: wakeOn,
    limits: { max_world_ticks: 100000, max_block_operations: 10 },
  } as unknown as Intent;
}

const clearAt1200 = { events: [{ type: 'clear_fact', at_tick: 1200, fact: 'has_axe' }] };

describe('PlayerSim', () => {
  it('flags addressed speech and keeps the words', () => {
    const sim = build({
      events: [
        { type: 'speech', at_tick: 300, from: 'Bram', to: null, text: 'hello all' },
        { type: 'speech', at_tick: 600, from: 'Bram', to: 'Aldric', text: 'Aldric, hi' },
      ],
    });
    sim.syncTo(1000);
    const [a, b] = sim.log.since(0).events;
    expect(sim.log.lastSeq()).toBe(2);
    expect(a).toMatchObject({ tick: 300, addressed: false, from: 'Bram', text: 'hello all' });
    expect(b).toMatchObject({ tick: 600, addressed: true, from: 'Bram', text: 'Aldric, hi' });
  });

  it('advances the intent before applying the cleared fact (failed at 200)', () => {
    const sim = build(clearAt1200);
    sim.syncTo(1000);
    expect(sim.startIntent(intent(300), 1000).ok).toBe(true);
    sim.syncTo(2000);
    expect(sim.intent()).toBeNull();
    const fin = sim.log.since(0).events.find((e) => e.kind === 'intent_finished');
    expect(fin).toMatchObject({ outcome: 'failed', failure: 'precondition_failed', tick: 1200 });
  });

  it('completes a short intent before the fact is cleared', () => {
    const sim = build(clearAt1200);
    sim.syncTo(1000);
    sim.startIntent(intent(150), 1000);
    sim.syncTo(2000);
    const fin = sim.log.since(0).events.filter((e) => e.kind === 'intent_finished');
    expect(fin).toHaveLength(1);
    expect(fin[0]).toMatchObject({ outcome: 'completed', tick: 1150 });
  });

  it('ends an intent on the same tick a fact clears as completed, not failed', () => {
    const sim = build(clearAt1200);
    sim.syncTo(1000);
    sim.startIntent(intent(200), 1000);
    sim.syncTo(2000);
    const fin = sim.log.since(0).events.filter((e) => e.kind === 'intent_finished');
    expect(fin).toHaveLength(1);
    expect(fin[0]).toMatchObject({ outcome: 'completed', tick: 1200 });
    expect(sim.facts.has('has_axe')).toBe(false);
  });

  it('logs a damage event on the tick the intent ends with wakeOn null', () => {
    const sim = build({ events: [{ type: 'damage', at_tick: 1200, amount: 3 }] });
    sim.syncTo(1000);
    sim.startIntent(intent(200), 1000);
    sim.syncTo(2000);
    const events = sim.log.since(0).events;
    expect(events.map((e) => e.kind)).toEqual(['intent_finished', 'damage']);
    expect(events[1]?.wakeOn).toBeNull();
  });

  it('logs intent_finished with the intent wake_on list', () => {
    const sim = build();
    sim.syncTo(100);
    sim.startIntent(intent(50, ['directly_addressed', 'goal_completed']), 100);
    sim.syncTo(500);
    const fin = sim.log.since(0).events.find((e) => e.kind === 'intent_finished');
    expect(fin?.wakeOn).toEqual(['directly_addressed', 'goal_completed']);
    expect(sim.receipts).toHaveLength(1);
  });

  it('runs the reflex once at the hunger step with wakeOn null', () => {
    const sim = build({
      character: {
        name: 'Aldric',
        life_id: 'ag_aldric_01',
        position: { x: 0, y: 64, z: 0 },
        food: 15,
        inventory: [{ item: 'bread', count: 2 }],
      },
      reflex: { hunger_interval_ticks: 1200, eat_below: 14 },
    });
    sim.syncTo(1250);
    const events = sim.log.since(0).events;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'reflex', tick: 1200, wakeOn: null, name: 'bread' });
    expect(sim.food).toBe(20);
    expect(sim.inventory).toEqual([{ item: 'bread', count: 1 }]);
  });

  it('puts day_night events at 12000 and 24000 but not at 0', () => {
    const sim = build();
    sim.syncTo(0);
    expect(sim.log.lastSeq()).toBe(0);
    sim.syncTo(25000);
    const events = sim.log.since(0).events;
    expect(events.map((e) => [e.kind, e.tick, e.name])).toEqual([
      ['day_night', 12000, 'dusk'],
      ['day_night', 24000, 'dawn'],
    ]);
  });

  it('is idempotent for a repeated time and ignores earlier times', () => {
    const sim = build({ events: [{ type: 'damage', at_tick: 100, amount: 2 }] });
    sim.syncTo(500);
    sim.syncTo(500);
    expect(sim.log.lastSeq()).toBe(1);
    sim.syncTo(50);
    expect(sim.log.lastSeq()).toBe(1);
    expect(sim.tick).toBe(500);
  });

  it('drops suppressed seqs that left the log', () => {
    // 1000 damage events plus dusk and dawn make 1002, so seqs 1 and 2 leave the log of 1000.
    const events = Array.from({ length: 1000 }, (_, i) => ({
      type: 'damage',
      at_tick: i + 1,
      amount: 1,
    }));
    const sim = build({ events });
    sim.syncTo(1000);
    for (const seq of [1, 2, 3, 1000]) sim.suppressedSeqs.add(seq);
    sim.syncTo(24000);
    expect(sim.log.firstSeq()).toBe(3);
    expect([...sim.suppressedSeqs]).toEqual([3, 1000]);
  });

  it('ignores a non-finite time', () => {
    const sim = build();
    sim.syncTo(500);
    sim.syncTo(Number.NaN);
    sim.syncTo(Number.POSITIVE_INFINITY);
    sim.syncTo(Number.NEGATIVE_INFINITY);
    expect(sim.tick).toBe(500);
  });

  it('skips a quiet stretch for a tiny day but keeps scenario events and an intent end', () => {
    // 24000 ticks a millisecond and a hunger step every tick: 2.4e13 ticks in the jump.
    const sim = build({
      day_length_seconds: 0.001,
      reflex: { hunger_interval_ticks: 1, eat_below: 14 },
      events: [{ type: 'damage', at_tick: 5_000_000_000, amount: 4 }],
    });
    const started = Date.now();
    sim.syncTo(1_000_000_000);
    expect(Date.now() - started).toBeLessThan(5000);
    expect(sim.tick).toBe(24_000_000_000_000);
    expect(sim.food).toBe(0);
    expect(sim.log.since(0).events.filter((e) => e.kind === 'damage')).toHaveLength(1);
  });

  it('is deterministic when it skips', () => {
    const make = (): PlayerSim =>
      build({
        day_length_seconds: 0.001,
        reflex: { hunger_interval_ticks: 7, eat_below: 14 },
      });
    const a = make();
    const b = make();
    a.syncTo(1_000_000);
    b.syncTo(1_000_000);
    expect(a.food).toBe(b.food);
    expect(a.tick).toBe(b.tick);
    expect(a.log.lastSeq()).toBe(b.log.lastSeq());
  });

  it('keeps only the last 1000 receipts', () => {
    const sim = build();
    for (let t = 1; t <= 1100; t++) sim.startIntent(intent(1), t);
    expect(sim.receipts).toHaveLength(1000);
    expect(sim.receipts[0]).toBe(makeId('in', 101));
    expect(sim.receipts[999]).toBe(makeId('in', 1100));
  });

  it('reports the next scheduled moment', () => {
    const sim = build();
    // No event and no intent: the next half-day boundary (dusk at 12000), not null.
    expect(sim.nextScheduledMs()).toBe(12000);
    sim.syncTo(1000);
    sim.startIntent(intent(300), 1000);
    expect(sim.nextScheduledMs()).toBe(1300);
  });

  it('wakes at the next hunger step when it comes before dusk and nothing else is pending', () => {
    const sim = build({ reflex: { hunger_interval_ticks: 5000, eat_below: 14 } });
    sim.syncTo(1000);
    expect(sim.nextScheduledMs()).toBe(5000);
    sim.syncTo(13000);
    expect(sim.nextScheduledMs()).toBe(15000);
  });
});
