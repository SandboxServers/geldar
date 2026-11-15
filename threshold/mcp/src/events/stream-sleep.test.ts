import type { SpeechIdentity } from '@geldar/player-core/src/attention/classify.ts';
import { eventOf } from '@geldar/player-core/src/link/link.fixtures.ts';
import { describe, expect, it } from 'vitest';
import { FakeJournalStore } from '../fakes/stores.fakes.ts';
import type { SleepMark, SleepMarks } from '../ports.ts';
import { PendingSleeps, type SleepCompletionDeps } from '../tools/sleep-completion.ts';
import { RingEventLog } from './player-log.ts';
import { handleStreamMessage, type StreamContext } from './stream.ts';

const LIFE = 'ag_jason_01';
const OTHER = 'ag_mira_01';
// Ids in the contract's shape (the contract's own plan_result fixture uses the same form).
const THOUGHT = 'th_01HZX3V9Q4M2K8R7T6Y5W4E3D1';
const ACTION = 'ac_01HZX3V9Q4M2K8R7T6Y5W4E3D7';
const JOURNAL_LINE = 'Day 1: asleep. 1 events since the last sleep, 0 lost before them.';

/** A plan_result WorldEvent for a life, with a valid payload unless the test overrides it. */
function planResult(lifeId: string, payload: unknown = validPayload()) {
  return { ...eventOf('plan_result', 1, lifeId), payload };
}

function validPayload() {
  return {
    thought_id: THOUGHT,
    intent: 'started',
    failed_at: null,
    actions: [{ action_id: ACTION, state: 'completed' }],
    said: true,
  };
}

function setup(withSleep: boolean) {
  const pending = new PendingSleeps();
  pending.add(LIFE, THOUGHT, { day: 1, cursor: 1, action: 0, journal: JOURNAL_LINE });
  const writes: SleepMark[] = [];
  const marks: SleepMarks = {
    read: async () => ({ lastSleepDay: 0, cursor: 0 }),
    write: async (_lifeId, mark) => {
      writes.push(mark);
    },
  };
  const journal = new FakeJournalStore();
  const logged: Record<string, unknown>[] = [];
  const sleep: SleepCompletionDeps = {
    pending,
    marks,
    journal,
    now: () => 0,
    log: (line) => logged.push(line),
  };
  const ctx: StreamContext = {
    map: { identity: {} as SpeechIdentity, runs: new Map() },
    log: new RingEventLog(),
    lives: () => [LIFE],
    ...(withSleep ? { sleep } : {}),
  };
  const journalTexts = async () => (await journal.recent(LIFE, 50)).map((line) => line.text);
  return { pending, writes, journalTexts, logged, ctx };
}

describe('stream: a plan_result settles the pending sleep', () => {
  it('a completed sleep writes one mark and one journal line', async () => {
    const s = setup(true);
    await handleStreamMessage(1, planResult(LIFE), s.ctx, { invalid: 0 });
    expect(s.writes).toEqual([{ lastSleepDay: 1, cursor: 1 }]);
    expect(await s.journalTexts()).toEqual([JOURNAL_LINE]);
    expect(s.pending.get(LIFE, THOUGHT)).toBeUndefined();
  });

  it('without a sleep context nothing is written and the entry waits', async () => {
    const s = setup(false);
    await handleStreamMessage(1, planResult(LIFE), s.ctx, { invalid: 0 });
    expect(s.writes).toEqual([]);
    expect(await s.journalTexts()).toEqual([]);
    expect(s.pending.get(LIFE, THOUGHT)).toBeDefined();
  });

  it("another life's plan_result writes nothing and leaves the entry", async () => {
    const s = setup(true);
    await handleStreamMessage(1, planResult(OTHER), s.ctx, { invalid: 0 });
    expect(s.writes).toEqual([]);
    expect(await s.journalTexts()).toEqual([]);
    expect(s.pending.get(LIFE, THOUGHT)).toBeDefined();
  });

  it('an invalid plan_result payload writes nothing, and the log line carries no payload', async () => {
    const s = setup(true);
    const counters = { invalid: 0 };
    const bad = planResult(LIFE, { thought_id: THOUGHT, actions: 'secret-world-text' });
    await handleStreamMessage(1, bad, s.ctx, counters);
    expect(s.writes).toEqual([]);
    expect(await s.journalTexts()).toEqual([]);
    expect(s.pending.get(LIFE, THOUGHT)).toBeDefined();
    expect(JSON.stringify(s.logged)).not.toContain('secret-world-text');
  });
});
