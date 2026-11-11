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
 *
 * The model call and the memory search and thought-row write it uses live in `thought-attempt.ts`
 * and `thought-store.ts`; they run on the `LoopEnv` this class builds.
 */
import type { PlanAck, PlanMessage, Snapshot } from '@geldar/contract';
import { newId } from '../ids.ts';
import type { MindEvent, ThoughtOutcome, WakeDecision } from '../ports/index.ts';
import { bounded, CycleAborted, STEP_TIMEOUT_MS } from './cycle-await.ts';
import type { Cycle } from './cycle-state.ts';
import { chooseEffort, isRepeatedFailureWake } from './effort.ts';
import { continueInterrupted, IntentLedger } from './fallback.ts';
import { IntentLinker } from './intent-link.ts';
import type { LoopEnv } from './loop-env.ts';
import { type LoopOptions, loopOptionsFromConfig } from './loop-options.ts';
import type { LoopDeps, LoopResult } from './loop-types.ts';
import { buildPlan } from './plan.ts';
import { isStaleRefusal, noteRefusal, type SubmitContext, submitChecked } from './plan-submit.ts';
import { requestSnapshotWithRetry, sleepFor } from './snapshot-retry.ts';
import { attemptThought } from './thought-attempt.ts';
import {
  buildThoughtEvent,
  type FailureReport,
  publishThoughtEvent,
  recordLostWake,
  reportFailure,
} from './thought-journal.ts';
import { recordThought, retrieveEpisodic } from './thought-store.ts';
import { withinLimit } from './within-limit.ts';

export type { LoopVersions } from './journal-row.ts';

/** The `thoughts.wake_reason` of the second call of a cycle. */
export const CORRECTIVE_RETRY = 'corrective_retry';

/** The loop options, the ports and the results, re-exported for the callers that build the loop. */
export { type LoopDeps, type LoopOptions, type LoopResult, loopOptionsFromConfig };

/** The thinking loop of one life. */
export class ThinkingLoop {
  private readonly deps: LoopDeps;
  private readonly options: LoopOptions;
  private readonly ledger: IntentLedger;
  private readonly now: () => number;
  private readonly abort = new AbortController();
  private readonly report: FailureReport;
  private previousReason: string | null = null;
  private startedAt = 0;
  private readonly links: IntentLinker;
  private readonly submitCtx: SubmitContext;
  private readonly env: LoopEnv;

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
    this.submitCtx = {
      body: deps.body,
      lifeId: options.lifeId,
      tickMs: 1000 / options.tickRate,
      stepMs: this.stepMs,
      now: this.now,
      report: this.report,
      log: (line) => this.log(line),
    };
    this.env = {
      deps,
      options,
      report: this.report,
      stepMs: this.stepMs,
      signal: this.abort.signal,
      now: () => this.now(),
      at: () => this.iso(),
      elapsed: () => this.elapsed(),
      log: (line) => this.log(line),
    };
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
    this.startedAt = this.now();
    this.deps.attention.thoughtStarted();
    let result: LoopResult;
    try {
      // Inside the try: a log sink that throws still settles the thought it started.
      this.log({
        event: 'thought_started',
        life_id: this.options.lifeId,
        wake_reason: decision.reason,
      });
      result = await this.run(decision);
    } catch (error) {
      // A step that hung ends the cycle with its closed reason; any other throw is `error`.
      const reason = error instanceof CycleAborted ? error.reason : 'error';
      this.log({
        event: 'cycle_aborted',
        life_id: this.options.lifeId,
        wake_reason: decision.reason,
        reason,
        elapsed_ms: this.elapsed(),
      });
      reportFailure(this.report, error, 'cycle_failed');
      // The wake is still on record, as a lost wake; a hung journal here must not reject the cycle.
      if (error instanceof CycleAborted) {
        await bounded(
          recordLostWake(this.deps.journal, decision.reason, this.iso(), this.report),
          this.stepMs,
          'journal',
        ).catch(() => undefined);
      }
      // A send that hung means the Body never got the plan: the thought settles as a fallback hold.
      result = {
        outcome: reason === 'plan_submit' ? 'fallback_hold' : 'model_error',
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
    const snapshotBudget = this.options.snapshotRetryMs ?? 0;
    const raw = await bounded(
      requestSnapshotWithRetry(decision.reason.slice(0, 64), {
        body: this.deps.body,
        lifeId: this.options.lifeId,
        budgetMs: snapshotBudget,
        sleep: this.deps.sleep ?? sleepFor,
        signal: this.abort.signal,
        log: (line) => this.log(line),
      }),
      snapshotBudget + this.stepMs,
      'snapshot',
    );
    if (raw === null) {
      await bounded(
        recordLostWake(this.deps.journal, decision.reason, this.iso(), this.report),
        this.stepMs,
        'journal',
      );
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
    this.log({
      event: 'snapshot_ok',
      life_id: this.options.lifeId,
      wake_reason: decision.reason,
      elapsed_ms: this.elapsed(),
    });
    const { lifeId } = this.options;
    const tick = raw.world_time.ticks;

    // 2. The profile and the memory.
    const load = bounded(this.deps.memory.loadDeterministic(lifeId, tick), this.stepMs, 'memory');
    const memory = await withinLimit(load, this.options.memoryTimeoutMs, () =>
      this.log({
        event: 'memory_load_timeout',
        life_id: lifeId,
        error_code: 'timeout',
      }),
    );
    // A life with no sleep and no birth day counts from now, not from day 0 of the world; its first
    // thought fixes that day as its birth day, so the tiredness clock starts there.
    if (memory.agent.bornDay === null)
      await bounded(this.deps.memory.setBornDay(lifeId, raw.world_time.day), this.stepMs, 'memory');
    const lastSleep = memory.agent.lastSleepDay ?? memory.agent.bornDay ?? raw.world_time.day;
    const snapshot: Snapshot = {
      ...raw,
      self: {
        ...raw.self,
        budget_remaining_thoughts: this.deps.admission.remaining(),
        days_since_sleep: Math.max(0, raw.world_time.day - lastSleep),
      },
    };
    const episodic = await retrieveEpisodic(this.env, decision, snapshot);
    const since = Math.max(0, tick - 24_000);
    const recentRows = await bounded(
      this.deps.journal.journalSince(lifeId, since),
      this.stepMs,
      'journal',
    );
    const recent = recentRows.slice(-this.options.workingWindow);

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
    const first = await attemptThought(this.env, cycle, firstId, decision.reason, render.messages);
    let finalId = firstId;
    let last = first;
    if (first.kind === 'invalid') {
      const retryId = newId('th');
      const messages = [
        ...render.messages,
        this.deps.validator.correctiveMessage(first.errors, first.completion.text),
      ];
      last = await attemptThought(this.env, cycle, retryId, CORRECTIVE_RETRY, messages);
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
      const ack = await submitChecked(this.submitCtx, plan, finalId, tick, snappedAt);
      if (ack === null) return this.finish(cycle, 'fallback_hold', finalId, null, null);
      noteRefusal(this.submitCtx, finalId, ack);
      if (!ack.accepted && !retried && isStaleRefusal(ack)) {
        return this.rethink(decision, cycle, finalId, ack.rejection?.reason ?? 'unspecified');
      }
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
      const ack = await submitChecked(this.submitCtx, plan, firstId, tick, snappedAt);
      if (ack !== null) {
        noteRefusal(this.submitCtx, firstId, ack);
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

  private log(line: Record<string, unknown>): void {
    this.deps.log?.(line);
  }

  private iso(): string {
    return new Date(this.now()).toISOString();
  }

  /** Milliseconds since the current cycle started, from the injected clock. */
  private elapsed(): number {
    return Math.max(0, this.now() - this.startedAt);
  }

  /** The limit of one step that waits on a dependency. */
  private get stepMs(): number {
    return this.options.stepTimeoutMs ?? STEP_TIMEOUT_MS;
  }

  /**
   * The single re-think after a stale or expired refusal: a second cycle from a fresh snapshot. Its
   * result also carries the first cycle's model calls and journal errors, so the counts add up.
   */
  private async rethink(
    decision: WakeDecision,
    first: Cycle,
    oldThoughtId: string,
    reason: string,
  ): Promise<LoopResult> {
    const second = await this.run(decision, true);
    this.log({
      event: 'thought_rethink',
      life_id: this.options.lifeId,
      old_thought_id: oldThoughtId,
      new_thought_id: second.thoughtId,
      reason,
    });
    return {
      ...second,
      modelCalls: second.modelCalls + first.calls,
      journalErrors: second.journalErrors + first.journalErrors,
    };
  }

  private async recordNoCall(cycle: Cycle, thoughtId: string): Promise<void> {
    await recordThought(this.env, cycle, thoughtId, cycle.decision.reason, null, null, null, 0, 0);
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
    this.log({
      event: 'thought_committed',
      life_id: this.options.lifeId,
      thought_id: thoughtId,
      outcome,
      elapsed_ms: this.elapsed(),
    });
    // The plan is already committed, so a hung event publish is logged and the outcome stands.
    try {
      await bounded(
        publishThoughtEvent(this.deps.events, event, thoughtId, this.report),
        this.stepMs,
        'publish',
      );
    } catch (error) {
      if (!(error instanceof CycleAborted)) throw error;
      this.log({
        event: 'cycle_aborted',
        life_id: this.options.lifeId,
        wake_reason: cycle.decision.reason,
        reason: error.reason,
        elapsed_ms: this.elapsed(),
      });
    }
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
