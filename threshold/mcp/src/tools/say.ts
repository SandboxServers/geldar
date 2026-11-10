/**
 * `say` (spec 5.15.3, Appendix K): a plan whose thought holds only `say`, one credit, one per
 * 3 seconds. The Body's `plan_result` says whether the words were spoken. The result is
 * `spoken: true` when the Body confirms, `reason: 'unconfirmed'` when no confirmation comes in time.
 */

import type { OutputValidator } from '@geldar/animus/src/ports/index.ts';
import type { SayResult, SovereignCallPayload } from '@geldar/contract';
import { batchCost } from '../budget/cost.ts';
import {
  type BodyGateway,
  BodyUnavailable,
  type BudgetLedger,
  type CallRecorder,
  type Clock,
  type PlayerEventLog,
  type PresenceStore,
  type RateLimiter,
} from '../ports.ts';
import { ActToolError, type Caller, submitThought } from './act.ts';

/** How long `say` waits for the Body's `plan_result` before it reports `unconfirmed`. */
export const SAY_CONFIRM_MS = 5000;

/** How often `say` looks for the `plan_result` while it waits. */
export const SAY_POLL_MS = 250;

/** The reasoning every `say` thought carries: the schema wants one, and the words are the point. */
const SAY_REASONING = 'say';

/** Everything `say` needs from the outside. */
export interface SayDeps {
  body: BodyGateway;
  budget: BudgetLedger;
  presence: PresenceStore;
  limiter: RateLimiter;
  recorder: CallRecorder;
  validator: OutputValidator;
  events: PlayerEventLog;
  clock: Clock;
  expiresAfterTicks: number;
}

/** The `plan_result` the Body wrote for a thought, if it has arrived. */
export function planResultFor(
  events: readonly object[],
  thoughtId: string,
): { said: boolean } | undefined {
  for (const event of events) {
    const e = event as { type?: unknown; thought_id?: unknown; said?: unknown };
    if (e.type === 'plan_result' && e.thought_id === thoughtId && typeof e.said === 'boolean') {
      return { said: e.said };
    }
  }
  return undefined;
}

/**
 * Waits for the `plan_result` of a thought, polling the life's event log for events after `cursor`,
 * for at most `SAY_CONFIRM_MS`.
 */
async function confirmation(
  deps: SayDeps,
  lifeId: string,
  thoughtId: string,
  cursor: number,
): Promise<{ said: boolean } | undefined> {
  const started = deps.clock.nowMs();
  for (;;) {
    const { events } = await deps.events.since(lifeId, cursor);
    const found = planResultFor(events, thoughtId);
    if (found !== undefined) return found;
    if (deps.clock.nowMs() - started >= SAY_CONFIRM_MS) return undefined;
    await deps.clock.sleep(SAY_POLL_MS);
  }
}

/** `say`: validates the words, reserves one credit, sends the plan and waits for the Body to confirm. */
export async function sayTool(deps: SayDeps, caller: Caller, text: string): Promise<SayResult> {
  const started = deps.clock.nowMs();
  const judged = deps.validator.parseThought(
    JSON.stringify({ reasoning: SAY_REASONING, say: text }),
  );
  if (!judged.ok) {
    return finish(
      deps,
      caller,
      text,
      { spoken: false, reason: judged.errors[0]?.code ?? 'schema' },
      started,
      0,
    );
  }
  if (!deps.limiter.take(`say:${caller.lifeId}`, started).allowed) {
    return finish(deps, caller, text, { spoken: false, reason: 'rate_limited' }, started, 0);
  }
  const reserve = await deps.budget.reserve(caller.lifeId, batchCost(['say']), started);
  if (!reserve.ok) {
    return finish(
      deps,
      caller,
      text,
      { spoken: false, reason: 'budget_exhausted' },
      started,
      0,
      reserve.remaining,
    );
  }
  try {
    // The start cursor is the log's head before the plan is sent, so the poll reads only what follows.
    const cursor = deps.events.head(caller.lifeId);
    const sent = await submitThought(deps, caller.lifeId, judged.value);
    if (!sent.ack.accepted) {
      const remaining = await deps.budget.refund(caller.lifeId, batchCost(['say']));
      const reason = sent.ack.rejection?.reason ?? 'invalid_plan';
      return finish(
        deps,
        caller,
        text,
        { spoken: false, reason },
        started,
        0,
        remaining,
        sent.thoughtId,
      );
    }
    const result = await confirmation(deps, caller.lifeId, sent.thoughtId, cursor);
    if (result?.said === true) {
      return finish(
        deps,
        caller,
        text,
        { spoken: true },
        started,
        1,
        reserve.remaining,
        sent.thoughtId,
      );
    }
    if (result !== undefined) {
      // plan_result has no reason field, so the Body's own rate limit (said: false) lands here too.
      const remaining = await deps.budget.refund(caller.lifeId, batchCost(['say']));
      return finish(
        deps,
        caller,
        text,
        { spoken: false, reason: 'body_refused' },
        started,
        0,
        remaining,
        sent.thoughtId,
      );
    }
    return finish(
      deps,
      caller,
      text,
      { spoken: false, reason: 'unconfirmed' },
      started,
      1,
      reserve.remaining,
      sent.thoughtId,
    );
  } catch (err) {
    if (!(err instanceof BodyUnavailable)) throw err;
    await deps.budget.refund(caller.lifeId, batchCost(['say']));
    await deps.presence.wantBody(caller.lifeId, deps.clock.nowMs());
    throw new ActToolError(
      'body_unavailable',
      'Your body is not reachable right now. Try again soon.',
    );
  }
}

/** Records the call, then returns the result with the balance it left. */
async function finish(
  deps: SayDeps,
  caller: Caller,
  text: string,
  outcome: { spoken: boolean; reason?: string },
  started: number,
  charged: number,
  balance?: number,
  thoughtId?: string,
): Promise<SayResult> {
  const remaining = balance ?? (await deps.budget.balance(caller.lifeId, deps.clock.nowMs()));
  const call: SovereignCallPayload = {
    player_id: caller.playerId,
    tool: 'say',
    outcome: outcome.spoken ? 'ok' : 'rejected',
    accepted: outcome.spoken ? [0] : [],
    rejected: outcome.spoken ? [] : [{ index: 0, reason: outcome.reason ?? 'rejected' }],
    credits_charged: charged,
    budget_remaining: remaining,
    latency_ms: Math.max(0, deps.clock.nowMs() - started),
    say: text,
    ...(thoughtId === undefined ? {} : { thought_id: thoughtId }),
  } as SovereignCallPayload;
  await deps.recorder.record(call);
  return {
    spoken: outcome.spoken,
    budget_remaining_thoughts: remaining,
    ...(outcome.reason === undefined ? {} : { reason: outcome.reason }),
  };
}
