import { validateWakePayload } from '@geldar/contract';
import { beforeEach, describe, expect, it } from 'vitest';
import { FakeMemoryStore } from '../fakes/memory.fakes.ts';
import type { MindEvent, ReflectionDue, WakeDecision } from '../ports/index.ts';
import { Attention } from './controller.ts';
import { BODY_WAKE_REASONS } from './policy.ts';
import { ManualTiming } from './timing.fakes.ts';

const LIFE = 'ag_adam_03';
const ME = { name: 'Adam', username: 'Adam_B0T' };

let seq = 0;
const base = (tick: number) => ({
  eventId: `ev_${++seq}`,
  lifeId: LIFE,
  tick,
  day: 3,
  at: '2026-11-09T00:00:00Z',
});

const wake = (reason: string, tick = 0, intent: string | null = 'in_1'): MindEvent => ({
  ...base(tick),
  type: 'wake',
  payload: { reason, tick, intent_id: intent },
});
const speech = (from: string, text: string, tick = 0, own = false): MindEvent => ({
  ...base(tick),
  type: 'speech',
  payload: { from, text, distance: 3, own },
});
const intent = (id: string, state: string, tick = 0): MindEvent =>
  ({
    ...base(tick),
    type: 'intent',
    payload: { intent_id: id, life_id: LIFE, body_generation: 1, state, tick },
  }) as MindEvent;
const plain = (type: 'death' | 'sleep'): MindEvent => ({ ...base(0), type, payload: {} });

interface Rig {
  time: ManualTiming;
  store: FakeMemoryStore;
  attention: Attention;
  decisions: WakeDecision[];
  due: ReflectionDue[];
}

function rig(counterparties: string[] = []): Rig {
  const time = new ManualTiming();
  const store = new FakeMemoryStore();
  const attention = new Attention({
    lifeId: LIFE,
    identity: ME,
    config: { minWakeupSpacingS: 20, fallbackWakeupTicks: 6000, overheardToDigest: true },
    tickRate: 20,
    journal: store,
    isCounterparty: (s) => counterparties.includes(s),
    clock: time,
    scheduler: time,
  });
  const decisions: WakeDecision[] = [];
  const due: ReflectionDue[] = [];
  attention.onDecision((d) => decisions.push(d));
  attention.onReflectionDue((d) => due.push(d));
  return { time, store, attention, decisions, due };
}

let r: Rig;
beforeEach(() => {
  r = rig(['Eve']);
});

describe('speech', () => {
  it('ten overheard lines give zero wakes and one digest', () => {
    for (let i = 0; i < 10; i++) {
      r.attention.onEvent(speech(i % 2 === 0 ? 'Bob' : 'Cy', `line ${i}`, i));
    }
    expect(r.decisions).toHaveLength(0);
    expect(r.store.suppressed.filter((s) => s.reason === 'digested')).toHaveLength(10);
    const summary = r.attention.digestSummary();
    expect(summary).toEqual([
      { speaker: 'Bob', count: 5, lastLines: ['line 4', 'line 6', 'line 8'] },
      { speaker: 'Cy', count: 5, lastLines: ['line 5', 'line 7', 'line 9'] },
    ]);
    r.attention.onEvent(speech('Steve', 'Adam, hello', 11));
    expect(r.decisions).toHaveLength(1);
    expect(r.decisions[0]?.digest).toHaveLength(6);
    expect(r.decisions[0]?.digestSummary).toEqual(summary);
    expect(r.attention.digestSummary()).toEqual([]);
  });

  it('an addressed line gives one wake at priority 2', () => {
    r.attention.onEvent(speech('Steve', 'Adam, come here'));
    expect(r.decisions).toHaveLength(1);
    expect(r.decisions[0]).toMatchObject({ reason: 'speech_addressed', priority: 2 });
  });

  it('about_me and about_my_commitments wake; own speech does not', () => {
    r.attention.onEvent(speech('Adam', 'Adam is talking to himself', 0, true));
    expect(r.decisions).toHaveLength(0);
    r.attention.onEvent(speech('Eve', 'the delivery is ready'));
    expect(r.decisions[0]).toMatchObject({ reason: 'speech_about_my_commitments', priority: 1 });
  });
});

describe('spacing', () => {
  it('five Body wakes within 20 s give one wake plus one deferred', () => {
    r.attention.onEvent(wake('goal_completed', 1));
    expect(r.decisions).toHaveLength(1);
    r.attention.thoughtStarted();
    r.attention.thoughtSettled('planned');
    for (const reason of ['limit_reached', 'new_agent_within_16', 'action_failed', 'idle']) {
      r.time.advance(2000);
      r.attention.onEvent(wake(reason, 2));
    }
    expect(r.decisions).toHaveLength(1);
    expect(r.store.suppressed.filter((s) => s.reason === 'min_spacing')).toHaveLength(4);
    r.time.advance(11_999);
    expect(r.decisions).toHaveLength(1);
    r.time.advance(1);
    expect(r.decisions).toHaveLength(2);
    expect(r.decisions[1]?.reason).toBe('action_failed');
    expect(r.decisions[1]?.events).toHaveLength(4);
  });

  it('no_plan and mind_start are exempt', () => {
    r.attention.start();
    expect(r.decisions.map((d) => d.reason)).toEqual(['mind_start']);
    r.attention.thoughtSettled('planned');
    r.attention.onEvent(wake('no_plan'));
    expect(r.decisions.map((d) => d.reason)).toEqual(['mind_start', 'no_plan']);
    r.attention.thoughtSettled('planned');
    r.attention.onEvent(wake('goal_completed'));
    expect(r.decisions).toHaveLength(2);
  });

  it('records the same wake arriving twice as a duplicate', () => {
    r.attention.onEvent(wake('goal_completed'));
    r.attention.thoughtSettled('planned');
    r.attention.onEvent(wake('limit_reached'));
    r.attention.onEvent(wake('limit_reached'));
    expect(r.store.suppressed.map((s) => s.reason)).toEqual(['min_spacing', 'duplicate']);
  });
});

describe('one thought in flight', () => {
  it('coalesces wakes that arrive meanwhile and records them', () => {
    r.attention.onEvent(wake('goal_completed'));
    r.attention.onEvent(wake('limit_reached', 1));
    r.attention.onEvent(speech('Steve', 'Adam!', 2));
    expect(r.decisions).toHaveLength(1);
    const held = r.store.suppressed.filter((s) => s.reason === 'coalesced_in_flight');
    expect(held.map((s) => s.eventTypes)).toEqual([['wake'], ['speech']]);
    expect(held[0]?.intentId).toBe('in_1');
    r.time.advance(20_000);
    r.attention.thoughtSettled('planned');
    expect(r.decisions).toHaveLength(2);
    expect(r.decisions[1]).toMatchObject({ reason: 'speech_addressed' });
    expect(r.decisions[1]?.events).toHaveLength(2);
  });
});

describe('priority', () => {
  it('picks the most urgent pending reason and keeps every event', () => {
    r.attention.start();
    r.attention.thoughtSettled('planned');
    r.attention.onEvent(wake('idle'));
    r.attention.onEvent(wake('goal_completed'));
    r.attention.onEvent(wake('reflex_danger'));
    r.attention.onEvent(wake('limit_reached'));
    r.time.advance(20_000);
    expect(r.decisions[1]).toMatchObject({ reason: 'reflex_danger', priority: 2 });
    expect(r.decisions[1]?.events).toHaveLength(4);
  });

  it('puts an addressed line over a commitment line over a mention', () => {
    r.attention.start();
    r.attention.thoughtSettled('planned');
    r.attention.onEvent(speech('Steve', 'I saw Adam today'));
    r.attention.onEvent(speech('Eve', 'bringing the wood'));
    expect(r.decisions).toHaveLength(1);
    r.time.advance(20_000);
    expect(r.decisions[1]?.reason).toBe('speech_about_my_commitments');
    r.attention.thoughtSettled('planned');
    r.attention.onEvent(speech('Steve', 'Adam, help'));
    r.attention.onEvent(wake('goal_completed'));
    r.time.advance(20_000);
    expect(r.decisions[2]?.reason).toBe('speech_addressed');
  });
});

describe('fallback and idle', () => {
  it('fires a fallback after N ticks of a running intent without a thought', () => {
    r.attention.onEvent(intent('in_1', 'running'));
    r.time.advance(299_999);
    expect(r.decisions).toHaveLength(0);
    r.time.advance(1);
    expect(r.decisions).toHaveLength(1);
    expect(r.decisions[0]).toMatchObject({ reason: 'fallback', priority: 0 });
  });

  it('a thought restarts the fallback count', () => {
    r.attention.onEvent(intent('in_1', 'running'));
    r.time.advance(200_000);
    r.attention.thoughtStarted();
    r.attention.thoughtSettled('planned');
    r.time.advance(299_999);
    expect(r.decisions).toHaveLength(0);
    r.time.advance(1);
    expect(r.decisions[0]?.reason).toBe('fallback');
  });

  it('wakes idle after an intent ends with no Body wake', () => {
    r.attention.onEvent(intent('in_1', 'running'));
    r.attention.onEvent(intent('in_1', 'completed'));
    r.time.advance(249);
    expect(r.decisions).toHaveLength(0);
    r.time.advance(1);
    expect(r.decisions[0]).toMatchObject({ reason: 'idle', priority: 0 });
    expect(r.time.pending).toBe(0);
  });

  it('does not wake idle when the Body wakes for that intent, or a new intent began', () => {
    r.attention.onEvent(intent('in_1', 'running'));
    r.attention.onEvent(intent('in_1', 'completed'));
    r.attention.onEvent(wake('goal_completed', 0, 'in_1'));
    r.attention.thoughtSettled('planned');
    r.time.advance(30_000);
    expect(r.decisions.map((d) => d.reason)).toEqual(['goal_completed']);
    r.attention.onEvent(intent('in_2', 'running'));
    r.attention.onEvent(intent('in_2', 'interrupted'));
    r.attention.onEvent(intent('in_3', 'accepted'));
    r.time.advance(300);
    expect(r.decisions).toHaveLength(1);
  });
});

describe('an idle wake across a thought', () => {
  it('an intent that ends during a long thought wakes idle at the settle, not a minute later', () => {
    r.attention.thoughtStarted();
    r.attention.onEvent(intent('in_1', 'running'));
    r.attention.onEvent(intent('in_1', 'completed'));
    r.time.advance(250);
    expect(r.decisions).toHaveLength(0);
    r.time.advance(120_000);
    expect(r.decisions).toHaveLength(0);
    r.attention.thoughtSettled('planned');
    expect(r.decisions.map((d) => d.reason)).toEqual(['idle']);
  });
});

describe('idle watchdog and stop', () => {
  it('after a say-only or held thought with no intent, wakes idle after the watchdog period', () => {
    r.attention.thoughtStarted();
    r.attention.thoughtSettled('fallback_hold');
    r.time.advance(59_999);
    expect(r.decisions).toHaveLength(0);
    r.time.advance(1);
    expect(r.decisions).toHaveLength(1);
    expect(r.decisions[0]).toMatchObject({ reason: 'idle', priority: 0, events: [] });
  });

  it('stands down when an intent starts before the watchdog fires', () => {
    r.attention.thoughtSettled('planned');
    r.time.advance(30_000);
    r.attention.onEvent(intent('in_1', 'running'));
    r.time.advance(120_000);
    expect(r.decisions).toHaveLength(0);
  });

  it('a second idle wake follows the first after another period, not before', () => {
    r.attention.thoughtStarted();
    r.attention.thoughtSettled('model_error');
    r.time.advance(60_000);
    r.attention.thoughtStarted();
    r.attention.thoughtSettled('invalid_output');
    r.time.advance(59_000);
    expect(r.decisions).toHaveLength(1);
    r.time.advance(1_000);
    expect(r.decisions).toHaveLength(2);
  });

  it('stop() cancels the idle watchdog, the fallback and every settle timer', () => {
    r.attention.thoughtSettled('planned');
    r.attention.onEvent(intent('in_1', 'running'));
    r.attention.onEvent(intent('in_1', 'completed'));
    r.attention.stop();
    r.time.advance(600_000);
    expect(r.decisions).toHaveLength(0);
    expect(r.time.pending).toBe(0);
  });

  it('a fallback held behind a thought that outlasts it is dropped on settle', () => {
    r.attention.thoughtStarted();
    r.attention.onEvent(intent('in_1', 'running'));
    r.time.advance(300_000);
    expect(r.decisions).toHaveLength(0);
    r.attention.thoughtSettled('planned');
    expect(r.decisions).toHaveLength(0);
    r.time.advance(300_000);
    expect(r.decisions.map((d) => d.reason)).toEqual(['fallback']);
  });
});

describe('one addressed line, one thought', () => {
  it('a speech line then its directly_addressed wake make one thought', () => {
    r.attention.start();
    r.attention.thoughtSettled('planned');
    r.time.advance(20_000);
    r.attention.onEvent(speech('Steve', 'Adam, hi', 5));
    r.attention.onEvent(wake('directly_addressed', 5, null));
    expect(r.decisions).toHaveLength(2);
    expect(r.decisions[1]).toMatchObject({ reason: 'speech_addressed' });
    r.attention.thoughtSettled('planned');
    r.time.advance(20_000);
    expect(r.decisions).toHaveLength(2);
    r.attention.onEvent(speech('Steve', 'Adam, again', 9));
    expect(r.decisions).toHaveLength(3);
  });

  it('a directly_addressed wake then the speech line make one thought', () => {
    r.attention.start();
    r.attention.thoughtSettled('planned');
    r.time.advance(20_000);
    r.attention.onEvent(wake('directly_addressed', 7, null));
    r.attention.onEvent(speech('Steve', 'Adam, hi', 7));
    expect(r.decisions).toHaveLength(2);
    r.attention.thoughtSettled('planned');
    r.time.advance(20_000);
    expect(r.decisions).toHaveLength(2);
  });

  it('both copies held behind one thought merge into one wake', () => {
    r.attention.start();
    r.attention.thoughtSettled('planned');
    r.time.advance(20_000);
    r.attention.thoughtStarted();
    r.attention.onEvent(speech('Steve', 'Adam, hi', 3));
    r.attention.onEvent(wake('directly_addressed', 3, null));
    expect(r.decisions).toHaveLength(1);
    r.attention.thoughtSettled('planned');
    r.time.advance(20_000);
    expect(r.decisions).toHaveLength(2);
    expect(r.decisions[1]?.events).toHaveLength(2);
  });

  it('a directly_addressed wake whose tick is greater than the speech tick still folds into the thought', () => {
    r.attention.start();
    r.attention.thoughtSettled('planned');
    r.time.advance(20_000);
    r.attention.onEvent(speech('Steve', 'Adam, hi', 5));
    r.attention.onEvent(wake('directly_addressed', 9, null));
    expect(r.decisions).toHaveLength(2);
    expect(r.decisions[1]).toMatchObject({ reason: 'speech_addressed' });
    expect(r.store.suppressed.map((s) => s.reason)).toEqual(['duplicate']);
    r.attention.thoughtSettled('planned');
    r.time.advance(20_000);
    expect(r.decisions).toHaveLength(2);
  });

  it('two chat lines from different speakers in the same second give two thoughts', () => {
    r.attention.start();
    r.attention.thoughtSettled('planned');
    r.time.advance(20_000);
    r.attention.onEvent(speech('Steve', 'Adam, hi', 5));
    r.attention.thoughtSettled('planned');
    r.time.advance(1_000);
    r.attention.onEvent(speech('Eve', 'Adam, hey', 5));
    r.time.advance(20_000);
    expect(r.decisions.map((d) => d.reason)).toEqual([
      'mind_start',
      'speech_addressed',
      'speech_addressed',
    ]);
    expect(r.store.suppressed.map((s) => s.reason)).not.toContain('duplicate');
  });

  it('a directly_addressed wake more than 3 s after the speech line is a second thought', () => {
    r.attention.start();
    r.attention.thoughtSettled('planned');
    r.time.advance(20_000);
    r.attention.onEvent(speech('Steve', 'Adam, hi', 5));
    r.attention.thoughtSettled('planned');
    r.time.advance(4_000);
    r.attention.onEvent(wake('directly_addressed', 5, null));
    r.time.advance(20_000);
    expect(r.decisions.map((d) => d.reason)).toEqual([
      'mind_start',
      'speech_addressed',
      'directly_addressed',
    ]);
    expect(r.store.suppressed.map((s) => s.reason)).not.toContain('duplicate');
  });
});

describe('death and sleep', () => {
  it('a death clears pending wakes, digest and timers', () => {
    r.attention.onEvent(intent('in_1', 'running'));
    r.attention.onEvent(wake('goal_completed'));
    r.attention.onEvent(wake('limit_reached'));
    r.attention.onEvent(speech('Bob', 'chatter'));
    r.attention.onEvent(plain('death'));
    expect(r.attention.digestSummary()).toEqual([]);
    expect(r.time.pending).toBe(0);
    r.attention.thoughtSettled('planned');
    r.time.advance(600_000);
    expect(r.decisions).toHaveLength(1);
  });

  it('after a death, an intent end and a Body wake give no thought', () => {
    r.attention.onEvent(intent('in_1', 'running'));
    r.attention.onEvent(plain('death'));
    r.attention.onEvent(intent('in_1', 'interrupted'));
    r.attention.onEvent(wake('goal_completed'));
    r.time.advance(600_000);
    expect(r.decisions).toHaveLength(0);
  });

  it('a sleep event emits ReflectionDue and does not wake', () => {
    r.attention.onEvent(plain('sleep'));
    expect(r.decisions).toHaveLength(0);
    expect(r.due).toHaveLength(1);
    expect(r.due[0]).toMatchObject({ lifeId: LIFE, day: 3 });
  });
});

describe('robustness', () => {
  it('a failed suppression record is logged with the life id and an error code', async () => {
    const lines: Record<string, unknown>[] = [];
    const journal = Object.assign(Object.create(r.store), {
      recordSuppressed: () => Promise.reject(new Error('db down')),
    });
    const attention = new Attention({
      lifeId: LIFE,
      identity: ME,
      config: { minWakeupSpacingS: 20, fallbackWakeupTicks: 6000, overheardToDigest: true },
      tickRate: 20,
      journal,
      log: (line) => lines.push(line),
      clock: r.time,
      scheduler: r.time,
    });
    attention.onEvent(speech('Bob', 'chatter'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(lines).toEqual([
      expect.objectContaining({ life_id: LIFE, code: 'suppression_record_failed' }),
    ]);
  });

  it('ignores other lives and survives a failing subscriber', () => {
    r.attention.onDecision(() => {
      throw new Error('boom');
    });
    r.attention.onEvent({ ...wake('goal_completed'), lifeId: 'ag_other' });
    expect(r.decisions).toHaveLength(0);
    r.attention.onEvent(wake('goal_completed'));
    expect(r.decisions).toHaveLength(1);
  });

  it('records an unknown Body wake reason instead of waking', () => {
    r.attention.onEvent(wake('something_new'));
    expect(r.decisions).toHaveLength(0);
    expect(r.store.suppressed.map((s) => s.reason)).toEqual(['intent_running']);
  });
});

describe('the Body wake reasons', () => {
  it('every listed reason is a reason the contract schema admits, and the schema admits no other', () => {
    for (const reason of [...BODY_WAKE_REASONS, 'new_agent_within_8']) {
      expect(validateWakePayload({ reason, tick: 0, intent_id: null }).ok).toBe(true);
    }
    expect(validateWakePayload({ reason: 'speech_addressed', tick: 0, intent_id: null }).ok).toBe(
      false,
    );
  });
});
