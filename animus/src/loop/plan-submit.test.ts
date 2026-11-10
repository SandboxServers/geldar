import type { PlanAck, PlanMessage } from '@geldar/contract';
import { describe, expect, it } from 'vitest';
import { BodyLinkError } from '../ports/index.ts';
import { LIFE, makeDecision, makeRig, type Rig, VALID_THOUGHT } from './loop-fixtures.ts';

/** A Body that refuses every plan with `reason`. */
function refuseAll(
  reason: NonNullable<PlanAck['rejection']>['reason'],
): (plan: PlanMessage) => PlanAck {
  return (plan) => ({
    thought_id: plan.thought_id,
    accepted: false,
    rejection: { reason, detail: 'refused by the test' },
  });
}

/** A Body that refuses the first plan as stale, then accepts. */
function staleOnce(): (plan: PlanMessage) => PlanAck {
  let refusals = 0;
  return (plan) => {
    refusals += 1;
    return refusals === 1
      ? {
          thought_id: plan.thought_id,
          accepted: false,
          rejection: { reason: 'stale_snapshot', detail: 'newer revision' },
        }
      : { thought_id: plan.thought_id, accepted: true, rejection: null };
  };
}

/** Makes each model call take `ms` on the injected clock, as a slow Thinker would. */
function slowModel(rig: Rig, ms: number): void {
  const complete = rig.model.complete.bind(rig.model);
  rig.model.complete = (request, signal) => {
    rig.clock.ms += ms;
    return complete(request, signal);
  };
}

describe('ThinkingLoop: refused plans', () => {
  it('holds, with no intent id, when the Body refuses a plan for a reason a new snapshot cannot cure', async () => {
    const lines: Record<string, unknown>[] = [];
    const rig = await makeRig([VALID_THOUGHT], {
      deps: { log: (line) => lines.push(line) },
      ack: refuseAll('invalid_plan'),
    });
    const result = await rig.loop.handle(makeDecision());
    expect(result.outcome).toBe('fallback_hold');
    expect(result.ack?.accepted).toBe(false);
    expect(rig.attention.settled).toEqual(['fallback_hold']);
    expect(lines.some((l) => l.event === 'plan_refused' && l.reason === 'invalid_plan')).toBe(true);
  });

  it('re-snapshots and re-thinks once when the Body refuses a stale plan', async () => {
    let sent = 0;
    const accept = staleOnce();
    const rig = await makeRig([VALID_THOUGHT, VALID_THOUGHT], {
      ack: (plan) => {
        sent += 1;
        return accept(plan);
      },
    });
    const result = await rig.loop.handle(makeDecision());
    expect(result.outcome).toBe('planned');
    expect(sent).toBe(2);
  });

  it('holds after a second stale refusal: exactly two plans are sent and there is no third thought', async () => {
    const rig = await makeRig([VALID_THOUGHT, VALID_THOUGHT], {
      ack: refuseAll('stale_snapshot'),
    });
    const result = await rig.loop.handle(makeDecision());
    expect(result.outcome).toBe('fallback_hold');
    expect(rig.body.plans).toHaveLength(2);
    expect(result.modelCalls).toBe(2);
  });

  it('logs thought_rethink with both thought ids and the reason, and adds the first cycle counts', async () => {
    const lines: Record<string, unknown>[] = [];
    const rig = await makeRig([VALID_THOUGHT, VALID_THOUGHT], {
      deps: { log: (line) => lines.push(line) },
      ack: staleOnce(),
    });
    // The first cycle's journal row fails, so its journal error must reach the result.
    const record = rig.store.recordThought.bind(rig.store);
    let writes = 0;
    rig.store.recordThought = async (row) => {
      writes += 1;
      if (writes === 1) throw new Error('db down');
      return record(row);
    };
    const result = await rig.loop.handle(makeDecision());
    const rethink = lines.find((l) => l.event === 'thought_rethink');
    expect(rethink).toMatchObject({
      life_id: LIFE,
      reason: 'stale_snapshot',
      new_thought_id: result.thoughtId,
    });
    expect(rethink?.old_thought_id).toBeTypeOf('string');
    expect(rethink?.old_thought_id).not.toBe(result.thoughtId);
    expect(result.modelCalls).toBe(2);
    expect(result.journalErrors).toBe(1);
  });

  it('retries a plan once when the ack times out (the Body dedupes by thought id)', async () => {
    let sent = 0;
    const rig = await makeRig([VALID_THOUGHT], {
      deps: { sleep: async () => {} },
      ack: (plan) => {
        sent += 1;
        if (sent === 1) throw new BodyLinkError('timeout', 'no ack in time');
        return { thought_id: plan.thought_id, accepted: true, rejection: null };
      },
    });
    const result = await rig.loop.handle(makeDecision());
    expect(result.outcome).toBe('planned');
    expect(sent).toBe(2);
  });
});

describe('ThinkingLoop: the pre-submit expiry check', () => {
  it('refuses a plan that expires during a slow model call, without calling submitPlan', async () => {
    const rig = await makeRig([VALID_THOUGHT, VALID_THOUGHT]);
    // 60 s at 20 ticks a second is 1200 ticks: the plan's whole window (expires_after_ticks).
    slowModel(rig, 60_000);
    const result = await rig.loop.handle(makeDecision());
    expect(rig.body.plans).toHaveLength(0);
    expect(result.ack?.rejection?.reason).toBe('expired');
    expect(result.outcome).toBe('fallback_hold');
  });

  it('measures the window in the configured tick length: 60 s expires a plan at 20 ticks a second, not at 10', async () => {
    const outcome = async (tickRate: number) => {
      const rig = await makeRig([VALID_THOUGHT, VALID_THOUGHT], { loop: { tickRate } });
      slowModel(rig, 60_000);
      return (await rig.loop.handle(makeDecision())).outcome;
    };
    expect(await outcome(20)).toBe('fallback_hold');
    expect(await outcome(10)).toBe('planned');
  });
});
