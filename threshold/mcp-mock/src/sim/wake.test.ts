import { describe, expect, it } from 'vitest';
import { evaluateWake, type WakeEvent, type WakeInput, type WakeReason } from './wake.ts';

const ALL = [
  'directly_addressed',
  'intent_finished',
  'damage',
  'agent_approached',
  'proposal',
  'day_night',
];
const RUN = ['directly_addressed', 'unexpected_damage', 'new_agent_within_8'];

function ev(partial: Partial<WakeEvent> & Pick<WakeEvent, 'kind'>): WakeEvent {
  return { seq: 1, atMs: 0, wakeOn: null, ...partial };
}

function run(events: WakeEvent[], over: Partial<WakeInput> = {}) {
  return evaluateWake({
    events,
    intentStartedMs: null,
    interests: ALL,
    nowMs: 100_000,
    lastWakeMs: null,
    config: { minSpacingMs: 20_000, intentRunTooLongMs: 300_000 },
    alreadySuppressed: new Set(),
    ...over,
  });
}

describe('evaluateWake', () => {
  it('1: chatter does not wake an intent runner', () => {
    const d = run([ev({ kind: 'speech', addressed: false, wakeOn: RUN })], {
      intentStartedMs: 90_000,
    });
    expect(d.wake).toBeNull();
    expect(d.suppressed.map((s) => s.reason)).toEqual(['overheard_chatter']);
  });

  it('2: addressed speech wakes an intent runner', () => {
    const d = run([ev({ kind: 'speech', addressed: true, wakeOn: RUN })], {
      intentStartedMs: 90_000,
    });
    expect(d.wake?.reason).toBe('directly_addressed');
  });

  it('3: addressed speech outside wake_on is suppressed', () => {
    const d = run([ev({ kind: 'speech', addressed: true, wakeOn: ['unexpected_damage'] })], {
      intentStartedMs: 90_000,
    });
    expect(d.wake).toBeNull();
    expect(d.suppressed.map((s) => s.reason)).toEqual(['not_in_wake_on']);
  });

  it('4: interests filter events', () => {
    const d = run([ev({ kind: 'damage' })], { interests: ['directly_addressed'] });
    expect(d.wake).toBeNull();
    expect(d.suppressed.map((s) => s.reason)).toEqual(['not_in_interests']);
  });

  it('5: spacing holds an event, records it once, and releases it', () => {
    const e = ev({ seq: 7, kind: 'speech', addressed: true });
    const held = run([e], { lastWakeMs: 95_000, nowMs: 100_000 });
    expect(held.wake).toBeNull();
    expect(held.suppressed).toEqual([{ seq: 7, kind: 'speech', reason: 'min_spacing', atMs: 0 }]);
    expect(held.recheckAtMs).toBe(115_000);
    const again = run([e], { lastWakeMs: 95_000, nowMs: 100_000, alreadySuppressed: new Set([7]) });
    expect(again.suppressed).toEqual([]);
    expect(again.recheckAtMs).toBe(115_000);
    const later = run([e], { lastWakeMs: 95_000, nowMs: 115_000, alreadySuppressed: new Set([7]) });
    expect(later.wake).toEqual({ reason: 'directly_addressed', seqs: [7] });
  });

  it('6: the fallback wakes a long-running intent', () => {
    const cfg = { minSpacingMs: 20_000, intentRunTooLongMs: 300_000 };
    const before = run([], { intentStartedMs: 0, nowMs: 299_999, config: cfg });
    expect(before.wake).toBeNull();
    expect(before.recheckAtMs).toBe(300_000);
    const at = run([], { intentStartedMs: 0, nowMs: 300_000, config: cfg });
    expect(at.wake).toEqual({ reason: 'intent_run_too_long', seqs: [] });
    const afterWake = run([], {
      intentStartedMs: 0,
      nowMs: 499_999,
      lastWakeMs: 200_000,
      config: cfg,
    });
    expect(afterWake.wake).toBeNull();
    expect(afterWake.recheckAtMs).toBe(500_000);
    expect(
      run([], { intentStartedMs: 0, nowMs: 500_000, lastWakeMs: 200_000, config: cfg }).wake
        ?.reason,
    ).toBe('intent_run_too_long');
  });

  it('7: priority picks directly_addressed and lists both seqs', () => {
    const d = run([
      ev({ seq: 1, kind: 'damage' }),
      ev({ seq: 2, kind: 'speech', addressed: true }),
    ]);
    expect(d.wake).toEqual({ reason: 'directly_addressed', seqs: [1, 2] });
  });

  it('8: new_agent_within_8 compares the distance', () => {
    const near = run([ev({ kind: 'agent_approached', distance: 6, wakeOn: RUN })], {
      intentStartedMs: 90_000,
    });
    expect(near.wake?.reason).toBe('new_agent_nearby');
    const far = run([ev({ kind: 'agent_approached', distance: 9, wakeOn: RUN })], {
      intentStartedMs: 90_000,
    });
    expect(far.wake).toBeNull();
    expect(far.suppressed.map((s) => s.reason)).toEqual(['not_in_wake_on']);
  });

  it('9: a reflex never wakes', () => {
    const d = run([ev({ kind: 'reflex' })]);
    expect(d.wake).toBeNull();
    expect(d.suppressed.map((s) => s.reason)).toEqual(['reflex']);
  });

  it('10: a finished intent wakes whatever wake_on says', () => {
    const d = run([
      ev({ kind: 'intent_finished', outcome: 'completed', wakeOn: ['directly_addressed'] }),
    ]);
    expect(d.wake?.reason).toBe('goal_completed');
  });

  it('11: an idle agent ignores chatter', () => {
    const d = run([ev({ kind: 'speech', addressed: false })]);
    expect(d.wake).toBeNull();
    expect(d.suppressed.map((s) => s.reason)).toEqual(['overheard_chatter']);
  });

  it('12: interests cannot suppress intent_finished', () => {
    const d = run([ev({ kind: 'intent_finished', outcome: 'completed' })], {
      interests: ['damage'],
    });
    expect(d.wake?.reason).toBe('goal_completed');
  });

  it('13: spacing does not hold intent_finished but holds other events', () => {
    const opts = { lastWakeMs: 95_000, nowMs: 100_000 };
    const fin = run(
      [ev({ kind: 'intent_finished', outcome: 'failed', failure: 'precondition_failed' })],
      opts,
    );
    expect(fin.wake?.reason).toBe('precondition_failed');
    const limit = run([ev({ kind: 'intent_finished', outcome: 'limit_reached' })], opts);
    expect(limit.wake?.reason).toBe('intent_run_too_long');
    const addressed = run([ev({ kind: 'speech', addressed: true })], opts);
    expect(addressed.wake).toBeNull();
  });

  it('14: the distance threshold is inclusive and the widest matching entry counts', () => {
    const at = (distance: number, wakeOn: string[]) =>
      run([ev({ kind: 'agent_approached', distance, wakeOn })], { intentStartedMs: 90_000 });
    expect(at(8, RUN).wake?.reason).toBe('new_agent_nearby');
    const nine = at(9, RUN);
    expect(nine.wake).toBeNull();
    expect(nine.suppressed.map((s) => s.reason)).toEqual(['not_in_wake_on']);
    const both = ['new_agent_within_4', 'new_agent_within_8'];
    expect(at(6, both).wake?.reason).toBe('new_agent_nearby');
    expect(at(9, both).wake).toBeNull();
  });

  const ORDER: Array<[WakeReason, WakeEvent]> = [
    ['precondition_failed', ev({ kind: 'intent_finished', outcome: 'failed' })],
    ['goal_completed', ev({ kind: 'intent_finished', outcome: 'completed' })],
    ['unexpected_damage', ev({ kind: 'damage' })],
    ['intent_run_too_long', ev({ kind: 'intent_finished', outcome: 'limit_reached' })],
    ['new_agent_nearby', ev({ kind: 'agent_approached', distance: 1 })],
    ['proposal', ev({ kind: 'proposal' })],
    ['day_night', ev({ kind: 'day_night' })],
  ];
  for (let k = 0; k + 1 < ORDER.length; k++) {
    const [high, highEv] = ORDER[k] as [WakeReason, WakeEvent];
    const [low, lowEv] = ORDER[k + 1] as [WakeReason, WakeEvent];
    it(`15: ${high} beats ${low} in either order`, () => {
      const a = { ...highEv, seq: 1 };
      const b = { ...lowEv, seq: 2 };
      expect(run([a, b]).wake?.reason).toBe(high);
      expect(run([b, a]).wake?.reason).toBe(high);
    });
  }

  it('16: damage, proposal and day_night obey wake_on', () => {
    const intent = { intentStartedMs: 90_000 };
    const kinds: Array<[WakeEvent['kind'], WakeReason]> = [
      ['damage', 'unexpected_damage'],
      ['proposal', 'proposal'],
      ['day_night', 'day_night'],
    ];
    for (const [kind, reason] of kinds) {
      expect(run([ev({ kind })], intent).wake?.reason).toBe(reason);
      const held = run([ev({ kind, wakeOn: ['directly_addressed'] })], intent);
      expect(held.wake).toBeNull();
      expect(held.suppressed.map((s) => s.reason)).toEqual(['not_in_wake_on']);
    }
    const dmg = run([ev({ kind: 'damage', wakeOn: ['unexpected_damage'] })], intent);
    expect(dmg.wake?.reason).toBe('unexpected_damage');
  });

  it('17: recheckAtMs is the earlier of the spacing release and the fallback', () => {
    const d = run([ev({ seq: 3, kind: 'speech', addressed: true })], {
      lastWakeMs: 95_000,
      intentStartedMs: 90_000,
      config: { minSpacingMs: 20_000, intentRunTooLongMs: 15_000 },
    });
    expect(d.wake).toBeNull();
    expect(d.recheckAtMs).toBe(110_000);
  });

  it('18: intent_finished needs no running intent, and failed needs no failure field', () => {
    const done = run([ev({ kind: 'intent_finished', outcome: 'completed' })], {
      intentStartedMs: null,
    });
    expect(done.wake?.reason).toBe('goal_completed');
    const failed = run([ev({ kind: 'intent_finished', outcome: 'failed' })]);
    expect(failed.wake?.reason).toBe('precondition_failed');
  });
});
