import type { PlanProgressPayload } from '@geldar/contract';
import { describe, expect, it } from 'vitest';
import { activePlanView } from '../play-view/active-plan.ts';
import type { ToolCall } from './look.ts';
import type { StatusDeps } from './status.ts';
import { statusTool } from './status.ts';

const LIFE = 'ag_jason_01';

const PLAN: PlanProgressPayload = {
  plan_id: 'shelter_1',
  total: 540,
  done: 312,
  placed: 300,
  broken: 12,
  skipped_by_code: { changed: 3 },
  phase: 'running',
  next_need: { block: 'oak_planks', count: 4 },
} as PlanProgressPayload;

/** The status deps with fixed answers; only the plan source varies between the tests. */
function deps(activePlan?: StatusDeps['activePlan']): StatusDeps {
  return {
    body: { snapshot: async () => ({ world_time: { day: 3 } }) },
    budget: { balance: async () => 10 },
    sleeps: { read: async () => ({ lastSleepDay: 2 }) },
    deaths: { read: async () => ({ deaths: 0, lastDeathDay: null }) },
    profiles: { profile: async () => ({ born_day: 1 }) },
    laws: [],
    now: () => 0,
    meter: { totalsOf: () => ({ spent: 0, calls: 0, good: 0, bad: 0, impossible: 0 }) },
    activePlan,
  } as unknown as StatusDeps;
}

const CALL = { lifeId: LIFE } as unknown as ToolCall;

describe('status active_plan block (BLD-23)', () => {
  it('shows the plan counts as the Body reported them, 312 of 540 done', async () => {
    const result = await statusTool(
      deps(() => PLAN),
      CALL,
    );
    expect(result.active_plan?.done).toBe(312);
    expect(result.active_plan?.total).toBe(540);
    expect(result.active_plan).toEqual(PLAN);
  });

  it('asks the plan source for the status call life', async () => {
    const seen: string[] = [];
    await statusTool(
      deps((lifeId) => {
        seen.push(lifeId);
        return PLAN;
      }),
      CALL,
    );
    expect(seen).toEqual([LIFE]);
  });

  it('leaves the active_plan key out when no plan runs, so the status is unchanged', async () => {
    const none = await statusTool(
      deps(() => null),
      CALL,
    );
    const absent = await statusTool(deps(undefined), CALL);
    expect('active_plan' in none).toBe(false);
    expect('active_plan' in absent).toBe(false);
  });

  it('copies only the contract fields of the plan, never an extra one', () => {
    const extra = { ...PLAN, unseen: [{ x: 1, y: 2, z: 3 }] } as unknown as PlanProgressPayload;
    const view = activePlanView(extra) as unknown as Record<string, unknown>;
    expect('unseen' in view).toBe(false);
    expect(view.skipped_by_code).toEqual({ changed: 3 });
  });

  it('is null for a missing or null plan', () => {
    expect(activePlanView()).toBeNull();
    expect(activePlanView(null)).toBeNull();
  });
});
