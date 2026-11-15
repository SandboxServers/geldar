import { FakeClock } from '@geldar/mcp-mock';
import { createOutputValidator } from '@geldar/player-core/src/validate/index.ts';
import { describe, expect, it } from 'vitest';
import {
  FakeBudgetLedger,
  FakePresenceStore,
  RecordingCallRecorder,
  ScriptedRateLimiter,
} from '../fakes/stores.fakes.ts';
import { FakeBody } from '../fakes/world.fakes.ts';
import { type ActDeps, actTool, type Caller } from './act.ts';
import { PendingSleeps } from './sleep-completion.ts';

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
  return { deps, budget, clock, logged, registered };
}

const run = (h: ReturnType<typeof harness>, actions: unknown[]) =>
  actTool(h.deps, CALLER, { reasoning: 'ok', actions } as never);

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
