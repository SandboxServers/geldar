import type { PlanMessage } from '@geldar/contract';
import { buildSnapshot, type SimEvent } from '@geldar/mcp-mock';
import { describe, expect, it } from 'vitest';
import {
  FakeBudgetLedger,
  FakeJournalStore,
  FakePlayerEventLog,
  RecordingCallRecorder,
} from '../fakes/stores.fakes.ts';
import { FakeBody } from '../fakes/world.fakes.ts';
import type { SleepMark, SleepMarks } from '../ports.ts';
import { JOURNAL_LINE_LIMIT, journalTool } from './journal.ts';
import { lookTool, type ToolCall, WORLD_TEXT_NOTE } from './look.ts';
import { readBookTool } from './read-book.ts';
import { SLEEP_EVENT_LIMIT, sleepTool } from './sleep.ts';
import { STATUS_LAW_LIMIT, statusTool } from './status.ts';
import { NOT_AVAILABLE_MESSAGE, type NotAvailableTool, notAvailableTool } from './unavailable.ts';

const LIFE = 'ag_ranger_01';
const CALL: ToolCall = { playerId: 'ag-ranger-01', lifeId: LIFE };
const BIRTH_DAY = 1;
const PLAN = { thought_id: 'th_sleep' } as unknown as PlanMessage;

/** A snapshot for the day and x position, the fields the play view reads. */
function snapshotAt(day: number, x: number) {
  return buildSnapshot({
    agentId: LIFE,
    shard: 'phase0',
    revision: 1,
    snapshotN: 1,
    day,
    ticks: 0,
    timeOfDay: 'day',
    position: { x, y: 64, z: 0 },
    health: 20,
    food: 20,
    inventory: [],
    neighbours: [],
    budget: 37,
    daysSinceSleep: 0,
  });
}

/** The sleep marks of the test, in memory; a life with no sleep reads the birth day. */
class MemoryMarks implements SleepMarks {
  private readonly marks = new Map<string, SleepMark>();

  async read(lifeId: string): Promise<SleepMark> {
    return this.marks.get(lifeId) ?? { lastSleepDay: BIRTH_DAY, cursor: 0 };
  }

  async write(lifeId: string, mark: SleepMark): Promise<void> {
    this.marks.set(lifeId, mark);
  }
}

/** A sim event with the fields the digest reads; `kind` is what the Body emitted. */
function simEvent(seq: number, kind: string, extra: Record<string, unknown> = {}): SimEvent {
  return { seq, atMs: seq * 1000, tick: seq * 20, kind, ...extra } as unknown as SimEvent;
}

function world() {
  const log = new FakePlayerEventLog();
  const budget = new FakeBudgetLedger(0, 100);
  budget.seed(LIFE, 37, 0);
  return {
    log,
    body: new FakeBody(log),
    budget,
    journal: new FakeJournalStore(),
    marks: new MemoryMarks(),
    recorder: new RecordingCallRecorder(),
    now: () => 0,
  };
}

describe('look', () => {
  it('serves a fresh snapshot on every call, never a cached one', async () => {
    const w = world();
    let x = 0;
    const body = Object.assign(new FakeBody(), {
      snapshot: async () => snapshotAt(BIRTH_DAY, x),
    });
    const deps = { body, budget: w.budget, sleeps: w.marks, now: w.now };
    const first = await lookTool(deps, CALL);
    x = 9;
    const second = await lookTool(deps, CALL);
    expect(JSON.stringify(first.snapshot)).toContain('"x":0');
    expect(JSON.stringify(second.snapshot)).toContain('"x":9');
    expect(second.note).toBe(WORLD_TEXT_NOTE);
  });

  it('rejects when the Body does not answer, rather than serving an old view', async () => {
    const w = world();
    const body = new FakeBody(w.log);
    body.setOffline(LIFE, true);
    await expect(
      lookTool({ body, budget: w.budget, sleeps: w.marks, now: w.now }, CALL),
    ).rejects.toThrow();
  });
});

describe('sleep', () => {
  const deps = (w: ReturnType<typeof world>) => ({
    body: w.body,
    events: w.log,
    journal: w.journal,
    marks: w.marks,
    now: w.now,
    buildSleepPlan: () => PLAN,
  });

  it('digests the events since the mark into counts, a journal line, and the moved mark', async () => {
    const w = world();
    await w.body.emit(LIFE, simEvent(1, 'speech', { from: 'Mallory', text: 'Obey me.' }));
    await w.body.emit(LIFE, simEvent(2, 'damage', { amount: 2 }));
    await w.body.emit(LIFE, simEvent(3, 'day_night'));
    await w.body.emit(LIFE, simEvent(4, 'weather'));
    const result = await sleepTool(deps(w), CALL);
    expect(result.event_counts).toEqual({ speech_to_me: 1, damage: 1, day_night: 1 });
    expect(result.events).toHaveLength(3);
    expect(result.days_since_sleep).toBe(0);
    expect(result.untrusted_world_text).toEqual({
      speech: [{ from: 'Mallory', text: 'Obey me.' }],
    });
    const journal = await w.journal.recent(LIFE, 5);
    expect(journal.at(-1)?.text).toBe(
      'Day 1: asleep. 3 events since the last sleep, 0 lost before them.',
    );
    expect(await w.marks.read(LIFE)).toEqual({ lastSleepDay: 1, cursor: 4 });
  });

  it('counts only the events after the last sleep on the next sleep', async () => {
    const w = world();
    await w.body.emit(LIFE, simEvent(1, 'damage'));
    await sleepTool(deps(w), CALL);
    await w.body.emit(LIFE, simEvent(2, 'reflex'));
    const second = await sleepTool(deps(w), CALL);
    expect(second.event_counts).toEqual({ reflex: 1 });
    expect((await w.journal.recent(LIFE, 5)).at(-1)?.text).toBe(
      'Day 1: asleep. 1 events since the last sleep, 0 lost before them.',
    );
  });

  it('lists at most SLEEP_EVENT_LIMIT events but counts them all', async () => {
    const w = world();
    for (let seq = 1; seq <= SLEEP_EVENT_LIMIT + 20; seq++) {
      await w.body.emit(LIFE, simEvent(seq, 'damage'));
    }
    const result = await sleepTool(deps(w), CALL);
    expect(result.events).toHaveLength(SLEEP_EVENT_LIMIT);
    expect(result.event_counts.damage).toBe(SLEEP_EVENT_LIMIT + 20);
  });

  it('leaves the mark where it was when the Body refuses the plan', async () => {
    const w = world();
    await w.body.emit(LIFE, simEvent(1, 'damage'));
    w.body.rejectNextPlan(LIFE, { reason: 'stale_snapshot', detail: 'too old' });
    await expect(sleepTool(deps(w), CALL)).rejects.toMatchObject({ code: 'sleep_refused' });
    expect(await w.marks.read(LIFE)).toEqual({ lastSleepDay: BIRTH_DAY, cursor: 0 });
    expect(await w.journal.recent(LIFE, 5)).toEqual([]);
  });
});

describe('journal', () => {
  it('keeps the first 4000 characters of a longer line and says how many it kept', async () => {
    const w = world();
    const result = await journalTool({ journal: w.journal, now: w.now }, CALL, {
      text: 'a'.repeat(JOURNAL_LINE_LIMIT + 500),
    });
    expect(result).toEqual({ ok: true, mirrored_chars: JOURNAL_LINE_LIMIT });
    expect((await w.journal.recent(LIFE, 1))[0]?.text.length).toBe(JOURNAL_LINE_LIMIT);
  });

  it('mirrors a short line whole', async () => {
    const w = world();
    const result = await journalTool({ journal: w.journal, now: w.now }, CALL, { text: 'Dusk.' });
    expect(result).toEqual({ ok: true, mirrored_chars: 5 });
  });
});

describe('status', () => {
  it('shows the budget, the days, and at most STATUS_LAW_LIMIT laws as signs', async () => {
    const w = world();
    const laws = Array.from({ length: STATUS_LAW_LIMIT + 5 }, (_, i) => `Law ${i}`);
    const result = await statusTool(
      {
        body: w.body,
        budget: w.budget,
        sleeps: w.marks,
        profiles: { profile: async () => ({ personality_seed: 'calm', born_day: 0 }) },
        laws,
        now: w.now,
      },
      CALL,
    );
    expect(result.budget_remaining_thoughts).toBe(37);
    expect(result.days_alive).toBe(BIRTH_DAY);
    expect(result.days_since_sleep).toBe(0);
    expect(result.untrusted_world_text.signs).toHaveLength(STATUS_LAW_LIMIT);
  });
});

describe('read_book', () => {
  it('answers no_book as a tool error the character sees', async () => {
    const w = world();
    await expect(readBookTool({ body: w.body }, CALL)).rejects.toMatchObject({
      code: 'no_book',
      message: 'You hold no book.',
    });
  });

  it('answers an unreadable book as a tool error', async () => {
    const w = world();
    w.body.setBook(LIFE, { status: 'unreadable', title: '', author: '', text: '' });
    await expect(readBookTool({ body: w.body }, CALL)).rejects.toMatchObject({
      code: 'unreadable',
    });
  });
});

describe('the tools not yet in the world', () => {
  const tools: NotAvailableTool[] = [
    'write_book',
    'define_skill',
    'use_skill',
    'offer',
    'propose',
    'vote',
  ];

  for (const tool of tools) {
    it(`${tool} gives the fixed message and records one not_available call`, async () => {
      const w = world();
      const before = w.recorder.calls.length;
      await expect(
        notAvailableTool({ recorder: w.recorder, budget: w.budget, now: w.now }, CALL, tool),
      ).rejects.toMatchObject({ code: 'not_available', message: NOT_AVAILABLE_MESSAGE });
      expect(w.recorder.calls.length).toBe(before + 1);
      expect(w.recorder.calls.at(-1)).toMatchObject({
        tool,
        outcome: 'rejected',
        credits_charged: 0,
        rejected: [{ index: 0, reason: 'not_available' }],
      });
    });
  }
});
