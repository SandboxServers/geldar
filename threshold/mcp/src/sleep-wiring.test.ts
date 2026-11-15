import { callTool, type ToolContext } from '@geldar/mcp-mock';
import type { SpeechIdentity } from '@geldar/player-core/src/attention/classify.ts';
import { eventOf } from '@geldar/player-core/src/link/link.fixtures.ts';
import { describe, expect, it } from 'vitest';
import { RingEventLog } from './events/player-log.ts';
import { handleStreamMessage, type StreamContext } from './events/stream.ts';
import { FakeJournalStore } from './fakes/stores.fakes.ts';
import { worldFixture } from './fakes/world.fakes.ts';
import type { PlayerRecord, SleepMark, SleepMarks } from './ports.ts';
import { createSleepWiring } from './sleep-wiring.ts';
import { createWorld } from './world.ts';

const PLAYER: PlayerRecord = {
  playerId: 'ag-ranger-01',
  lifeId: 'ag_ranger_01',
  ownerId: 'owner_01',
  displayName: 'Jason',
  harness: 'claude-code',
  status: 'active',
  declaredModel: null,
};
const LIFE = PLAYER.lifeId;

class CountingMarks implements SleepMarks {
  readonly writes: SleepMark[] = [];

  async read(): Promise<SleepMark> {
    return { lastSleepDay: 0, cursor: 0 };
  }

  async write(_lifeId: string, mark: SleepMark): Promise<void> {
    this.writes.push(mark);
  }
}

// Ids in the contract's shape (the contract's own plan_result fixture uses the same form).
const ACTION_IDS = ['ac_01HZX3V9Q4M2K8R7T6Y5W4E3D7', 'ac_01HZX3V9Q4M2K8R7T6Y5W4E3D8'];

/** A plan_result for a thought whose first `count` actions all completed. */
function completedResult(thoughtId: string, count: number) {
  const actions = ACTION_IDS.slice(0, count).map((action_id) => ({
    action_id,
    state: 'completed',
  }));
  const payload = {
    thought_id: thoughtId,
    intent: 'started',
    failed_at: null,
    actions,
    said: true,
  };
  return { ...eventOf('plan_result', 1, LIFE), payload };
}

describe('sleep wiring: the world and the stream share one set of pending sleeps', () => {
  it('an accepted sleep, then its completed plan_result, writes one mark and one journal line', async () => {
    const fx = worldFixture([PLAYER]);
    fx.budget.seed(LIFE, 37, 0);
    const marks = new CountingMarks();
    const journal = new FakeJournalStore();
    const wiring = createSleepWiring({ marks, journal, now: () => 0, log: () => {} });
    const tools = createWorld({ ...fx.deps, ...wiring.worldDeps }).tools;
    // The sleep digests at least one event, so its journal line is written when it completes.
    await fx.body.emit(LIFE, { seq: 1, atMs: 1000, tick: 20, kind: 'damage' } as never);

    const ctx: ToolContext = { playerId: PLAYER.playerId, signal: new AbortController().signal };
    const sleep = await callTool(tools, 'sleep', {}, ctx);
    expect(sleep.isError).not.toBe(true);
    const thoughtId = fx.body.plans.at(-1)?.plan.thought_id ?? '';
    const entry = wiring.pending.get(LIFE, thoughtId);
    expect(entry).toBeDefined();
    expect(marks.writes).toEqual([]);
    expect(await journal.recent(LIFE, 50)).toEqual([]);

    const streamCtx: StreamContext = {
      map: { identity: {} as SpeechIdentity, runs: new Map() },
      log: new RingEventLog(),
      lives: () => [LIFE],
      sleep: wiring.stream,
    };
    const actionCount = (entry?.action ?? 0) + 1;
    await handleStreamMessage(1, completedResult(thoughtId, actionCount), streamCtx, {
      invalid: 0,
    });

    expect(marks.writes).toHaveLength(1);
    expect(await journal.recent(LIFE, 50)).toHaveLength(1);
    expect(wiring.pending.get(LIFE, thoughtId)).toBeUndefined();
  });
});

const GOTO = { do: 'goto', target: { x: 1, y: 64, z: 1 } };
const SLEEP = { do: 'sleep' };

describe('sleep wiring: an act sleep', () => {
  it('an act with a goto then a sleep registers the sleep at index 1, and its completed plan_result writes one mark and the journal line', async () => {
    const fx = worldFixture([PLAYER]);
    fx.budget.seed(LIFE, 37, 0);
    const marks = new CountingMarks();
    const journal = new FakeJournalStore();
    const wiring = createSleepWiring({ marks, journal, now: () => 0, log: () => {} });
    const tools = createWorld({ ...fx.deps, ...wiring.worldDeps }).tools;
    const ctx: ToolContext = { playerId: PLAYER.playerId, signal: new AbortController().signal };

    const act = await callTool(tools, 'act', { reasoning: 'ok', actions: [GOTO, SLEEP] }, ctx);
    expect(act.isError).not.toBe(true);
    const thoughtId = fx.body.plans.at(-1)?.plan.thought_id ?? '';
    expect(wiring.pending.get(LIFE, thoughtId)?.action).toBe(1);
    expect(marks.writes).toEqual([]);

    const streamCtx: StreamContext = {
      map: { identity: {} as SpeechIdentity, runs: new Map() },
      log: new RingEventLog(),
      lives: () => [LIFE],
      sleep: wiring.stream,
    };
    await handleStreamMessage(1, completedResult(thoughtId, 2), streamCtx, { invalid: 0 });
    expect(marks.writes).toHaveLength(1);
    const lines = (await journal.recent(LIFE, 50)).map((line) => line.text);
    expect(lines).toEqual([expect.stringMatching(/^Day \d+: asleep\.$/)]);
    expect(wiring.pending.get(LIFE, thoughtId)).toBeUndefined();
  });

  it('an act whose entry read fails is still accepted, registers nothing, and logs one line', async () => {
    const fx = worldFixture([PLAYER]);
    fx.budget.seed(LIFE, 37, 0);
    const failing: SleepMarks = {
      read: async () => {
        throw new Error('marks down: secret detail');
      },
      write: async () => {},
    };
    const logged: Record<string, unknown>[] = [];
    const log = (line: Record<string, unknown>) => {
      logged.push(line);
    };
    const wiring = createSleepWiring({
      marks: failing,
      journal: new FakeJournalStore(),
      now: () => 0,
      log,
    });
    const tools = createWorld({ ...fx.deps, ...wiring.worldDeps, sleeps: failing, log }).tools;
    const ctx: ToolContext = { playerId: PLAYER.playerId, signal: new AbortController().signal };

    const act = await callTool(tools, 'act', { reasoning: 'ok', actions: [GOTO, SLEEP] }, ctx);
    expect(act.isError).not.toBe(true);
    expect(fx.body.plans).toHaveLength(1);
    const thoughtId = fx.body.plans[0]?.plan.thought_id ?? '';
    expect(wiring.pending.get(LIFE, thoughtId)).toBeUndefined();
    const registerErrors = logged.filter((line) => line.event === 'sleep_register_error');
    expect(registerErrors).toEqual([{ event: 'sleep_register_error', kind: 'Error' }]);
    expect(JSON.stringify(logged)).not.toContain('secret detail');
  });
});
