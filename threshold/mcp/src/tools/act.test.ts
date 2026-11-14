import { markedWords, validateSovereignCallPayload } from '@geldar/contract';
import { FakeClock } from '@geldar/mcp-mock';
import { createOutputValidator } from '@geldar/player-core/src/validate/index.ts';
import { describe, expect, it } from 'vitest';
import { batchCost } from '../budget/cost.ts';
import { ActMeter } from '../budget/meter.ts';
import {
  FakeBudgetLedger,
  FakePresenceStore,
  RecordingCallRecorder,
  ScriptedRateLimiter,
} from '../fakes/stores.fakes.ts';
import { FakeBody } from '../fakes/world.fakes.ts';
import {
  ACT_QUEUED_NOTE,
  type ActDeps,
  ActToolError,
  actTool,
  type Caller,
  refusalsOf,
  slotsOf,
} from './act.ts';

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
    enforce: true,
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
      { index: 1, reason: 'batch_rejected', detail: expect.any(String) },
      { index: 2, reason: 'not_allowed', detail: 'action 1.do: is not available in this phase' },
      { index: 3, reason: 'batch_rejected', detail: expect.any(String) },
    ]);
    expect(h.body.plans).toHaveLength(1);
    expect(result.budget_remaining_thoughts).toBe(1);
  });

  it('maps a bad say to index 0 and leaves the valid actions and intent standing', () => {
    const slots = slotsOf({ say: 'hi', actions: [GOTO, MINE], intent: INTENT });
    const refused = refusalsOf([{ code: 'not_allowed', path: '/say', detail: 'bad' }], slots);
    expect(refused.map((r) => r?.reason)).toEqual(['not_allowed', undefined, undefined, undefined]);
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
      { index: 0, reason: 'batch_rejected', detail: expect.any(String) },
      { index: 1, reason: 'not_allowed', detail: 'action 1.do: is not available in this phase' },
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

describe('act: the budget is metered, not charged, when not enforced', () => {
  it('sends an act of an agent at 0 credits to the Body and meters it, with enforcement off', async () => {
    const h = harness(0);
    h.deps.enforce = false;
    h.deps.meter = new ActMeter();
    const result = await act(h, { actions: [GOTO] });
    expect(result.accepted).toEqual([0]);
    expect(result.rejected).toEqual([]);
    expect(h.body.plans).toHaveLength(1);
    expect(await h.budget.balance(CALLER.lifeId, h.clock.nowMs())).toBe(0);
    const call = h.recorder.calls[0];
    expect(call?.outcome_class).toBe('good');
    expect(call?.would_cost).toBe(batchCost(['action']));
    expect(call?.spent_this_life).toBe(batchCost(['action']));
    expect(h.deps.meter?.totalsOf(CALLER.lifeId)).toMatchObject({
      calls: 1,
      good: 1,
      spent: batchCost(['action']),
    });
  });

  it('refuses an act of an agent at 0 credits when enforced, and meters it as impossible', async () => {
    const h = harness(0);
    h.deps.meter = new ActMeter();
    const result = await act(h, { actions: [GOTO] });
    expect(result.accepted).toEqual([]);
    expect(result.rejected).toEqual([{ index: 0, reason: 'budget_exhausted' }]);
    expect(h.body.plans).toHaveLength(0);
    const call = h.recorder.calls[0];
    expect(call?.outcome_class).toBe('impossible');
    expect(call?.spent_this_life).toBe(0);
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

describe('act: a presence fault keeps the refusal', () => {
  it('still refuses body_unavailable when wantBody throws, and logs the cause', async () => {
    const h = harness();
    const logged: Record<string, unknown>[] = [];
    h.deps.log = (line) => logged.push(line);
    h.presence.wantBody = async () => {
      throw new Error('kv down');
    };
    h.body.setOffline(CALLER.lifeId, true);
    await expect(act(h, { actions: [GOTO] })).rejects.toBeInstanceOf(ActToolError);
    expect(await h.budget.balance(CALLER.lifeId, h.clock.nowMs())).toBe(3);
    expect(logged).toEqual([{ event: 'presence_error', cause: 'Error: kv down' }]);
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
    expect(result.rejected).toEqual([
      { index: 0, reason: 'not_allowed', detail: 'action 0.do: is not available in this phase' },
    ]);
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

describe('act: partial batches', () => {
  const LONG_SAY = 'x'.repeat(300);
  const BAD_INTENT = { goal: 'collect_wood' };

  it('sends the valid actions when the say is too long, and charges only for what is sent', async () => {
    const h = harness();
    const result = await act(h, { say: LONG_SAY, actions: [GOTO, MINE] });
    expect(result.accepted).toEqual([1, 2]);
    expect(result.rejected).toEqual([
      { index: 0, reason: 'schema', detail: expect.stringMatching(/^say: /) },
    ]);
    expect(h.body.plans).toHaveLength(1);
    expect(h.body.plans[0]?.plan.thought.actions).toHaveLength(2);
    expect(result.budget_remaining_thoughts).toBe(3 - batchCost(['action', 'action']));
    expect(h.recorder.calls[0]?.credits_charged).toBe(2);
  });

  it('sends the valid actions when the intent is bad, and charges only for what is sent', async () => {
    const h = harness();
    const result = await act(h, { actions: [GOTO, MINE], intent: BAD_INTENT });
    expect(result.accepted).toEqual([0, 1]);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.index).toBe(2);
    expect(h.body.plans).toHaveLength(1);
    expect(await h.budget.balance(CALLER.lifeId, h.clock.nowMs())).toBe(
      3 - batchCost(['action', 'action']),
    );
  });

  it('sends nothing and charges nothing when the say and the intent are both bad', async () => {
    const h = harness();
    const result = await act(h, { say: LONG_SAY, intent: BAD_INTENT });
    expect(result.accepted).toEqual([]);
    expect(result.rejected.map((r) => r.index)).toEqual([0, 1]);
    expect(result.rejected[0]?.reason).toBe('schema');
    expect(result.rejected[1]?.reason).toBeTypeOf('string');
    expect(h.body.plans).toHaveLength(0);
    expect(await h.budget.balance(CALLER.lifeId, h.clock.nowMs())).toBe(3);
  });

  it('sends nothing when the say is bad and one action is bad, with the valid action refused as a batch', async () => {
    const h = harness();
    const result = await act(h, {
      say: LONG_SAY,
      actions: [GOTO, { do: 'fly', target: 'moon' }],
    });
    expect(result.accepted).toEqual([]);
    expect(result.rejected).toEqual([
      { index: 0, reason: 'schema', detail: expect.stringMatching(/^say: /) },
      { index: 1, reason: 'batch_rejected', detail: expect.any(String) },
      { index: 2, reason: 'not_allowed', detail: 'action 1.do: is not available in this phase' },
    ]);
    expect(h.body.plans).toHaveLength(0);
    expect(await h.budget.balance(CALLER.lifeId, h.clock.nowMs())).toBe(3);
  });

  it('leaves an all-good thought unchanged: every item accepted and charged once', async () => {
    const h = harness();
    const result = await act(h, { say: 'Hi', actions: [GOTO], intent: INTENT });
    expect(result.accepted).toEqual([0, 1, 2]);
    expect(result.rejected).toEqual([]);
    expect(h.body.plans).toHaveLength(1);
    expect(h.body.plans[0]?.plan.thought.actions).toHaveLength(1);
    expect(await h.budget.balance(CALLER.lifeId, h.clock.nowMs())).toBe(
      3 - batchCost(['say', 'action', 'intent']),
    );
  });

  it('says in the result that accepted actions are queued, and says nothing when none is accepted', async () => {
    const h = harness();
    const queued = await act(h, { actions: [GOTO] });
    expect(queued.note).toBe(ACT_QUEUED_NOTE);
    expect(ACT_QUEUED_NOTE).toBe(
      'These actions are queued. Their results arrive in your next wait.',
    );
    const refused = await act(h, { actions: [{ do: 'teleport' }] });
    expect(refused.note).toBeUndefined();
  });
});

describe('act: refunds after the reserve', () => {
  it('refunds the reserve when a non-Body error is thrown after it, and passes the error on', async () => {
    const h = harness();
    h.body.submitPlan = async () => {
      throw new Error('boom');
    };
    await expect(act(h, { actions: [GOTO, MINE] })).rejects.toThrow('boom');
    expect(await h.budget.balance(CALLER.lifeId, h.clock.nowMs())).toBe(3);
    expect(h.recorder.calls).toHaveLength(0);
  });
});

describe('act: Body reasons as public codes', () => {
  it('reports a wrong_life refusal as invalid_plan', async () => {
    const h = harness();
    h.body.rejectNextPlan(CALLER.lifeId, { reason: 'wrong_life', detail: 'life' });
    const result = await act(h, { actions: [GOTO] });
    expect(result.rejected).toEqual([{ index: 0, reason: 'invalid_plan' }]);
    expect(await h.budget.balance(CALLER.lifeId, h.clock.nowMs())).toBe(3);
  });

  it('reports a stale_generation refusal as stale_snapshot', async () => {
    const h = harness();
    h.body.rejectNextPlan(CALLER.lifeId, { reason: 'stale_generation', detail: 'gen' });
    const result = await act(h, { actions: [GOTO] });
    expect(result.rejected).toEqual([{ index: 0, reason: 'stale_snapshot' }]);
    expect(await h.budget.balance(CALLER.lifeId, h.clock.nowMs())).toBe(3);
  });
});

describe('act: reasoning is optional in the input', () => {
  it('sends a say given alone', async () => {
    const h = harness();
    const result = await actTool(h.deps, CALLER, { say: 'hi' });
    expect(result.accepted).toEqual([0]);
    expect(result.rejected).toEqual([]);
    expect(h.body.plans).toHaveLength(1);
  });

  it('sends a list of actions given alone', async () => {
    const h = harness();
    const result = await actTool(h.deps, CALLER, { actions: [GOTO] });
    expect(result.accepted).toEqual([0]);
    expect(result.rejected).toEqual([]);
    expect(h.body.plans).toHaveLength(1);
  });

  it('sends nothing for an empty input and charges nothing', async () => {
    const h = harness();
    const result = await actTool(h.deps, CALLER, {});
    expect(result).toEqual({ accepted: [], rejected: [], budget_remaining_thoughts: 3 });
    expect(h.body.plans).toHaveLength(0);
  });
});

describe('act: till takes a block position and nothing else', () => {
  const TILL = { do: 'till', at: { x: 3, y: 64, z: 8 } };

  it('accepts a till of a block position and sends it to the Body', async () => {
    const h = harness();
    const result = await act(h, { actions: [TILL] });
    expect(result.accepted).toEqual([0]);
    expect(result.rejected).toEqual([]);
    expect(h.body.plans).toHaveLength(1);
  });

  it('names the missing position of a till', async () => {
    const h = harness();
    const result = await act(h, { actions: [{ do: 'till' }] });
    expect(result.rejected).toEqual([
      { index: 0, reason: 'schema', detail: 'action 0: at is missing' },
    ]);
    expect(h.body.plans).toHaveLength(0);
  });

  it('names the unknown key of a till, such as a count', async () => {
    const h = harness();
    const result = await act(h, { actions: [{ ...TILL, count: 2 }] });
    expect(result.rejected).toEqual([
      { index: 0, reason: 'schema', detail: "action 0: 'count' is not a known field" },
    ]);
    expect(h.body.plans).toHaveLength(0);
  });

  it('refuses a till whose position is the word feet, and sends nothing', async () => {
    const h = harness();
    const result = await act(h, { actions: [{ do: 'till', at: 'feet' }] });
    expect(result.accepted).toEqual([]);
    expect(result.rejected).toEqual([expect.objectContaining({ index: 0, reason: 'schema' })]);
    expect(h.body.plans).toHaveLength(0);
  });

  it('refuses a till whose position lacks a coordinate, and sends nothing', async () => {
    const h = harness();
    const result = await act(h, { actions: [{ do: 'till', at: { x: 3, z: 8 } }] });
    expect(result.accepted).toEqual([]);
    expect(result.rejected).toEqual([expect.objectContaining({ index: 0, reason: 'schema' })]);
    expect(h.body.plans).toHaveLength(0);
  });
});

describe('act: a refusal says which part was refused', () => {
  const TRAVEL = { ...INTENT, program: 'travel' };

  it('names the intent field that holds a travel target which is not a player name', async () => {
    const h = harness();
    const result = await act(h, { intent: { ...TRAVEL, arguments: { target: 'the far moon!' } } });
    expect(result.rejected).toEqual([
      { index: 0, reason: 'schema', detail: 'intent.arguments.target: is not a player name' },
    ]);
    expect(markedWords(result.rejected[0]?.detail ?? '')).toEqual([]);
    expect(h.body.plans).toHaveLength(0);
  });

  it('names the missing coordinate of a travel target given as a position', async () => {
    const h = harness();
    const result = await act(h, { intent: { ...TRAVEL, arguments: { target: { x: 1, z: 2 } } } });
    expect(result.rejected).toEqual([
      { index: 0, reason: 'schema', detail: 'intent.arguments.target.y: must be an integer' },
    ]);
  });

  it('names the unknown key of an action', async () => {
    const h = harness();
    const result = await act(h, { actions: [{ ...GOTO, extra: 'zz' }] });
    expect(result.rejected).toEqual([
      { index: 0, reason: 'schema', detail: "action 0: 'extra' is not a known field" },
    ]);
  });

  it('names the required field an action lacks', async () => {
    const h = harness();
    const result = await act(h, { actions: [{ do: 'place', block: 'stone' }] });
    expect(result.rejected).toEqual([
      { index: 0, reason: 'schema', detail: 'action 0: at is missing' },
    ]);
  });

  it('never echoes a value the agent sent', async () => {
    const h = harness();
    const result = await act(h, { actions: [{ do: 'fly', target: 'the far moon!' }] });
    const detail = result.rejected[0]?.detail ?? '';
    expect(detail).toBe('action 0.do: is not available in this phase');
    expect(detail).not.toContain('fly');
    expect(detail).not.toContain('far moon');
  });

  it('keeps the detail in the sovereign_call audit, and the audit still validates', async () => {
    const h = harness();
    await act(h, { actions: [{ ...GOTO, extra: 'zz' }] });
    const call = h.recorder.calls[0];
    expect(call?.rejected).toEqual([
      { index: 0, reason: 'schema', detail: "action 0: 'extra' is not a known field" },
    ]);
    expect(validateSovereignCallPayload(call).ok).toBe(true);
  });
});
