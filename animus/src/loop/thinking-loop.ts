/**
 * The thinking loop (spec 5.3.4): for each wake decision, from the snapshot to the plan the Body
 * receives. Every collaborator is injected as a port, so the loop runs on fakes. One decision at a
 * time: the attention controller allows one in-flight thought per agent, and `thoughtStarted` and
 * `thoughtSettled` bracket every cycle.
 *
 * Outcome of a cycle (`ThoughtOutcome`): `planned` when the Body accepted the model's thought;
 * `fallback_continue` when the model failed and the last interrupted intent was resubmitted and
 * accepted; `fallback_hold` when the Body refused or never got the plan; otherwise the cause when
 * nothing was submitted: `tired` (admission refused), `model_error` or `invalid_output` (twice).
 */
import {
  type PlanAck,
  type PlanMessage,
  type Snapshot,
  type Thought,
  validatePlanMessage,
} from '@geldar/contract';
import type { AnimusConfig, JobSettings } from '../config.ts';
import { newId } from '../ids.ts';
import {
  type AttentionController,
  type BodyLink,
  BodyLinkError,
  type Embedder,
  type EventPublisher,
  type Journal,
  type MemoryStore,
  type MindEvent,
  type ModelClient,
  type ModelCompletion,
  ModelError,
  type ModelMessage,
  type OutputError,
  type OutputValidator,
  type PromptLibrary,
  type PromptRender,
  type ThoughtOutcome,
  type WakeDecision,
} from '../ports/index.ts';
import { type Admission, THOUGHT_COST } from './admission.ts';
import { chooseEffort, type EffortChoice, isRepeatedFailureWake, jobShape } from './effort.ts';
import { continueInterrupted, IntentLedger } from './fallback.ts';
import { IntentLinker } from './intent-link.ts';
import { buildThoughtRow, type LoopVersions } from './journal-row.ts';
import { buildPlan, planExpiredBy } from './plan.ts';
import { requestSnapshotWithRetry, sleepFor } from './snapshot-retry.ts';
import { callWaitingForThinker } from './thinker-wait.ts';
import {
  buildThoughtEvent,
  type FailureReport,
  publishThoughtEvent,
  recordLostWake,
  reportFailure,
  writeThoughtRow,
} from './thought-journal.ts';

export type { LoopVersions } from './journal-row.ts';

/** The `thoughts.wake_reason` of the second call of a cycle. */
export const CORRECTIVE_RETRY = 'corrective_retry';

/** The loop options and the ports, re-exported for the callers that build the loop. */
export { type LoopOptions, loopOptionsFromConfig } from './loop-options.ts';

import type { LoopOptions } from './loop-options.ts';

export type { LoopDeps, LoopResult } from './loop-types.ts';

import type { LoopDeps, LoopResult } from './loop-types.ts';

type Attempt =
  | { kind: 'ok'; thought: Thought; completion: ModelCompletion }
  | { kind: 'invalid'; errors: OutputError[]; completion: ModelCompletion }
  | { kind: 'error'; code: string }
  | { kind: 'tired' };

/** Mutable state of one cycle. */
interface Cycle {
  decision: WakeDecision;
  snapshot: Snapshot;
  render: PromptRender;
  effort: EffortChoice;
  calls: number;
  latencyMs: number;
  thinkerId: string | undefined;
  journalErrors: number;
  /** The code of the last model call that failed, for the journal and the log. */
  errorCode?: string;
}

/**
 * Waits for `work`, and fails after `ms` when a limit is set. A late result is dropped, never left
 * as an unhandled rejection; the timer is cleared as soon as `work` settles.
 */
function withinLimit<T>(work: Promise<T>, ms: number | undefined): Promise<T> {
  if (ms === undefined) return work;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
  });
  work.catch(() => undefined);
  return Promise.race([work, limit]).finally(() => clearTimeout(timer));
}

/** The Body refused a plan because it expired before it was sent; the loop decides, not the Body. */
function expiredRefusal(thoughtId: string): PlanAck {
  return {
    thought_id: thoughtId,
    accepted: false,
    rejection: { reason: 'expired', detail: 'the plan expired before it was submitted' },
  };
}

/** A refusal that a fresh snapshot can cure: the plan was built on a state that has moved on. */
function isStaleRefusal(ack: PlanAck): boolean {
  const reason = ack.rejection?.reason;
  return reason === 'stale_generation' || reason === 'stale_snapshot' || reason === 'expired';
}

/** The thinking loop of one life. */
export class ThinkingLoop {
  private readonly deps: LoopDeps;
  private readonly options: LoopOptions;
  private readonly ledger: IntentLedger;
  private readonly now: () => number;
  private readonly abort = new AbortController();
  private readonly report: FailureReport;
  private previousReason: string | null = null;
  private readonly links: IntentLinker;

  constructor(deps: LoopDeps, options: LoopOptions) {
    this.deps = deps;
    this.options = options;
    this.ledger = deps.ledger ?? new IntentLedger();
    this.now = deps.now ?? Date.now;
    this.report = {
      lifeId: options.lifeId,
      log: (line) => this.log(line),
      onError: (error) => deps.onError?.(error),
    };
    this.links = new IntentLinker({
      journal: deps.journal,
      lifeId: options.lifeId,
      sleep: deps.sleep ?? sleepFor,
      log: (line) => this.log(line),
    });
  }

  /** Resolves once the intent links started so far have ended: linked, given up or stopped. */
  async settleLinks(): Promise<void> {
    await this.links.settled();
  }

  /** Feeds a Body event to the intent ledger (the effort signals and the fallback read it). */
  observe(event: MindEvent): void {
    this.ledger.observe(event);
  }

  /** Runs every wake decision the controller makes. Returns the function that stops listening. */
  attach(): () => void {
    return this.deps.attention.onDecision((decision) => {
      void this.handle(decision);
    });
  }

  /** Cancels the model call in flight, if any; its cycle ends as a hold. */
  stop(): void {
    this.abort.abort();
  }

  /** Thinks once for `decision`. Never rejects: a failure ends the cycle as `model_error`. */
  async handle(decision: WakeDecision): Promise<LoopResult> {
    this.deps.attention.thoughtStarted();
    let result: LoopResult;
    try {
      result = await this.run(decision);
    } catch (error) {
      reportFailure(this.report, error, 'cycle_failed');
      result = {
        outcome: 'model_error',
        thoughtId: null,
        plan: null,
        ack: null,
        effort: null,
        modelCalls: 0,
        journalErrors: 0,
      };
    }
    this.previousReason = decision.reason;
    this.deps.attention.thoughtSettled(result.outcome);
    return result;
  }

  /** One cycle. `retried` is set on the single re-think after a stale or expired refusal. */
  private async run(decision: WakeDecision, retried = false): Promise<LoopResult> {
    for (const event of [...decision.events, ...decision.digest]) this.ledger.observe(event);

    // 1. The snapshot, with the budget and the sleep counter set.
    const raw = await requestSnapshotWithRetry(decision.reason.slice(0, 64), {
      body: this.deps.body,
      lifeId: this.options.lifeId,
      budgetMs: this.options.snapshotRetryMs ?? 0,
      sleep: this.deps.sleep ?? sleepFor,
      signal: this.abort.signal,
      log: (line) => this.log(line),
    });
    if (raw === null) {
      await recordLostWake(this.deps.journal, decision.reason, this.iso(), this.report);
      return {
        outcome: 'fallback_hold',
        thoughtId: null,
        plan: null,
        ack: null,
        effort: null,
        modelCalls: 0,
        journalErrors: 0,
        skipped: 'snapshot_unavailable',
      };
    }
    const snappedAt = this.now();
    const { lifeId } = this.options;
    const tick = raw.world_time.ticks;

    // 2. The profile and the memory.
    const load = this.deps.memory.loadDeterministic(lifeId, tick);
    const memory = await withinLimit(load, this.options.memoryTimeoutMs);
    // A life with no sleep and no birth day counts from now, not from day 0 of the world.
    const lastSleep = memory.agent.lastSleepDay ?? memory.agent.bornDay ?? raw.world_time.day;
    const snapshot: Snapshot = {
      ...raw,
      self: {
        ...raw.self,
        budget_remaining_thoughts: this.deps.admission.remaining(),
        days_since_sleep: Math.max(0, raw.world_time.day - lastSleep),
      },
    };
    const episodic = await this.retrieve(decision, snapshot);
    const since = Math.max(0, tick - 24_000);
    const recent = (await this.deps.journal.journalSince(lifeId, since)).slice(
      -this.options.workingWindow,
    );

    // 3. The prompt.
    const render = this.deps.prompts.render('thought', {
      agent: {
        name: memory.agent.name,
        lifeId,
        personalitySeed: memory.agent.personalitySeed ?? '',
      },
      snapshot,
      wake: decision,
      goals: memory.goals,
      relationships: memory.relationships,
      beliefs: memory.beliefs,
      dueCommitments: memory.dueCommitments,
      episodic,
      recentThoughts: recent,
    });

    // 5. Effort from the observable signals.
    const effort = chooseEffort({
      failedIntentsInARow: this.ledger.failedInARow,
      repeatedFailureWake: isRepeatedFailureWake(this.previousReason, decision.reason),
      stuck: snapshot.stuck ?? null,
    });
    const cycle: Cycle = {
      decision,
      snapshot,
      render,
      effort,
      calls: 0,
      latencyMs: 0,
      thinkerId: undefined,
      journalErrors: 0,
    };

    // 4 to 6. Admission, the model, validation, one corrective retry.
    const firstId = newId('th');
    const first = await this.attempt(cycle, firstId, decision.reason, render.messages);
    let finalId = firstId;
    let last = first;
    if (first.kind === 'invalid') {
      const retryId = newId('th');
      const messages = [
        ...render.messages,
        this.deps.validator.correctiveMessage(first.errors, first.completion.text),
      ];
      last = await this.attempt(cycle, retryId, CORRECTIVE_RETRY, messages);
      if (last.kind === 'ok') finalId = retryId;
    }
    if (first.kind === 'tired') await this.recordNoCall(cycle, firstId);

    // 8. A valid thought becomes the plan. A refusal of a stale or expired plan is re-thought once.
    if (last.kind === 'ok') {
      const plan = buildPlan({
        thought: last.thought,
        thoughtId: finalId,
        snapshot,
        expiresAfterTicks: this.options.expiresAfterTicks,
      });
      const ack = await this.submitChecked(plan, finalId, tick, snappedAt);
      if (ack === null) return this.finish(cycle, 'fallback_hold', finalId, null, null);
      this.noteRefusal(finalId, ack);
      if (!ack.accepted && !retried && isStaleRefusal(ack)) return this.run(decision, true);
      return this.finish(cycle, ack.accepted ? 'planned' : 'fallback_hold', finalId, plan, ack);
    }

    // 7. The fallback: continue the interrupted intent, or hold.
    const cause: ThoughtOutcome =
      last.kind === 'tired' ? 'tired' : last.kind === 'invalid' ? 'invalid_output' : 'model_error';
    const cancelled = last.kind === 'error' && last.code === 'cancelled';
    const next = cancelled ? null : continueInterrupted(this.ledger);
    if (next !== null) {
      const plan = buildPlan({
        thought: next.thought,
        thoughtId: firstId,
        snapshot,
        expiresAfterTicks: this.options.expiresAfterTicks,
      });
      const ack = await this.submitChecked(plan, firstId, tick, snappedAt);
      if (ack !== null) {
        this.noteRefusal(firstId, ack);
        if (ack.accepted) this.ledger.markResubmitted(next.resumedIntentId);
        return this.finish(
          cycle,
          ack.accepted ? 'fallback_continue' : 'fallback_hold',
          firstId,
          plan,
          ack,
        );
      }
    }
    return this.finish(cycle, cause, firstId, null, null);
  }

  /** One model call with its admission, validation and journal row. */
  private async attempt(
    cycle: Cycle,
    thoughtId: string,
    wakeReason: string,
    messages: ModelMessage[],
  ): Promise<Attempt> {
    const reservation = this.deps.admission.reserve(THOUGHT_COST);
    if (reservation === null) return { kind: 'tired' };
    const shape = jobShape(cycle.effort.level, this.options.thought);
    cycle.calls++;
    const call = (): Promise<ModelCompletion> =>
      this.deps.model.complete(
        {
          model: this.options.model,
          messages,
          maxTokens: shape.maxTokens,
          temperature: this.options.thought.temperature,
          deadline: new Date(this.now() + shape.deadlineS * 1000),
          responseSchema: cycle.render.responseSchema,
          reasoning: shape.reasoning,
          effort: cycle.effort.level,
          stablePrefixChars: cycle.render.stablePrefixChars,
        },
        this.abort.signal,
      );
    let completion: ModelCompletion;
    try {
      completion = await callWaitingForThinker(call, {
        model: this.options.model,
        lifeId: this.options.lifeId,
        waitMs: this.options.thinkerWaitMs ?? 0,
        awaitThinker: this.deps.awaitThinker,
        signal: this.abort.signal,
        log: (line) => this.log(line),
      });
    } catch (error) {
      const code = error instanceof ModelError ? error.code : 'internal';
      reservation.release();
      cycle.errorCode = code;
      await this.record(cycle, thoughtId, wakeReason, messages, null, null, THOUGHT_COST, 0, code);
      return { kind: 'error', code };
    }
    reservation.settle();
    cycle.latencyMs += completion.latencyMs;
    cycle.thinkerId = completion.thinkerId;
    const parsed = this.deps.validator.parseThought(completion.text);
    const value = parsed.ok ? parsed.value : null;
    await this.record(
      cycle,
      thoughtId,
      wakeReason,
      messages,
      completion,
      value,
      THOUGHT_COST,
      THOUGHT_COST,
    );
    if (parsed.ok) return { kind: 'ok', thought: parsed.value, completion };
    return { kind: 'invalid', errors: parsed.errors, completion };
  }

  private log(line: Record<string, unknown>): void {
    this.deps.log?.(line);
  }

  private iso(): string {
    return new Date(this.now()).toISOString();
  }

  /** Embeds the wake and searches the episodic memories; memory is best effort, so a failure gives none. */
  private async retrieve(decision: WakeDecision, snapshot: Snapshot) {
    const query = [
      decision.reason,
      snapshot.current_plan?.goal ?? '',
      ...snapshot.heard.map((h) => h.text),
    ]
      .join(' ')
      .slice(0, 512);
    try {
      const [vector] = await this.deps.embedder.embed([query], 'query');
      if (vector === undefined) return [];
      return await this.deps.memory.searchEpisodic(
        this.options.lifeId,
        vector,
        this.options.episodicTopK,
      );
    } catch {
      return [];
    }
  }

  /** Checks the plan's expiry first: a plan that would expire on the way is refused, not sent. */
  private async submitChecked(
    plan: PlanMessage,
    thoughtId: string,
    snapshotTick: number,
    snappedAt: number,
  ): Promise<PlanAck | null> {
    if (planExpiredBy(plan, snapshotTick, this.now() - snappedAt)) return expiredRefusal(thoughtId);
    return this.submit(plan);
  }

  /**
   * Sends the plan. An ack that times out is sent once more (the Body dedupes by thought id). A
   * plan the contract rejects, or a Body that stays unreachable, gives null.
   */
  private async submit(plan: PlanMessage): Promise<PlanAck | null> {
    const checked = validatePlanMessage(plan);
    if (!checked.ok) {
      reportFailure(this.report, new Error('invalid plan'), 'invalid_plan', {
        thought_id: plan.thought_id,
      });
      return null;
    }
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.deps.body.submitPlan(plan);
      } catch (error) {
        if (!(error instanceof BodyLinkError)) throw error;
        if (error.code !== 'timeout' || attempt >= 2) {
          reportFailure(this.report, error, error.code, { thought_id: plan.thought_id });
          return null;
        }
        this.log({
          event: 'plan_submit_retry',
          life_id: this.options.lifeId,
          thought_id: plan.thought_id,
          error_code: error.code,
        });
      }
    }
  }

  /** A refused plan is logged with its reason; the rejection's detail text stays out of the log. */
  private noteRefusal(thoughtId: string, ack: PlanAck): void {
    if (ack.accepted) return;
    this.log({
      event: 'plan_refused',
      life_id: this.options.lifeId,
      thought_id: thoughtId,
      reason: ack.rejection?.reason ?? 'unspecified',
    });
  }

  private async recordNoCall(cycle: Cycle, thoughtId: string): Promise<void> {
    await this.record(cycle, thoughtId, cycle.decision.reason, null, null, null, 0, 0);
  }

  /** Writes one `thoughts` row; a failed write is counted and reported, never thrown. */
  private async record(
    cycle: Cycle,
    thoughtId: string,
    wakeReason: string,
    messages: ModelMessage[] | null,
    completion: ModelCompletion | null,
    parsed: Thought | null,
    reserved: number,
    settled: number,
    errorCode?: string,
  ): Promise<void> {
    const row = buildThoughtRow({
      ...(errorCode === undefined ? {} : { errorCode }),
      thoughtId,
      snapshot: cycle.snapshot,
      wakeReason,
      messages,
      templateVersion: cycle.render.templateVersion,
      versions: this.options.versions,
      modelConfig: this.options.modelConfig,
      effort: cycle.effort.level,
      completion,
      parsed,
      creditsReserved: reserved,
      creditsSettled: settled,
      at: this.iso(),
    });
    if (!(await writeThoughtRow(this.deps.journal, row, thoughtId, this.report))) {
      cycle.journalErrors++;
    }
  }

  /** The last step of a cycle: link the accepted intent, log, publish the `thought` event. */
  private async finish(
    cycle: Cycle,
    outcome: ThoughtOutcome,
    thoughtId: string,
    plan: PlanMessage | null,
    ack: PlanAck | null,
  ): Promise<LoopResult> {
    // Only an accepted plan has an intent the Body will run: a refused one has none to report.
    const intentId = ack?.accepted === true ? (plan?.intent_id ?? null) : null;
    if (intentId !== null) this.links.link(intentId, thoughtId, this.abort.signal);
    this.log({
      event: 'thought_outcome',
      life_id: this.options.lifeId,
      thought_id: thoughtId,
      wake_reason: cycle.decision.reason,
      outcome,
      ...(cycle.errorCode === undefined ? {} : { error_code: cycle.errorCode }),
      latency_ms: Math.round(cycle.latencyMs),
    });
    const event = buildThoughtEvent({
      thoughtId,
      snapshot: cycle.snapshot,
      wakeReason: cycle.decision.reason,
      outcome,
      latencyMs: cycle.latencyMs,
      modelConfig: this.options.modelConfig,
      effort: cycle.effort.level,
      thinkerId: cycle.thinkerId,
      intentId,
      at: this.iso(),
    });
    await publishThoughtEvent(this.deps.events, event, thoughtId, this.report);
    return {
      outcome,
      thoughtId,
      plan,
      ack,
      effort: cycle.effort,
      modelCalls: cycle.calls,
      journalErrors: cycle.journalErrors,
    };
  }
}
