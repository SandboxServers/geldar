import type { PlanResultPayload } from '@geldar/contract';
import { FakeClock } from '@geldar/mcp-mock';
import { createOutputValidator } from '@geldar/player-core/src/validate/index.ts';
import { describe, expect, it } from 'vitest';
import {
  FakeBudgetLedger,
  FakeJournalStore,
  FakePresenceStore,
  RecordingCallRecorder,
  ScriptedRateLimiter,
} from '../fakes/stores.fakes.ts';
import { FakeBody } from '../fakes/world.fakes.ts';
import type { SleepMark } from '../ports.ts';
import { type ActDeps, actTool, type Caller } from './act.ts';
import { completeSleep, PendingSleeps, type SleepCompletionDeps } from './sleep-completion.ts';

const CALLER: Caller = { playerId: 'ag-jason-01', lifeId: 'ag_jason_01' };
const GOTO = { do: 'goto', target: { x: 1, y: 64, z: 1 } };
const SLEEP = { do: 'sleep' };
const ENTRY_SECRET = 'registration failed with secret detail';

/** A life with three credits, a Body that answers, and every sleep registration recorded. */
function harness(entryFails = false) {
  const clock = new FakeClock(1_000_000);
  const budget = new FakeBudgetLedger(0, 10);
  budget.seed(CALLER.lifeId, 3, clock.nowMs());
  const logged: Record<string, unknown>[] = [];
  // `registered` mirrors the pending entries: an add is recorded, a drop (refusal) removes it.
  const registered: Array<[string, string, number]> = [];
  const pending = new PendingSleeps();
  const add = pending.add.bind(pending);
  const drop = pending.delete.bind(pending);
  pending.add = (lifeId, thoughtId, sleep) => {
    add(lifeId, thoughtId, sleep);
    registered.push([lifeId, thoughtId, sleep.action]);
  };
  pending.delete = (lifeId, thoughtId) => {
    drop(lifeId, thoughtId);
    const at = registered.findIndex((r) => r[0] === lifeId && r[1] === thoughtId);
    if (at >= 0) registered.splice(at, 1);
  };
  const deps: ActDeps = {
    body: new FakeBody(),
    budget,
    presence: new FakePresenceStore(),
    limiter: new ScriptedRateLimiter(),
    enforce: true,
    recorder: new RecordingCallRecorder(),
    validator: createOutputValidator(),
    clock,
    expiresAfterTicks: 200,
    log: (line) => logged.push(line),
    sleep: {
      pending,
      entry: async (_lifeId, snapshot) => {
        // The server wiring logs a failed read and returns undefined: the plan is then sent unregistered.
        try {
          if (entryFails) throw new Error(ENTRY_SECRET);
          return {
            day: snapshot.world_time.day,
            cursor: 0,
            journal: `Day ${snapshot.world_time.day}: asleep.`,
          };
        } catch (err) {
          logged.push({
            event: 'sleep_register_error',
            kind: err instanceof Error ? err.name : 'unknown',
          });
          return undefined;
        }
      },
    },
  };
  return { deps, budget, clock, logged, registered, pending };
}

const run = (h: ReturnType<typeof harness>, actions: unknown[]) =>
  actTool(h.deps, CALLER, { reasoning: 'ok', actions } as never);

/** A completed plan_result for a two-action thought: the goto, then the sleep. */
function completedOutcome(thoughtId: string) {
  const actions = [
    { action_id: 'ac_1', state: 'completed' },
    { action_id: 'ac_2', state: 'completed' },
  ];
  return {
    thought_id: thoughtId,
    intent: 'started',
    failed_at: null,
    actions,
  } as unknown as PlanResultPayload;
}

describe('act: registering an accepted sleep', () => {
  it('registers a sleep at its index in the plan, when it is not the first action', async () => {
    const h = harness();
    const result = await run(h, [GOTO, SLEEP]);
    expect(result.accepted).toEqual([0, 1]);
    expect(h.registered).toHaveLength(1);
    expect(h.registered[0]?.[0]).toBe(CALLER.lifeId);
    expect(h.registered[0]?.[1]).toMatch(/^th/);
    expect(h.registered[0]?.[2]).toBe(1);
  });

  it('registers nothing for a plan with no sleep', async () => {
    const h = harness();
    await run(h, [GOTO]);
    expect(h.registered).toEqual([]);
  });

  it('a throwing registration leaves the plan accepted and the credits spent, and logs one line', async () => {
    const h = harness(true);
    // A refund of an accepted plan would be a second, wrong, charge back: the spy must see none.
    const refunds: number[] = [];
    const refund = h.budget.refund.bind(h.budget);
    h.budget.refund = async (lifeId, credits) => {
      refunds.push(credits);
      return refund(lifeId, credits);
    };
    const result = await run(h, [GOTO, SLEEP]);
    expect(result.accepted).toEqual([0, 1]);
    expect(result.rejected).toEqual([]);
    expect(refunds).toEqual([]);
    expect(h.registered).toEqual([]);
    expect(h.logged).toEqual([{ event: 'sleep_register_error', kind: 'Error' }]);
    expect(JSON.stringify(h.logged)).not.toContain(ENTRY_SECRET);
  });
});

describe('act: a refused sleep plan', () => {
  it('registers nothing, so no pending entry waits for an outcome', async () => {
    const h = harness();
    (h.deps.body as FakeBody).rejectNextPlan(CALLER.lifeId, {
      reason: 'invalid_plan',
      detail: 'no',
    });
    await run(h, [GOTO, SLEEP]);
    expect(h.registered).toEqual([]);
  });
});

describe('act: the race with the outcome', () => {
  it('a plan_result delivered during the submit settles the act sleep', async () => {
    const h = harness();
    const body = h.deps.body as FakeBody;
    const marks: SleepMark[] = [];
    const journal = new FakeJournalStore();
    const settle: SleepCompletionDeps = {
      pending: h.pending,
      marks: {
        read: async () => ({ lastSleepDay: 0, cursor: 0 }),
        write: async (_lifeId, mark) => {
          marks.push(mark);
        },
      },
      journal,
      now: () => 0,
      log: (line) => h.logged.push(line),
    };
    const submit = body.submitPlan.bind(body);
    body.submitPlan = async (lifeId, plan) => {
      await completeSleep(settle, lifeId, completedOutcome(plan.thought_id));
      return submit(lifeId, plan);
    };
    const result = await run(h, [GOTO, SLEEP]);
    expect(result.accepted).toEqual([0, 1]);
    expect(marks).toHaveLength(1);
    expect(await journal.recent(CALLER.lifeId, 50)).toHaveLength(1);
    expect(h.registered).toEqual([]);
  });
});
