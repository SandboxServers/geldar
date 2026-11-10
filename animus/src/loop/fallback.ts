/**
 * The fallback when a thought is unavailable (spec 5.3.2): continue the current intent, or hold.
 * "Continue" resubmits the last intent the Body ended as `interrupted` (a wake ends the intent in
 * the Body, orchestrator ruling Q7), as a new intent with a new id and the remaining tick budget.
 * It never repeats an action and never an economic act: only the Phase 0 built-in programs are
 * resubmitted, so `trade_wait`, skills and anything else go to hold.
 */
import { type Intent, type Thought, validateThought } from '@geldar/contract';
import type { MindEvent } from '../ports/index.ts';
import { PHASE0_PROGRAMS } from '../validate/index.ts';

const MAX_TRACKED_INTENTS = 32;
const MAX_SEEN_EVENTS = 512;

/** One intent as the Body's events described it. */
interface TrackedIntent {
  intentId: string;
  state: string;
  /** The `accepted` event's tick, or null when the ledger never saw it. */
  acceptedTick: number | null;
  /** The tick of the last state change. */
  lastTick: number;
  /** The order of the last change, to break a tie between equal ticks. */
  order: number;
  goal: string | undefined;
  program: string | undefined;
  arguments: Intent['arguments'] | undefined;
  preconditions: string[] | undefined;
  wakeOn: string[] | undefined;
  limits: Intent['limits'] | undefined;
}

/**
 * Follows the intent events of one life. The loop feeds it the events behind each wake; it reads
 * them back for the effort signals and the fallback. Feeding an event twice changes nothing.
 */
export class IntentLedger {
  private readonly intents = new Map<string, TrackedIntent>();
  private readonly seen = new Set<string>();
  private readonly resubmitted = new Set<string>();
  private failures = 0;
  private counter = 0;

  /** Reads one event; events that are not about intents are ignored. */
  observe(event: MindEvent): void {
    if (this.seen.has(event.eventId)) return;
    if (event.type !== 'intent' && event.type !== 'plan_result') return;
    this.seen.add(event.eventId);
    if (this.seen.size > MAX_SEEN_EVENTS) {
      const oldest = this.seen.values().next().value;
      if (oldest !== undefined) this.seen.delete(oldest);
    }
    // Only an intent's own `failed` event counts toward high effort. A refused plan is a
    // plan_result, not a failed intent, so it must not count twice for one failure.
    if (event.type === 'plan_result') {
      if (event.payload.intent === 'started') this.failures = 0;
      return;
    }
    const p = event.payload;
    const tracked = this.intents.get(p.intent_id) ?? this.blank(p.intent_id);
    tracked.state = p.state;
    tracked.lastTick = p.tick;
    tracked.order = ++this.counter;
    if (p.state === 'accepted') tracked.acceptedTick = p.tick;
    if (p.goal !== undefined) tracked.goal = p.goal;
    if (p.program !== undefined) tracked.program = p.program;
    if (p.arguments !== undefined) tracked.arguments = p.arguments;
    if (p.preconditions !== undefined) tracked.preconditions = p.preconditions;
    if (p.wake_on !== undefined) tracked.wakeOn = p.wake_on;
    if (p.limits !== undefined) tracked.limits = p.limits;
    if (p.state === 'failed') this.failures++;
    else if (p.state === 'completed') this.failures = 0;
    this.trim();
  }

  /** Intents that failed one after another with no completion or start between. */
  get failedInARow(): number {
    return this.failures;
  }

  /** Records that `intentId` was resubmitted, so the fallback never resubmits it again. */
  markResubmitted(intentId: string): void {
    this.resubmitted.add(intentId);
  }

  /**
   * The most recently changed intent, when that change left it interrupted and not yet
   * resubmitted; otherwise null. An older interrupted intent is stale and is never resurrected.
   */
  lastInterrupted(): TrackedIntent | null {
    let latest: TrackedIntent | null = null;
    for (const t of this.intents.values()) {
      if (latest === null || t.order > latest.order) latest = t;
    }
    if (latest === null || latest.state !== 'interrupted') return null;
    if (this.resubmitted.has(latest.intentId)) return null;
    return latest;
  }

  private blank(intentId: string): TrackedIntent {
    const tracked: TrackedIntent = {
      intentId,
      state: 'accepted',
      acceptedTick: null,
      lastTick: 0,
      order: 0,
      goal: undefined,
      program: undefined,
      arguments: undefined,
      preconditions: undefined,
      wakeOn: undefined,
      limits: undefined,
    };
    this.intents.set(intentId, tracked);
    return tracked;
  }

  private trim(): void {
    while (this.intents.size > MAX_TRACKED_INTENTS) {
      const oldest = this.intents.keys().next().value;
      if (oldest === undefined) return;
      this.intents.delete(oldest);
    }
  }
}

/** The fallback "continue" result: the thought to submit and the intent it resumes. */
export interface Continuation {
  thought: Thought;
  /** The interrupted intent's id, to mark once the Body accepts the plan. */
  resumedIntentId: string;
  /** The tick budget the new intent gets. */
  remainingTicks: number;
}

/**
 * The thought that resumes the last interrupted intent, or null when the fallback must hold:
 * nothing was interrupted, its program is not on the Phase 0 allow-list, its definition or start
 * is unknown, its tick budget is spent, or the result does not pass the thought schema. The
 * remaining budget is `max_world_ticks` less the ticks between acceptance and interruption.
 */
export function continueInterrupted(ledger: IntentLedger): Continuation | null {
  const t = ledger.lastInterrupted();
  if (t === null || t.acceptedTick === null) return null;
  if (t.program === undefined || !PHASE0_PROGRAMS.includes(t.program)) return null;
  if (t.goal === undefined || t.arguments === undefined || t.limits === undefined) return null;
  const remaining = t.limits.max_world_ticks - Math.max(0, t.lastTick - t.acceptedTick);
  if (remaining < 1) return null;
  const intent: Intent = {
    goal: t.goal,
    program: t.program,
    arguments: t.arguments,
    wake_on: (t.wakeOn ?? []) as Intent['wake_on'],
    limits: { max_world_ticks: remaining, max_block_operations: t.limits.max_block_operations },
  };
  // The schema check below enforces the 16-entry cap the generated tuple type expresses.
  if (t.preconditions !== undefined) intent.preconditions = t.preconditions as never;
  const checked = validateThought({
    reasoning: 'Fallback: no new thought, so the interrupted intent continues.',
    intent,
  });
  if (!checked.ok) return null;
  return { thought: checked.value, resumedIntentId: t.intentId, remainingTicks: remaining };
}
