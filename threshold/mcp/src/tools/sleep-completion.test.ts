import type { PlanMessage, PlanResultPayload } from '@geldar/contract';
import { describe, expect, it } from 'vitest';
import { FakeJournalStore, FakePlayerEventLog } from '../fakes/stores.fakes.ts';
import { FakeBody } from '../fakes/world.fakes.ts';
import type { SleepMark, SleepMarks } from '../ports.ts';
import type { ToolCall } from './look.ts';
import { type SleepDeps, sleepTool } from './sleep.ts';
import {
  completeSleep,
  PENDING_SLEEP_LIMIT,
  PendingSleeps,
  type SleepCompletionDeps,
} from './sleep-completion.ts';

const LIFE = 'ag_ranger_01';
const CALL: ToolCall = { playerId: 'ag-ranger-01', lifeId: LIFE };
const BIRTH_DAY = 1;
const JOURNAL_LINE = 'Day 1: asleep. 1 events since the last sleep, 0 lost before them.';

type State = 'accepted' | 'running' | 'completed' | 'failed' | 'cancelled';

/** Marks in memory, counting the writes; `failNext` makes the next write throw a store error. */
class CountingMarks implements SleepMarks {
  readonly writes: SleepMark[] = [];
  failNext = false;
  private current: SleepMark = { lastSleepDay: BIRTH_DAY, cursor: 0 };

  async read(): Promise<SleepMark> {
    return this.current;
  }

  async write(_lifeId: string, mark: SleepMark): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('connection lost: secret detail');
    }
    this.writes.push(mark);
    this.current = mark;
  }
}

function world() {
  const log = new FakePlayerEventLog();
  return {
    log,
    body: new FakeBody(log),
    journal: new FakeJournalStore(),
    marks: new CountingMarks(),
    now: () => 0,
    logged: [] as Record<string, unknown>[],
  };
}

type World = ReturnType<typeof world>;

/** The plan_result of a thought whose actions end in the given states. */
function outcome(thoughtId: string, states: State[], failedAt: number | null = null) {
  return {
    thought_id: thoughtId,
    intent: 'started',
    failed_at: failedAt,
    actions: states.map((state, i) => ({ action_id: `ac_${i}`, state })),
  } as unknown as PlanResultPayload;
}

/** Sleep deps whose plans are numbered th_1, th_2, ... in the order they are built. */
function sleepDeps(w: World, pending: PendingSleeps): SleepDeps {
  let seq = 0;
  return {
    body: w.body,
    events: w.log,
    journal: w.journal,
    marks: w.marks,
    now: w.now,
    pending,
    buildSleepPlan: () => ({ thought_id: `th_${++seq}` }) as unknown as PlanMessage,
  };
}

function settleDeps(w: World, pending: PendingSleeps): SleepCompletionDeps {
  return {
    pending,
    marks: w.marks,
    journal: w.journal,
    now: w.now,
    log: (line) => w.logged.push(line),
  };
}

async function journalTexts(w: World): Promise<string[]> {
  return (await w.journal.recent(LIFE, 50)).map((line) => line.text);
}

describe('sleep completion', () => {
  it('accepting a sleep writes neither the mark nor the journal', async () => {
    const w = world();
    const pending = new PendingSleeps();
    await w.body.emit(LIFE, { seq: 1, atMs: 1000, tick: 20, kind: 'damage' } as never);
    await sleepTool(sleepDeps(w, pending), CALL);
    expect(w.marks.writes).toEqual([]);
    expect(await journalTexts(w)).toEqual([]);
    expect(pending.get(LIFE, 'th_1')).toBeDefined();
  });

  it('a completed sleep writes the mark and exactly one journal line, once', async () => {
    const w = world();
    const pending = new PendingSleeps();
    await w.body.emit(LIFE, { seq: 1, atMs: 1000, tick: 20, kind: 'damage' } as never);
    await sleepTool(sleepDeps(w, pending), CALL);
    await completeSleep(settleDeps(w, pending), LIFE, outcome('th_1', ['completed']));
    expect(w.marks.writes).toEqual([{ lastSleepDay: 1, cursor: 1 }]);
    expect(await journalTexts(w)).toEqual([JOURNAL_LINE]);
    expect(pending.get(LIFE, 'th_1')).toBeUndefined();
    // A duplicate plan_result finds no entry and writes nothing more.
    await completeSleep(settleDeps(w, pending), LIFE, outcome('th_1', ['completed']));
    expect(w.marks.writes).toHaveLength(1);
    expect(await journalTexts(w)).toHaveLength(1);
  });

  it('failed, cancelled and unknown outcomes write nothing and drop the entry', async () => {
    const pending = new PendingSleeps();
    const failed = world();
    pending.add(LIFE, 'th_f', { day: 1, cursor: 1, action: 0, journal: JOURNAL_LINE });
    await completeSleep(settleDeps(failed, pending), LIFE, outcome('th_f', ['failed'], 0));
    expect(pending.get(LIFE, 'th_f')).toBeUndefined();

    const cancelled = world();
    pending.add(LIFE, 'th_c', { day: 1, cursor: 1, action: 0, journal: JOURNAL_LINE });
    await completeSleep(settleDeps(cancelled, pending), LIFE, outcome('th_c', ['cancelled']));
    expect(pending.get(LIFE, 'th_c')).toBeUndefined();

    const unknown = world();
    pending.add(LIFE, 'th_u', { day: 1, cursor: 1, action: 0, journal: JOURNAL_LINE });
    await completeSleep(settleDeps(unknown, pending), LIFE, outcome('th_other', ['completed']));
    expect(pending.get(LIFE, 'th_u')).toBeDefined();

    for (const w of [failed, cancelled, unknown]) {
      expect(w.marks.writes).toEqual([]);
      expect(await journalTexts(w)).toEqual([]);
    }
  });

  it('a completed sleep cut short by an earlier failure writes nothing', async () => {
    const w = world();
    const pending = new PendingSleeps();
    pending.add(LIFE, 'th_x', { day: 1, cursor: 1, action: 1, journal: JOURNAL_LINE });
    await completeSleep(settleDeps(w, pending), LIFE, outcome('th_x', ['failed', 'completed'], 0));
    expect(w.marks.writes).toEqual([]);
    expect(await journalTexts(w)).toEqual([]);
  });

  it('keeps the entry while its sleep action is still running, and settles on the final state', async () => {
    const w = world();
    const pending = new PendingSleeps();
    pending.add(LIFE, 'th_r', { day: 1, cursor: 1, action: 0, journal: JOURNAL_LINE });
    await completeSleep(settleDeps(w, pending), LIFE, outcome('th_r', ['running']));
    expect(pending.get(LIFE, 'th_r')).toBeDefined();
    expect(w.marks.writes).toEqual([]);
    await completeSleep(settleDeps(w, pending), LIFE, outcome('th_r', ['completed']));
    expect(w.marks.writes).toHaveLength(1);
  });

  it('a blocked sleep then a completed one gives one mark write and one journal line, at the completion', async () => {
    const w = world();
    const pending = new PendingSleeps();
    const deps = sleepDeps(w, pending);
    await w.body.emit(LIFE, { seq: 1, atMs: 1000, tick: 20, kind: 'damage' } as never);
    await sleepTool(deps, CALL);
    await completeSleep(settleDeps(w, pending), LIFE, outcome('th_1', ['failed'], 0));
    expect(w.marks.writes).toEqual([]);
    expect(await journalTexts(w)).toEqual([]);
    await sleepTool(deps, CALL);
    await completeSleep(settleDeps(w, pending), LIFE, outcome('th_2', ['completed']));
    expect(w.marks.writes).toEqual([{ lastSleepDay: 1, cursor: 1 }]);
    expect(await journalTexts(w)).toEqual([JOURNAL_LINE]);
  });

  it('a restart drops the pending sleeps, so an outcome after it writes nothing', async () => {
    const w = world();
    await w.body.emit(LIFE, { seq: 1, atMs: 1000, tick: 20, kind: 'damage' } as never);
    await sleepTool(sleepDeps(w, new PendingSleeps()), CALL);
    const afterRestart = new PendingSleeps();
    await completeSleep(settleDeps(w, afterRestart), LIFE, outcome('th_1', ['completed']));
    expect(w.marks.writes).toEqual([]);
    expect(await journalTexts(w)).toEqual([]);
  });

  it('a settle write that fails keeps the entry, logs one payload-free line, and a retry settles it', async () => {
    const w = world();
    const pending = new PendingSleeps();
    await w.body.emit(LIFE, { seq: 1, atMs: 1000, tick: 20, kind: 'damage' } as never);
    await sleepTool(sleepDeps(w, pending), CALL);
    w.marks.failNext = true;
    await expect(
      completeSleep(settleDeps(w, pending), LIFE, outcome('th_1', ['completed'])),
    ).resolves.toBeUndefined();
    expect(w.logged).toEqual([{ event: 'sleep_settle_error', kind: 'Error' }]);
    expect(JSON.stringify(w.logged)).not.toContain('secret');
    expect(pending.get(LIFE, 'th_1')).toBeDefined();
    expect(w.marks.writes).toEqual([]);
    await completeSleep(settleDeps(w, pending), LIFE, outcome('th_1', ['completed']));
    expect(w.marks.writes).toEqual([{ lastSleepDay: 1, cursor: 1 }]);
    expect(await journalTexts(w)).toEqual([JOURNAL_LINE]);
    expect(pending.get(LIFE, 'th_1')).toBeUndefined();
  });

  it('caps the pending sleeps per life and evicts the oldest', () => {
    const pending = new PendingSleeps();
    const sleep = { day: 1, cursor: 0, action: 0, journal: null };
    for (let i = 0; i <= PENDING_SLEEP_LIMIT; i++) pending.add(LIFE, `th_${i}`, sleep);
    expect(pending.get(LIFE, 'th_0')).toBeUndefined();
    expect(pending.get(LIFE, 'th_1')).toBeDefined();
    expect(pending.get(LIFE, `th_${PENDING_SLEEP_LIMIT}`)).toBeDefined();
    const held = Array.from({ length: PENDING_SLEEP_LIMIT + 1 }, (_, i) =>
      pending.get(LIFE, `th_${i}`),
    ).filter((s) => s !== undefined);
    expect(held).toHaveLength(PENDING_SLEEP_LIMIT);
    pending.add('ag_other_01', 'th_0', sleep);
    expect(pending.get('ag_other_01', 'th_0')).toBeDefined();
  });
});
