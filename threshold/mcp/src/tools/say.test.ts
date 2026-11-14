import { validateSovereignCallPayload } from '@geldar/contract';
import type { SimEvent } from '@geldar/mcp-mock';
import type { SpeechIdentity } from '@geldar/player-core/src/attention/classify.ts';
import { eventOf } from '@geldar/player-core/src/link/link.fixtures.ts';
import { createOutputValidator } from '@geldar/player-core/src/validate/index.ts';
import { describe, expect, it } from 'vitest';
import { RingEventLog } from '../events/player-log.ts';
import { handleStreamMessage } from '../events/stream.ts';
import {
  FakeBudgetLedger,
  FakePlayerEventLog,
  FakePresenceStore,
  RecordingCallRecorder,
  ScriptedRateLimiter,
} from '../fakes/stores.fakes.ts';
import { FakeBody } from '../fakes/world.fakes.ts';
import type { Clock } from '../ports.ts';
import { ActToolError, type Caller } from './act.ts';
import { SAY_CONFIRM_MS, type SayDeps, sayTool } from './say.ts';

const CALLER: Caller = { playerId: 'ag-jason-01', lifeId: 'ag_jason_01' };

/** A clock that moves only when a sleep asks, and runs `beforeSleep` first (where a test replies). */
class SteppingClock implements Clock {
  private now = 1_000_000;
  beforeSleep: () => Promise<void> = async () => undefined;

  nowMs(): number {
    return this.now;
  }

  async sleep(ms: number): Promise<void> {
    await this.beforeSleep();
    this.now += ms;
  }
}

interface Harness {
  deps: SayDeps;
  body: FakeBody;
  budget: FakeBudgetLedger;
  events: FakePlayerEventLog;
  presence: FakePresenceStore;
  recorder: RecordingCallRecorder;
  clock: SteppingClock;
}

function harness(credits = 3, limiter = new ScriptedRateLimiter()): Harness {
  const clock = new SteppingClock();
  const budget = new FakeBudgetLedger(0, 10);
  budget.seed(CALLER.lifeId, credits, clock.nowMs());
  const events = new FakePlayerEventLog();
  const body = new FakeBody(events);
  const presence = new FakePresenceStore();
  const recorder = new RecordingCallRecorder();
  const deps: SayDeps = {
    body,
    budget,
    presence,
    limiter,
    recorder,
    validator: createOutputValidator(),
    events,
    clock,
    expiresAfterTicks: 200,
  };
  return { deps, body, budget, events, presence, recorder, clock };
}

/** Makes the Body answer the first plan with a `plan_result` for its thought, as the sleep runs. */
function replyOnce(h: Harness, said: boolean, thoughtId?: string): void {
  let written = false;
  h.clock.beforeSleep = async () => {
    const plan = h.body.plans[0];
    if (written || plan === undefined) return;
    written = true;
    const event = {
      seq: 1,
      tick: 0,
      kind: 'plan_result',
      thought_id: thoughtId ?? plan.plan.thought_id,
      said,
    } as unknown as SimEvent;
    await h.events.append(CALLER.lifeId, event);
  };
}

const say = (h: Harness, text: string) => sayTool(h.deps, CALLER, text);
const balance = (h: Harness) => h.budget.balance(CALLER.lifeId, h.clock.nowMs());

describe('say: confirmation', () => {
  it('reports spoken when the Body confirms, and keeps the one credit', async () => {
    const h = harness();
    replyOnce(h, true);
    const result = await say(h, 'Hello there');
    expect(result).toEqual({ spoken: true, budget_remaining_thoughts: 2 });
    expect(h.body.plans).toHaveLength(1);
    expect(await balance(h)).toBe(2);
    expect(h.recorder.calls[0]?.outcome).toBe('ok');
    expect(h.recorder.calls[0]?.credits_charged).toBe(1);
  });

  it('reads the confirmation from a contract plan_result streamed through handleStreamMessage', async () => {
    const h = harness();
    const ring = new RingEventLog();
    const counters = { invalid: 0 };
    const stream = {
      map: { identity: {} as SpeechIdentity, runs: new Map() },
      log: ring,
      lives: () => [],
    };
    let written = false;
    h.clock.beforeSleep = async () => {
      const plan = h.body.plans[0];
      if (written || plan === undefined) return;
      written = true;
      const raw = {
        ...eventOf('plan_result', 1, CALLER.lifeId),
        payload: {
          thought_id: plan.plan.thought_id,
          intent: 'none',
          failed_at: null,
          actions: [],
          said: true,
        },
      };
      await handleStreamMessage(1, raw, stream, counters);
    };
    const result = await sayTool({ ...h.deps, events: ring }, CALLER, 'Hello there');
    expect(counters.invalid).toBe(0);
    expect(result).toEqual({ spoken: true, budget_remaining_thoughts: 2 });
    expect(await balance(h)).toBe(2);
  });

  it('reports unconfirmed when no plan_result for its thought comes in time, and keeps the credit', async () => {
    const h = harness();
    const before = h.clock.nowMs();
    // A reply for some other thought does not count.
    replyOnce(h, true, 'th_someone_else');
    const result = await say(h, 'Hello there');
    expect(result).toMatchObject({ spoken: false, reason: 'unconfirmed' });
    expect(h.clock.nowMs() - before).toBeGreaterThanOrEqual(SAY_CONFIRM_MS);
    expect(await balance(h)).toBe(2);
    expect(h.recorder.calls[0]?.outcome).toBe('rejected');
    expect(h.recorder.calls[0]?.credits_charged).toBe(1);
  });

  it('reports body_refused when the Body answers said false, and refunds the credit', async () => {
    const h = harness();
    replyOnce(h, false);
    const result = await say(h, 'Hello there');
    expect(result).toMatchObject({ spoken: false, reason: 'body_refused' });
    expect(await balance(h)).toBe(3);
    expect(h.recorder.calls[0]?.credits_charged).toBe(0);
  });

  it('reports the refused ack as the reason and refunds, without waiting for a reply', async () => {
    const h = harness();
    h.body.rejectNextPlan(CALLER.lifeId, { reason: 'invalid_plan', detail: 'no' });
    const result = await say(h, 'Hello there');
    expect(result).toMatchObject({ spoken: false, reason: 'invalid_plan' });
    expect(await balance(h)).toBe(3);
    expect(h.body.plans).toHaveLength(1);
  });

  it('reports a wrong_life refusal as invalid_plan, never the Body word, and refunds', async () => {
    const h = harness();
    h.body.rejectNextPlan(CALLER.lifeId, { reason: 'wrong_life', detail: 'life' });
    const result = await say(h, 'Hello there');
    expect(result).toMatchObject({ spoken: false, reason: 'invalid_plan' });
    expect(await balance(h)).toBe(3);
  });
});

describe('say: refusals before the Body', () => {
  it('is rate limited with no plan and no charge', async () => {
    const h = harness(3, new ScriptedRateLimiter([{ allowed: false, retryAfterMs: 3000 }]));
    const result = await say(h, 'Hello');
    expect(result).toMatchObject({ spoken: false, reason: 'rate_limited' });
    expect(h.body.plans).toHaveLength(0);
    expect(await balance(h)).toBe(3);
  });

  it('is refused with budget_exhausted when the life holds no credit', async () => {
    const h = harness(0);
    const result = await say(h, 'Hello');
    expect(result).toMatchObject({ spoken: false, reason: 'budget_exhausted' });
    expect(h.body.plans).toHaveLength(0);
  });

  it('refuses words the validator rejects, with no plan and no charge', async () => {
    const h = harness();
    const result = await say(h, 'x'.repeat(400));
    expect(result.spoken).toBe(false);
    expect(typeof result.reason).toBe('string');
    expect(h.body.plans).toHaveLength(0);
    expect(await balance(h)).toBe(3);
  });
});

describe('say: body unavailable and the record', () => {
  it('refunds, wants the Body up and throws body_unavailable when the Body does not answer', async () => {
    const h = harness();
    h.body.setOffline(CALLER.lifeId, true);
    await expect(say(h, 'Hello')).rejects.toBeInstanceOf(ActToolError);
    await expect(say(h, 'Hello')).rejects.toMatchObject({ code: 'body_unavailable' });
    expect(await balance(h)).toBe(3);
    expect(h.presence.records.get(CALLER.lifeId)?.desired_body).toBe('up');
  });

  it('writes a valid sovereign_call that holds the words and no world text', async () => {
    const h = harness();
    replyOnce(h, true);
    await say(h, 'Hello there');
    const call = h.recorder.calls[0];
    expect(validateSovereignCallPayload(call).ok).toBe(true);
    expect(call?.say).toBe('Hello there');
    expect(call?.tool).toBe('say');
    expect(call?.thought_id).toMatch(/^th_/);
  });
});

describe('say: a presence fault keeps the refusal', () => {
  it('still refuses body_unavailable when wantBody throws, and logs the cause', async () => {
    const h = harness();
    const logged: Record<string, unknown>[] = [];
    h.deps.log = (line) => logged.push(line);
    h.presence.wantBody = async () => {
      throw new Error('kv down');
    };
    h.body.setOffline(CALLER.lifeId, true);
    await expect(say(h, 'Hello')).rejects.toBeInstanceOf(ActToolError);
    expect(await balance(h)).toBe(3);
    expect(logged).toEqual([{ event: 'presence_error', cause: 'Error: kv down' }]);
  });
});
