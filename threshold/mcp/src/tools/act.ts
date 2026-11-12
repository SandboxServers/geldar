/**
 * `act` (spec 5.15.3, Appendix K): one thought holding say, actions and intent, validated by the
 * Mind's validator, charged per accepted item, and handed to the Body as one plan. The result
 * indices are flat: say first, then the actions in order, then the intent. The action list is
 * atomic: one bad action rejects every action, the bad ones with their code, the rest `batch_rejected`.
 */

import { newId } from '@geldar/animus/src/ids.ts';
import { buildPlan } from '@geldar/animus/src/loop/plan.ts';
import type { OutputError, OutputValidator } from '@geldar/animus/src/ports/index.ts';
import type { ActResult, PlanAck, SovereignCallPayload, Thought } from '@geldar/contract';
import { batchCost, type ChargedItem } from '../budget/cost.ts';
import {
  type ActMeter,
  type OutcomeClass,
  outcomeClassOf,
  processMeter,
  wouldCostOf,
} from '../budget/meter.ts';
import type { FailureTracker } from '../failures/tracker.ts';
import {
  type BodyGateway,
  BodyUnavailable,
  type BudgetLedger,
  type CallRecorder,
  type Clock,
  type PresenceStore,
  type RateLimiter,
} from '../ports.ts';
import { bestEffortPresence } from '../presence-write.ts';

/** A tool failure the player sees: a code and a fixed message, never echoing world text. */
export class ActToolError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'ActToolError';
    this.code = code;
  }
}

/** Who is calling: the player from the URL and the life it maps to. */
export interface Caller {
  playerId: string;
  lifeId: string;
}

/** Everything `act` needs from the outside. */
export interface ActDeps {
  body: BodyGateway;
  budget: BudgetLedger;
  presence: PresenceStore;
  limiter: RateLimiter;
  recorder: CallRecorder;
  validator: OutputValidator;
  clock: Clock;
  /** `plan.expires_after_ticks` from the config. */
  expiresAfterTicks: number;
  /** Receives the cause of a presence write that failed; the refusal stands without it. */
  log?: (line: Record<string, unknown>) => void;
  /**
   * True to reserve credits, refuse on a short balance and rate-limit acts (`GELDAR_ACT_BUDGET_ENFORCE=1`).
   * Off by default: the budget is suspended and every act is only metered (decision 0149).
   */
  enforce?: boolean;
  /** Running totals of the metered acts. Defaults to a meter shared by the process. */
  meter?: ActMeter;
  /** Remembers what each action aimed at, so a later outcome can name its goal. */
  failures?: FailureTracker | undefined;
}

/** What one act's meter adds to its `sovereign_call` event. */
interface Metering {
  wouldCost: number;
  outcomeClass: OutcomeClass;
  spentThisLife: number;
}

/** The `act` input as the tool receives it, before the contract's union narrows it. */
export interface ActArgs {
  reasoning?: string;
  say?: string | null;
  intent?: unknown;
  actions?: unknown[];
}

/** One item of the flat result list. `at` is the action's position in the list. */
interface Slot {
  kind: ChargedItem;
  at: number;
}

const ACTION_PATH = /^\/actions\/(\d+)(\/|$)/;
const SAY_PATH = /^\/say(\/|$)/;
const INTENT_PATH = /^\/intent(\/|$)/;
const ACTIONS_LIST_PATH = /^\/actions$/;

/** The Body's rejection reasons that name its own state; the player sees the closest public code. */
const PLAYER_REASON: Record<string, string> = {
  wrong_life: 'invalid_plan',
  stale_generation: 'stale_snapshot',
};

/** The reason the player is told for a Body refusal: a public code, never the Body's internal word. */
export function playerReason(reason: string | undefined): string {
  if (reason === undefined) return 'invalid_plan';
  return PLAYER_REASON[reason] ?? reason;
}

/** The items of a thought, in result order: say, each action, intent. */
export function slotsOf(args: ActArgs): Slot[] {
  const slots: Slot[] = [];
  if (args.say != null) slots.push({ kind: 'say', at: -1 });
  const list = Array.isArray(args.actions) ? args.actions : [];
  for (let at = 0; at < list.length; at++) slots.push({ kind: 'action', at });
  if (args.intent !== undefined) slots.push({ kind: 'intent', at: -1 });
  return slots;
}

/**
 * The reason each slot is refused by the validator, or undefined when it passes. A failure on the
 * whole thought refuses everything; one bad action refuses the whole action list (atomic).
 */
export function refusalsOf(errors: OutputError[], slots: Slot[]): (string | undefined)[] {
  let whole: string | undefined;
  let say: string | undefined;
  let intent: string | undefined;
  let list: string | undefined;
  const actions = new Map<number, string>();
  for (const error of errors) {
    const action = ACTION_PATH.exec(error.path);
    if (action) actions.set(Number(action[1]), actions.get(Number(action[1])) ?? error.code);
    else if (ACTIONS_LIST_PATH.test(error.path)) list ??= error.code;
    else if (SAY_PATH.test(error.path)) say ??= error.code;
    else if (INTENT_PATH.test(error.path)) intent ??= error.code;
    else whole ??= error.code;
  }
  const batchFailed = actions.size > 0 || list !== undefined;
  return slots.map((slot) => {
    if (whole !== undefined) return whole;
    if (slot.kind === 'say') return say;
    if (slot.kind === 'intent') return intent;
    if (!batchFailed) return undefined;
    return actions.get(slot.at) ?? list ?? 'batch_rejected';
  });
}

/** Per-player locks: the snapshot, the plan and its submission run one at a time for a life. */
const locks = new Map<string, Promise<void>>();

/** Runs `fn` after every earlier call for the same life has finished. */
export async function withPlayerLock<T>(lifeId: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(lifeId) ?? Promise.resolve();
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => gate);
  locks.set(lifeId, tail);
  await previous;
  try {
    return await fn();
  } finally {
    release();
    if (locks.get(lifeId) === tail) locks.delete(lifeId);
  }
}

/**
 * Sends a thought as one plan: the snapshot, the plan built from it, and its submission, under the
 * life's lock. A `stale_snapshot` refusal is retried once with a fresh snapshot. Throws
 * `BodyUnavailable` when the Body does not answer.
 */
export async function submitThought(
  deps: Pick<ActDeps, 'body' | 'clock' | 'expiresAfterTicks'>,
  lifeId: string,
  thought: Thought,
): Promise<{ ack: PlanAck; thoughtId: string }> {
  return withPlayerLock(lifeId, async () => {
    let ack: PlanAck | undefined;
    let thoughtId = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      const snapshot = await deps.body.snapshot(lifeId);
      thoughtId = newId('th');
      const plan = buildPlan({
        thought,
        thoughtId,
        snapshot,
        expiresAfterTicks: deps.expiresAfterTicks,
      });
      ack = await deps.body.submitPlan(lifeId, plan);
      if (ack.accepted || ack.rejection?.reason !== 'stale_snapshot') break;
    }
    if (ack === undefined) throw new BodyUnavailable('no plan was submitted');
    return { ack, thoughtId };
  });
}

/** Writes the `sovereign_call` event. A failed write is raised to the caller, not swallowed. */
async function recordCall(deps: ActDeps, call: SovereignCallPayload): Promise<void> {
  await deps.recorder.record(call);
}

/** `act`: validates the thought, reserves its credits, sends the plan, and settles the charge. */
export async function actTool(deps: ActDeps, caller: Caller, input: ActArgs): Promise<ActResult> {
  const started = deps.clock.nowMs();
  const enforce = deps.enforce === true;
  if (enforce && !deps.limiter.take(`act:${caller.lifeId}`, started).allowed) {
    throw new ActToolError('rate_limited', 'Too many acts in a short time. Wait, then try again.');
  }
  const slots = slotsOf(input);
  const thoughtInput = withReasoning(input);
  const judged = deps.validator.parseThought(JSON.stringify(thoughtInput));
  let refused: (string | undefined)[] = judged.ok
    ? slots.map(() => undefined)
    : refusalsOf(judged.errors, slots);
  // A partial batch is sent as the thought of its survivors, which must pass the schema on its own.
  let thought: Thought | undefined = judged.ok
    ? judged.value
    : reducedThought(thoughtInput, slots, refused);
  if (!judged.ok && thought !== undefined) {
    const checked = deps.validator.parseThought(JSON.stringify(thought));
    if (checked.ok) {
      thought = checked.value;
    } else {
      const code = checked.errors[0]?.code ?? 'schema';
      refused = refused.map((r) => r ?? code);
      thought = undefined;
    }
  }
  const survivors = slots.filter((_, i) => refused[i] === undefined);
  const result = { accepted: [] as number[], rejected: [] as { index: number; reason: string }[] };
  const reject = (index: number, reason: string): void => {
    result.rejected.push({ index, reason });
  };
  let remaining = await deps.budget.balance(caller.lifeId, started);
  let thoughtId: string | undefined;
  let outcome: SovereignCallPayload['outcome'] = 'rejected';
  let reserved = false;

  try {
    const kinds = survivors.map((slot) => slot.kind);
    // All-or-nothing: the whole surviving batch is reserved at once. A short balance refuses every
    // surviving item with `budget_exhausted`; nothing is taken and nothing is sent.
    const reserve =
      !enforce || survivors.length === 0
        ? undefined
        : await deps.budget.reserve(caller.lifeId, batchCost(kinds), started);
    if (reserve !== undefined) remaining = reserve.remaining;
    if (reserve?.ok === true) reserved = true;
    const funded = reserve === undefined || reserve.ok;
    slots.forEach((_, i) => {
      if (refused[i] !== undefined) reject(i, refused[i] as string);
    });
    if (survivors.length > 0 && !funded) {
      slots.forEach((_, i) => {
        if (refused[i] === undefined) reject(i, 'budget_exhausted');
      });
    } else if (survivors.length > 0 && thought !== undefined) {
      const sent = await submitThought(deps, caller.lifeId, thought);
      thoughtId = sent.thoughtId;
      if (sent.ack.accepted) {
        deps.failures?.submitted(caller.lifeId, thought.actions ?? []);
        slots.forEach((_, i) => {
          if (refused[i] === undefined) result.accepted.push(i);
        });
      } else {
        const reason = playerReason(sent.ack.rejection?.reason);
        if (reserved) remaining = await deps.budget.refund(caller.lifeId, batchCost(kinds));
        slots.forEach((_, i) => {
          if (refused[i] === undefined) reject(i, reason);
        });
      }
    }
    outcome = result.accepted.length > 0 ? 'ok' : 'rejected';
  } catch (err) {
    // Whatever threw after the reserve, the reserved credits come back before the error goes on.
    if (reserved)
      remaining = await deps.budget.refund(caller.lifeId, batchCost(kindsOf(survivors)));
    if (!(err instanceof BodyUnavailable)) throw err;
    await bestEffortPresence(deps.log, () =>
      deps.presence.wantBody(caller.lifeId, deps.clock.nowMs()),
    );
    outcome = 'error';
    const metering = meterCall(deps, caller.lifeId, slots, result, started, false, true);
    await recordCall(
      deps,
      callPayload(caller, input, result, remaining, started, deps, outcome, undefined, metering),
    );
    throw new ActToolError(
      'body_unavailable',
      'Your body is not reachable right now. Try again soon.',
    );
  }

  result.rejected.sort((a, b) => a.index - b.index);
  const metering = meterCall(
    deps,
    caller.lifeId,
    slots,
    result,
    started,
    thoughtId !== undefined,
    false,
  );
  await recordCall(
    deps,
    callPayload(caller, input, result, remaining, started, deps, outcome, thoughtId, metering),
  );
  return {
    accepted: result.accepted,
    rejected: result.rejected,
    budget_remaining_thoughts: remaining,
  };
}

/**
 * Meters one act (decision 0149): what the whole thought would cost, the credits its accepted items
 * would take, its outcome class and its duration. Runs on every path, enforced or not.
 */
function meterCall(
  deps: ActDeps,
  lifeId: string,
  slots: Slot[],
  result: { accepted: number[] },
  started: number,
  sent: boolean,
  failed: boolean,
): Metering {
  const wouldCost = wouldCostOf(kindsOf(slots));
  const charged = batchCost(result.accepted.map((i) => slots[i]?.kind ?? 'action'));
  const outcomeClass = outcomeClassOf(result.accepted.length, sent, failed);
  const totals = (deps.meter ?? processMeter).record(lifeId, {
    wouldCost,
    charged,
    outcome: outcomeClass,
    durationMs: Math.max(0, deps.clock.nowMs() - started),
  });
  return { wouldCost, outcomeClass, spentThisLife: totals.spent };
}

/** The charged kinds of a list of slots, in order. */
function kindsOf(list: Slot[]): ChargedItem[] {
  return list.map((slot) => slot.kind);
}

/** The stand-in reasoning for a call that gave none: the thought requires it, the act input does not. */
const ACT_REASONING = 'act';

/** The input as the thought schema reads it. The recorded call keeps the player's own input. */
function withReasoning(input: ActArgs): ActArgs {
  return input.reasoning === undefined ? { ...input, reasoning: ACT_REASONING } : input;
}

/**
 * The thought of the items that survive validation, for a partial batch: the valid say, the valid
 * actions and the valid intent, in the thought's own shape. Undefined when nothing is left to send.
 */
function reducedThought(
  input: ActArgs,
  slots: Slot[],
  refused: (string | undefined)[],
): Thought | undefined {
  const kept = (kind: ChargedItem, at: number): boolean =>
    slots.some((slot, i) => slot.kind === kind && slot.at === at && refused[i] === undefined);
  const list = Array.isArray(input.actions) ? input.actions : [];
  const actions = list.filter((_, at) => kept('action', at));
  const sayKept = kept('say', -1);
  const intentKept = kept('intent', -1);
  if (!sayKept && !intentKept && actions.length === 0) return undefined;
  const reduced: Record<string, unknown> = {};
  if (input.reasoning !== undefined) reduced.reasoning = input.reasoning;
  if (sayKept) reduced.say = input.say;
  if (actions.length > 0) reduced.actions = actions;
  if (intentKept) reduced.intent = input.intent;
  return reduced as unknown as Thought;
}

/** The `sovereign_call` payload for one call. It carries only the player's own words. */
function callPayload(
  caller: Caller,
  input: ActArgs,
  result: { accepted: number[]; rejected: { index: number; reason: string }[] },
  remaining: number,
  started: number,
  deps: ActDeps,
  outcome: SovereignCallPayload['outcome'],
  thoughtId: string | undefined,
  metering: Metering,
): SovereignCallPayload {
  return {
    would_cost: metering.wouldCost,
    outcome_class: metering.outcomeClass,
    spent_this_life: metering.spentThisLife,
    player_id: caller.playerId,
    tool: 'act',
    outcome,
    accepted: result.accepted as SovereignCallPayload['accepted'],
    rejected: result.rejected.slice(0, 8) as SovereignCallPayload['rejected'],
    credits_charged: result.accepted.length,
    budget_remaining: remaining,
    latency_ms: Math.max(0, deps.clock.nowMs() - started),
    ...(thoughtId === undefined ? {} : { thought_id: thoughtId }),
    ...(input.reasoning === undefined ? {} : { reasoning: input.reasoning }),
    ...(typeof input.say === 'string' ? { say: input.say } : {}),
  } as SovereignCallPayload;
}
