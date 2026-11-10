import { createOutputValidator } from '@geldar/animus/src/validate/index.ts';
import { validateSovereignCallPayload } from '@geldar/contract';
import { FakeClock } from '@geldar/mcp-mock';
import { describe, expect, it } from 'vitest';
import {
  FakeBudgetLedger,
  FakePresenceStore,
  RecordingCallRecorder,
  ScriptedRateLimiter,
} from '../fakes/stores.fakes.ts';
import { FakeBody } from '../fakes/world.fakes.ts';
import { type ActDeps, ActToolError, actTool, type Caller, refusalsOf, slotsOf } from './act.ts';

const CALLER: Caller = { playerId: 'ag-jason-01', lifeId: 'ag_jason_01' };
const POS = { x: 1, y: 64, z: 1 };
const GOTO = { do: 'goto', target: POS };
const MINE = { do: 'mine', block: 'stone', count: 4 };
const INTENT = {
  goal: 'collect_wood',
  program: 'gather',
  arguments: { block: 'oak_log', count: 12 },
  wake_on: ['goal_completed'],
  limits: { max_world_ticks: 6000, max_block_operations: 100 },
};

interface Harness {
  deps: ActDeps;
  body: FakeBody;
  budget: FakeBudgetLedger;
  presence: FakePresenceStore;
  recorder: RecordingCallRecorder;
  clock: FakeClock;
}

/** A fresh world: a life holding `credits` credits, and a Body that answers. */
function harness(credits = 3, limiter = new ScriptedRateLimiter()): Harness {
  const clock = new FakeClock(1_000_000);
  const budget = new FakeBudgetLedger(0, 10);
  budget.seed(CALLER.lifeId, credits, clock.nowMs());
  const body = new FakeBody();
  const presence = new FakePresenceStore();
  const recorder = new RecordingCallRecorder();
  const deps: ActDeps = {
    body,
    budget,
    presence,
    limiter,
    recorder,
    validator: createOutputValidator(),
    clock,
    expiresAfterTicks: 200,
  };
  return { deps, body, budget, presence, recorder, clock };
}

/** A call with the schema's required `reasoning` filled in unless the test sets its own. */
const act = (h: Harness, input: Record<string, unknown>) =>
  actTool(h.deps, CALLER, { reasoning: 'ok', ...input });

describe('act: index mapping', () => {
  it('numbers say, then the actions in order, then the intent, and refuses only the bad action and its batch', async () => {
    const h = harness();
    const result = await act(h, {
      reasoning: 'wood first',
      say: 'Hello',
      actions: [GOTO, { do: 'fly', target: 'moon' }, MINE],
      intent: INTENT,
    });
    expect(result.accepted).toEqual([0, 4]);
    expect(result.rejected).toEqual([
      { index: 1, reason: 'batch_rejected' },
      { index: 2, reason: 'not_allowed' },
      { index: 3, reason: 'batch_rejected' },
    ]);
    expect(h.body.plans).toHaveLength(1);
    expect(result.budget_remaining_thoughts).toBe(1);
  });

  it('maps a bad say to index 0 and leaves the valid actions and intent standing', () => {
    const slots = slotsOf({ say: 'hi', actions: [GOTO, MINE], intent: INTENT });
    const refused = refusalsOf([{ code: 'not_allowed', path: '/say', detail: 'bad' }], slots);
    expect(refused).toEqual(['not_allowed', undefined, undefined, undefined]);
  });

  it('keeps the flat order: say, actions, intent, with no say and no intent when absent', () => {
    expect(slotsOf({ actions: [GOTO] }).map((s) => s.kind)).toEqual(['action']);
    expect(slotsOf({ say: null, actions: [] }).map((s) => s.kind)).toEqual([]);
  });
});

describe('act: atomic action list', () => {
  it('rejects every action when one is bad, and charges and dispatches nothing', async () => {
    const h = harness();
    const result = await act(h, { actions: [GOTO, { do: 'fly', target: 'moon' }] });
    expect(result.accepted).toEqual([]);
    expect(result.rejected).toEqual([
      { index: 0, reason: 'batch_rejected' },
      { index: 1, reason: 'not_allowed' },
    ]);
    expect(h.body.plans).toHaveLength(0);
    expect(await h.budget.balance(CALLER.lifeId, h.clock.nowMs())).toBe(3);
  });
});

describe('act: budget', () => {
  it('reserves all-or-nothing: a short balance rejects every item with budget_exhausted', async () => {
    const h = harness(1);
    const result = await act(h, { say: 'Hi', actions: [GOTO], intent: INTENT });
    expect(result.accepted).toEqual([]);
    expect(result.rejected.map((r) => r.reason)).toEqual([
      'budget_exhausted',
      'budget_exhausted',
      'budget_exhausted',
    ]);
    expect(h.body.plans).toHaveLength(0);
    expect(await h.budget.balance(CALLER.lifeId, h.clock.nowMs())).toBe(1);
  });

  it('never goes negative under concurrent acts', async () => {
    const h = harness(2);
    const results = await Promise.all([1, 2, 3].map(() => act(h, { actions: [GOTO] })));
    const accepted = results.filter((r) => r.accepted.length === 1).length;
    const exhausted = results.filter((r) => r.rejected[0]?.reason === 'budget_exhausted').length;
    expect(accepted).toBe(2);
    expect(exhausted).toBe(1);
    expect(h.body.plans).toHaveLength(2);
    expect(await h.budget.balance(CALLER.lifeId, h.clock.nowMs())).toBe(0);
  });
});

describe('act: refunds', () => {
  it('refunds the reserve when the Body refuses the plan for a reason other than staleness', async () => {
    const h = harness();
    h.body.rejectNextPlan(CALLER.lifeId, { reason: 'invalid_plan', detail: 'no' });
    const result = await act(h, { actions: [GOTO] });
    expect(result.accepted).toEqual([]);
    expect(result.rejected).toEqual([{ index: 0, reason: 'invalid_plan' }]);
    expect(await h.budget.balance(CALLER.lifeId, h.clock.nowMs())).toBe(3);
    expect(h.body.plans).toHaveLength(1);
    expect(h.recorder.calls[0]?.credits_charged).toBe(0);
  });

  it('refunds and reports body_unavailable, wants the Body up, and records an error call', async () => {
    const h = harness();
    h.body.setOffline(CALLER.lifeId, true);
    await expect(act(h, { actions: [GOTO] })).rejects.toMatchObject({
      code: 'body_unavailable',
    });
    await expect(act(h, { actions: [GOTO] })).rejects.toBeInstanceOf(ActToolError);
    expect(await h.budget.balance(CALLER.lifeId, h.clock.nowMs())).toBe(3);
    expect(h.presence.records.get(CALLER.lifeId)?.desired_body).toBe('up');
    expect(h.recorder.calls[0]?.outcome).toBe('error');
  });
});

describe('act: stale snapshot retry', () => {
  it('retries once with a fresh snapshot and sends the plan when the retry is accepted', async () => {
    const h = harness();
    h.body.rejectNextPlan(CALLER.lifeId, { reason: 'stale_snapshot', detail: 'old' });
    const result = await act(h, { actions: [GOTO] });
    expect(result.accepted).toEqual([0]);
    expect(h.body.plans).toHaveLength(2);
  });

  it('retries at most once: a second stale refusal is passed on and the reserve is refunded', async () => {
    const h = harness();
    h.body.rejectNextPlan(CALLER.lifeId, { reason: 'stale_snapshot', detail: 'old' });
    h.body.rejectNextPlan(CALLER.lifeId, { reason: 'stale_snapshot', detail: 'old' });
    const result = await act(h, { actions: [GOTO] });
    expect(h.body.plans).toHaveLength(2);
    expect(result.rejected).toEqual([{ index: 0, reason: 'stale_snapshot' }]);
    expect(await h.budget.balance(CALLER.lifeId, h.clock.nowMs())).toBe(3);
  });
});

describe('act: refusals and the record', () => {
  it('refuses an economic verb by the allow-list, before any charge', async () => {
    const h = harness();
    const result = await act(h, { actions: [{ do: 'trade', target: 'Adam' }] });
    expect(result.accepted).toEqual([]);
    expect(result.rejected).toEqual([{ index: 0, reason: 'not_allowed' }]);
    expect(h.body.plans).toHaveLength(0);
    expect(await h.budget.balance(CALLER.lifeId, h.clock.nowMs())).toBe(3);
  });

  it('writes a sovereign_call record that passes the contract schema and holds only the player words', async () => {
    const h = harness();
    await act(h, { reasoning: 'my plan', say: 'Hello', actions: [GOTO] });
    const call = h.recorder.calls[0];
    expect(call).toBeDefined();
    expect(validateSovereignCallPayload(call).ok).toBe(true);
    expect(call?.thought_id).toMatch(/^th_/);
    expect(call?.say).toBe('Hello');
  });

  it('is rate limited per life with a fixed message and no charge', async () => {
    const h = harness(3, new ScriptedRateLimiter([{ allowed: false, retryAfterMs: 500 }]));
    await expect(act(h, { actions: [GOTO] })).rejects.toMatchObject({ code: 'rate_limited' });
    expect(h.body.plans).toHaveLength(0);
    expect(await h.budget.balance(CALLER.lifeId, h.clock.nowMs())).toBe(3);
  });
});
