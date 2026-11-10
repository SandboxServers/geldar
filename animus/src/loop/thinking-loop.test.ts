import { validateThoughtEventPayload, validateWorldEvent } from '@geldar/contract';
import { describe, expect, it } from 'vitest';
import { newId } from '../ids.ts';
import { BodyLinkError, ModelError } from '../ports/index.ts';
import {
  intentEvent,
  LIFE,
  makeDecision,
  makeRig,
  makeSnapshot,
  OPTIONS,
  planResultEvent,
  VALID_THOUGHT,
} from './loop-fixtures.ts';
import { CORRECTIVE_RETRY } from './thinking-loop.ts';

/** Events that leave an interrupted gather behind. */
function interrupted(program = 'gather') {
  const id = newId('in');
  return {
    id,
    events: [
      intentEvent(id, 'accepted', 100, program),
      intentEvent(id, 'interrupted', 400, program, false),
    ],
  };
}

describe('ThinkingLoop: the model plans', () => {
  it('goes from wake to plan on a valid first answer, with a full journal row and a thought event', async () => {
    const rig = await makeRig([
      { text: VALID_THOUGHT, usageReported: { promptTokens: 40, completionTokens: 20 } },
    ]);
    const result = await rig.loop.handle(makeDecision('idle'));

    expect(result.outcome).toBe('planned');
    expect(result.modelCalls).toBe(1);
    expect(rig.body.snapshotRequests).toEqual(['idle']);
    expect(rig.attention.calls).toEqual(['started', 'settled']);
    expect(rig.attention.settled).toEqual(['planned']);

    // The prompt got the snapshot with the budget and the sleep counter filled in.
    const vars = rig.prompts.renders[0]?.vars;
    expect(vars && 'snapshot' in vars ? vars.snapshot.self : null).toMatchObject({
      budget_remaining_thoughts: 120,
      days_since_sleep: 2,
    });

    // The plan: ids and envelope match the snapshot.
    const plan = rig.body.plans[0];
    expect(plan).toBeDefined();
    if (plan === undefined) return;
    expect(plan.life_id).toBe(LIFE);
    expect(plan.source_snapshot_id).toBe(`sn_${'1'.repeat(26)}`);
    expect(plan.snapshot_revision).toBe(7);
    expect(plan.body_generation).toBe(2);
    expect(plan.expires_tick).toBe(1000 + 1200);
    expect(plan.action_ids).toHaveLength(1);
    expect(plan.intent_id).toMatch(/^in_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(result.plan).toBe(plan);
    expect(result.ack?.accepted).toBe(true);

    // The journal row is complete.
    expect(rig.store.thoughts).toHaveLength(1);
    const row = rig.store.thoughts[0];
    expect(row?.thoughtId).toBe(plan.thought_id);
    expect(row?.lifeId).toBe(LIFE);
    expect(row?.worldTick).toBe(1000);
    expect(row?.wakeReason).toBe('idle');
    expect(row?.modelInput).toEqual(rig.prompts.render('thought', vars as never).messages);
    expect(row?.rawOutput).toBe(VALID_THOUGHT);
    expect(row?.parsed).toEqual(JSON.parse(VALID_THOUGHT));
    expect(row?.promptTemplateVersion).toBe('fake');
    expect(row?.schemaVersion).toBe('thought@1');
    expect(row?.mindVersion).toBe('mind-0.0.0');
    expect(row?.bodyVersion).toBe('body-0.0.0');
    expect(row?.modelConfig).toBe(OPTIONS.modelConfig);
    expect(row?.thinkerId).toBe('fake');
    expect(row?.effort).toBe('minimal');
    const chars = (row?.modelInput ?? []).reduce((n, m) => n + m.content.length, 0);
    expect(row?.tokensInEstimated).toBe(Math.ceil(chars / 4));
    expect(row?.tokensOutEstimated).toBe(Math.ceil(VALID_THOUGHT.length / 4));
    expect(row?.providerUsage).toMatchObject({ prompt_tokens: 40, completion_tokens: 20 });
    expect(row?.latencyMs).toBe(1);
    expect(row?.creditsReserved).toBe(1);
    expect(row?.creditsSettled).toBe(1);
    expect(row?.snapshot?.self.budget_remaining_thoughts).toBe(120);

    // The thought event.
    const event = rig.events.published[0];
    expect(rig.events.published).toHaveLength(1);
    expect(validateWorldEvent(event).ok).toBe(true);
    expect(event?.type).toBe('thought');
    expect(event?.source_event_id).toBe(`ev_${plan.thought_id.slice(3)}`);
    expect(event?.agent_id).toBe(LIFE);
    expect(event?.thinker_id).toBe('fake');
    expect(validateThoughtEventPayload(event?.payload).ok).toBe(true);
    expect(event?.payload).toMatchObject({
      thought_id: plan.thought_id,
      wake_reason: 'idle',
      outcome: 'planned',
      effort: 'minimal',
      intent_id: plan.intent_id,
    });
  });

  it('sends the configured job: deadline, schema, cache hint and reasoning off', async () => {
    const rig = await makeRig([VALID_THOUGHT]);
    await rig.loop.handle(makeDecision());
    const job = rig.model.jobs[0];
    expect(job?.model).toBe('qwen3:32b');
    expect(job?.deadline.getTime()).toBe(rig.clock.ms + 25_000);
    expect(job?.maxTokens).toBe(600);
    expect(job?.reasoning).toBe('off');
    expect(job?.responseSchema).toEqual({ type: 'object' });
    expect(job?.stablePrefixChars).toBeGreaterThan(0);
  });

  it('retries once after invalid output, with its own row and the corrective wake reason', async () => {
    const rig = await makeRig(['not json at all', VALID_THOUGHT]);
    const result = await rig.loop.handle(makeDecision('speech_addressed'));

    expect(result.outcome).toBe('planned');
    expect(result.modelCalls).toBe(2);
    expect(rig.store.thoughts).toHaveLength(2);
    const [first, second] = rig.store.thoughts;
    expect(first?.wakeReason).toBe('speech_addressed');
    expect(first?.parsed).toBeNull();
    expect(first?.rawOutput).toBe('not json at all');
    expect(second?.wakeReason).toBe(CORRECTIVE_RETRY);
    expect(second?.thoughtId).not.toBe(first?.thoughtId);
    expect(second?.parsed).not.toBeNull();
    expect(second?.modelInput).toHaveLength((first?.modelInput?.length ?? 0) + 1);
    expect(rig.model.jobs[1]?.messages.at(-1)?.content).toContain('rejected');
    // The plan carries the id of the call that produced the thought.
    expect(rig.body.plans[0]?.thought_id).toBe(second?.thoughtId);
    expect(rig.events.published[0]?.payload).toMatchObject({ thought_id: second?.thoughtId });
    expect(rig.events.published[0]?.payload).toMatchObject({ wake_reason: 'speech_addressed' });
  });

  it('logs a loop_error with the life id and an error code when the memory load fails', async () => {
    const lines: Record<string, unknown>[] = [];
    const rig = await makeRig([VALID_THOUGHT], { deps: { log: (line) => lines.push(line) } });
    rig.store.loadDeterministic = async () => {
      throw new Error('db down');
    };
    const result = await rig.loop.handle(makeDecision());
    expect(result.outcome).toBe('model_error');
    const logged = lines.find((l) => l.event === 'loop_error');
    expect(logged?.life_id).toBeTypeOf('string');
    expect(logged?.error_code).toBeTypeOf('string');
  });

  it('logs a loop_error and fails the thought when the memory load never returns', async () => {
    const lines: Record<string, unknown>[] = [];
    const rig = await makeRig([VALID_THOUGHT], {
      loop: { memoryTimeoutMs: 20 },
      deps: { log: (line) => lines.push(line) },
    });
    rig.store.loadDeterministic = () => new Promise<never>(() => undefined);
    const result = await rig.loop.handle(makeDecision());
    expect(result.outcome).toBe('model_error');
    expect(rig.body.plans).toHaveLength(0);
    expect(lines.find((l) => l.event === 'loop_error')).toBeDefined();
  });

  it('logs memory_load_timeout with the life id and an error code when the memory load runs out', async () => {
    const lines: Record<string, unknown>[] = [];
    const rig = await makeRig([VALID_THOUGHT], {
      loop: { memoryTimeoutMs: 20 },
      deps: { log: (line) => lines.push(line) },
    });
    rig.store.loadDeterministic = () => new Promise<never>(() => undefined);
    await rig.loop.handle(makeDecision());
    const timeout = lines.find((l) => l.event === 'memory_load_timeout');
    expect(timeout).toMatchObject({ life_id: LIFE, error_code: 'timeout' });
  });

  it('counts days since sleep from now when the life has neither a sleep nor a birth day', async () => {
    const rig = await makeRig([VALID_THOUGHT], {
      snapshot: makeSnapshot({
        world_time: { day: 5, time_of_day: 'day', ticks: 1000, weather: 'clear' },
      }),
    });
    const load = rig.store.loadDeterministic.bind(rig.store);
    rig.store.loadDeterministic = async (lifeId, tick) => {
      const memory = await load(lifeId, tick);
      return { ...memory, agent: { ...memory.agent, lastSleepDay: null, bornDay: null } };
    };
    await rig.loop.handle(makeDecision('idle'));
    const vars = rig.prompts.renders[0]?.vars;
    expect(vars && 'snapshot' in vars ? vars.snapshot.self : null).toMatchObject({
      days_since_sleep: 0,
    });
  });

  it('runs a decision from the attention controller through attach', async () => {
    const rig = await makeRig([VALID_THOUGHT]);
    const detach = rig.loop.attach();
    rig.attention.decide(makeDecision('mind_start'));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(rig.body.plans).toHaveLength(1);
    expect(rig.attention.calls).toEqual(['started', 'settled']);
    detach();
  });
});

describe('ThinkingLoop: fallback', () => {
  it('continues the interrupted intent after two invalid answers, as a new intent with the remaining ticks', async () => {
    const rig = await makeRig(['nope', 'still nope']);
    const { id, events } = interrupted();
    const result = await rig.loop.handle(makeDecision('fallback', events));

    expect(result.outcome).toBe('fallback_continue');
    expect(result.modelCalls).toBe(2);
    const plan = rig.body.plans[0];
    expect(plan?.intent_id).toMatch(/^in_/);
    expect(plan?.intent_id).not.toBe(id);
    expect(plan?.action_ids).toEqual([]);
    expect(plan?.thought.actions).toBeUndefined();
    expect(plan?.thought.intent).toMatchObject({
      goal: 'gather_wood',
      program: 'gather',
      limits: { max_world_ticks: 1700, max_block_operations: 100 },
    });
    expect(plan?.thought_id).toBe(rig.store.thoughts[0]?.thoughtId);
    expect(rig.attention.settled).toEqual(['fallback_continue']);
    expect(rig.events.published[0]?.payload).toMatchObject({
      outcome: 'fallback_continue',
      intent_id: plan?.intent_id,
    });

    // The accepted resubmission is spent: the next failed cycle holds.
    rig.model.script(new ModelError('timeout', 'late'));
    const again = await rig.loop.handle(makeDecision('fallback'));
    expect(again.outcome).toBe('model_error');
    expect(rig.body.plans).toHaveLength(1);
  });

  it('holds on a timeout when nothing was interrupted', async () => {
    const rig = await makeRig([new ModelError('timeout', 'too slow')]);
    const result = await rig.loop.handle(makeDecision());
    expect(result.outcome).toBe('model_error');
    expect(rig.body.plans).toHaveLength(0);
    expect(result.plan).toBeNull();
    const row = rig.store.thoughts[0];
    expect(row?.rawOutput).toBeNull();
    expect(row?.parsed).toBeNull();
    expect(row?.creditsReserved).toBe(1);
    expect(row?.creditsSettled).toBe(0);
    expect(rig.admission.remaining()).toBe(120);
    expect(rig.events.published[0]?.payload).toMatchObject({
      outcome: 'model_error',
      intent_id: null,
    });
    expect(rig.attention.settled).toEqual(['model_error']);
  });

  it('holds on invalid output twice when nothing was interrupted', async () => {
    const rig = await makeRig(['{}', '{}']);
    const result = await rig.loop.handle(makeDecision());
    expect(result.outcome).toBe('invalid_output');
    expect(rig.body.plans).toHaveLength(0);
  });

  it('continues the interrupted intent when there is no Thinker', async () => {
    const rig = await makeRig([new ModelError('no_thinker', 'none connected')]);
    const { events } = interrupted();
    const result = await rig.loop.handle(makeDecision('idle', events));
    expect(result.outcome).toBe('fallback_continue');
    expect(rig.model.jobs).toHaveLength(1);
    expect(rig.body.plans).toHaveLength(1);
  });

  it('does not resubmit when the call was cancelled', async () => {
    const rig = await makeRig([new ModelError('cancelled', 'stopped')]);
    const { events } = interrupted();
    const result = await rig.loop.handle(makeDecision('idle', events));
    expect(result.outcome).toBe('model_error');
    expect(rig.body.plans).toHaveLength(0);
  });

  it('never resubmits an economic or non-allow-listed intent', async () => {
    for (const program of ['trade_wait', 'follow', 'build', 'mySkill']) {
      const rig = await makeRig([new ModelError('internal', 'boom')]);
      const { events } = interrupted(program);
      const result = await rig.loop.handle(makeDecision('idle', events));
      expect(result.outcome, program).toBe('model_error');
      expect(rig.body.plans, program).toHaveLength(0);
    }
  });

  it('never resubmits an intent that ended any way but interrupted', async () => {
    const rig = await makeRig([new ModelError('internal', 'boom')]);
    const id = newId('in');
    const events = [
      intentEvent(id, 'accepted', 100),
      intentEvent(id, 'failed', 300, 'gather', false),
    ];
    const result = await rig.loop.handle(makeDecision('idle', events));
    expect(result.outcome).toBe('model_error');
    expect(rig.body.plans).toHaveLength(0);
  });

  it('holds when the Body cannot be reached for the snapshot or the plan', async () => {
    const down = await makeRig([VALID_THOUGHT]);
    down.body.failWith = new BodyLinkError('unavailable', 'no body');
    const none = await down.loop.handle(makeDecision());
    expect(none.skipped).toBe('snapshot_unavailable');
    expect(down.model.jobs).toHaveLength(0);
    expect(down.attention.settled).toEqual(['fallback_hold']);

    const rig = await makeRig([VALID_THOUGHT]);
    rig.body.submitPlan = async () => {
      throw new BodyLinkError('timeout', 'no ack');
    };
    const result = await rig.loop.handle(makeDecision());
    expect(result.outcome).toBe('fallback_hold');
    expect(result.plan).toBeNull();
    expect(rig.events.published[0]?.payload).toMatchObject({ outcome: 'fallback_hold' });
  });
});

describe('ThinkingLoop: a Thinker that is not connected yet', () => {
  const noThinker = (): ModelError => new ModelError('no_thinker', 'none connected');

  it('waits for a Thinker and retries once, then plans', async () => {
    const waits: [string, number][] = [];
    const lines: Record<string, unknown>[] = [];
    const rig = await makeRig([noThinker(), VALID_THOUGHT], {
      loop: { thinkerWaitMs: 20_000 },
      deps: {
        awaitThinker: async (model, ms) => {
          waits.push([model, ms]);
          return true;
        },
        log: (line) => lines.push(line),
      },
    });
    const result = await rig.loop.handle(makeDecision('idle'));
    expect(result.outcome).toBe('planned');
    expect(waits).toEqual([['qwen3:32b', 20_000]]);
    expect(rig.model.jobs).toHaveLength(2);
    expect(rig.store.thoughts).toHaveLength(1);
    expect(lines.find((l) => l.event === 'thought_outcome')).toMatchObject({ outcome: 'planned' });
  });

  it('falls back after one wait when no Thinker comes, and journals and logs the error code', async () => {
    const lines: Record<string, unknown>[] = [];
    const rig = await makeRig([noThinker(), noThinker()], {
      loop: { thinkerWaitMs: 20_000 },
      deps: { awaitThinker: async () => false, log: (line) => lines.push(line) },
    });
    const result = await rig.loop.handle(makeDecision('idle'));
    expect(result.outcome).toBe('model_error');
    expect(rig.model.jobs).toHaveLength(1);
    expect(rig.store.thoughts[0]?.providerUsage).toEqual({
      error_code: 'no_thinker',
      source: 'error',
    });
    expect(lines.find((l) => l.event === 'thought_outcome')).toMatchObject({
      outcome: 'model_error',
      error_code: 'no_thinker',
    });
    expect(JSON.stringify(lines)).not.toContain('Adam');
  });

  it('retries at most once even when the second call fails with no_thinker too', async () => {
    const rig = await makeRig([noThinker(), noThinker()], {
      loop: { thinkerWaitMs: 1000 },
      deps: { awaitThinker: async () => true },
    });
    const result = await rig.loop.handle(makeDecision('idle'));
    expect(result.outcome).toBe('model_error');
    expect(rig.model.jobs).toHaveLength(2);
  });
});

describe('ThinkingLoop: admission', () => {
  it('is tired at the cap: no model call, a row with no call, a tired event', async () => {
    const rig = await makeRig([VALID_THOUGHT], { cap: 1 });
    rig.admission.reserve(1);
    const result = await rig.loop.handle(makeDecision());
    expect(result.outcome).toBe('tired');
    expect(result.modelCalls).toBe(0);
    expect(rig.model.jobs).toHaveLength(0);
    expect(rig.body.plans).toHaveLength(0);
    expect(rig.store.thoughts).toHaveLength(1);
    expect(rig.store.thoughts[0]).toMatchObject({
      modelInput: null,
      rawOutput: null,
      creditsReserved: 0,
      creditsSettled: 0,
    });
    expect(rig.events.published[0]?.payload).toMatchObject({ outcome: 'tired' });
    expect(rig.attention.settled).toEqual(['tired']);
    const vars = rig.prompts.renders[0]?.vars;
    expect(vars && 'snapshot' in vars ? vars.snapshot.self.budget_remaining_thoughts : -1).toBe(0);
  });

  it('continues the interrupted intent when tired', async () => {
    const rig = await makeRig([VALID_THOUGHT], { cap: 1 });
    rig.admission.reserve(1);
    const { events } = interrupted();
    const result = await rig.loop.handle(makeDecision('idle', events));
    expect(result.outcome).toBe('fallback_continue');
    expect(rig.model.jobs).toHaveLength(0);
    expect(rig.body.plans).toHaveLength(1);
  });

  it('spends one credit per call, so a corrective retry costs two in all', async () => {
    const rig = await makeRig(['bad', VALID_THOUGHT], { cap: 3 });
    await rig.loop.handle(makeDecision());
    expect(rig.admission.remaining()).toBe(1);
  });

  it('is tired on the retry when the first call spent the last credit', async () => {
    const rig = await makeRig(['bad', VALID_THOUGHT], { cap: 1 });
    const result = await rig.loop.handle(makeDecision());
    expect(result.outcome).toBe('tired');
    expect(result.modelCalls).toBe(1);
    expect(rig.store.thoughts).toHaveLength(1);
  });
});

describe('ThinkingLoop: effort', () => {
  it('is minimal with reasoning off when nothing is wrong', async () => {
    const rig = await makeRig([VALID_THOUGHT]);
    await rig.loop.handle(makeDecision());
    expect(rig.model.jobs[0]?.reasoning).toBe('off');
    expect(rig.store.thoughts[0]?.effort).toBe('minimal');
  });

  it('goes high on a stuck report: reasoning on, more tokens, a capped deadline', async () => {
    const snapshot = makeSnapshot({ stuck: { action: 'goto', repeat_count: 4 } });
    const rig = await makeRig([VALID_THOUGHT], { snapshot });
    await rig.loop.handle(makeDecision());
    const job = rig.model.jobs[0];
    expect(job?.reasoning).toBe('on');
    expect(job?.maxTokens).toBe(1200);
    expect(job?.deadline.getTime()).toBe(rig.clock.ms + 50_000);
    expect(rig.store.thoughts[0]?.effort).toBe('high');
    expect(rig.events.published[0]?.payload).toMatchObject({ effort: 'high' });
  });

  it('goes high after two failed intents in a row', async () => {
    const rig = await makeRig([VALID_THOUGHT]);
    const events = [
      intentEvent(newId('in'), 'failed', 100),
      intentEvent(newId('in'), 'failed', 200),
    ];
    await rig.loop.handle(makeDecision('action_failed', events));
    expect(rig.model.jobs[0]?.reasoning).toBe('on');
    expect(rig.store.thoughts[0]?.effort).toBe('high');
  });

  it('stays minimal when one failed intent is followed by a refused plan', async () => {
    const rig = await makeRig([VALID_THOUGHT]);
    const events = [
      intentEvent(newId('in'), 'failed', 100),
      planResultEvent('precondition_failed', 200),
    ];
    await rig.loop.handle(makeDecision('action_failed', events));
    expect(rig.model.jobs[0]?.reasoning).toBe('off');
    expect(rig.store.thoughts[0]?.effort).toBe('minimal');
  });

  it('goes high on a repeated failure wake, not on the first', async () => {
    const rig = await makeRig([VALID_THOUGHT, VALID_THOUGHT]);
    await rig.loop.handle(makeDecision('precondition_failed'));
    await rig.loop.handle(makeDecision('precondition_failed'));
    expect(rig.model.jobs.map((j) => j.reasoning)).toEqual(['off', 'on']);
  });
});
