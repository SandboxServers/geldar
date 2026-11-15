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

const CALLER: Caller = { playerId: 'ag-jason-01', lifeId: 'ag_jason_01' };
const GOTO = { do: 'goto', target: { x: 1, y: 64, z: 1 } };
const SLEEP = { do: 'sleep' };

/** A life with three credits, a Body that answers, and every sleep registration recorded. */
function harness(sleepAccepted?: ActDeps['sleepAccepted']) {
  const clock = new FakeClock(1_000_000);
  const budget = new FakeBudgetLedger(0, 10);
  budget.seed(CALLER.lifeId, 3, clock.nowMs());
  const logged: Record<string, unknown>[] = [];
  const registered: Array<[string, string, number]> = [];
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
    sleepAccepted:
      sleepAccepted ??
      (async (lifeId, thoughtId, action) => {
        registered.push([lifeId, thoughtId, action]);
      }),
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

  it('a throwing registration leaves the plan accepted, the credits spent, and logs one line', async () => {
    const secret = 'registration failed with secret detail';
    const failing = harness(async () => {
      throw new Error(secret);
    });
    const healthy = harness();
    const failed = await run(failing, [GOTO, SLEEP]);
    const ok = await run(healthy, [GOTO, SLEEP]);
    expect(failed.accepted).toEqual([0, 1]);
    expect(failed.rejected).toEqual([]);
    expect(failed.budget_remaining_thoughts).toBe(ok.budget_remaining_thoughts);
    expect(failing.logged).toEqual([{ event: 'sleep_register_error', kind: 'Error' }]);
    expect(JSON.stringify(failing.logged)).not.toContain('secret');
  });
});
