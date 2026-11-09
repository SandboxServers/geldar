/**
 * The thinking loop (spec 5.3.4): for each wake decision, from the snapshot to the plan the Body
 * receives. Every collaborator is injected as a port, so the loop runs on fakes. One decision at a
 * time: the attention controller allows one in-flight thought per agent, and `thoughtStarted` and
 * `thoughtSettled` bracket every cycle.
 *
 * Outcome of a cycle (`ThoughtOutcome`): `planned` when the model's thought went to the Body;
 * `fallback_continue` when the model failed and the last interrupted intent was resubmitted;
 * otherwise the cause when nothing was submitted: `tired` (admission refused), `model_error` or
 * `invalid_output` (twice), or `fallback_hold` when the plan could not be delivered to the Body.
 */
import {
  type PlanAck,
  type PlanMessage,
  type Snapshot,
  type Thought,
  validatePlanMessage,
  type WorldEvent,
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
import {
  chooseEffort,
  type Effort,
  type EffortChoice,
  isRepeatedFailureWake,
  jobShape,
} from './effort.ts';
import { continueInterrupted, IntentLedger } from './fallback.ts';
import { buildThoughtRow, type LoopVersions } from './journal-row.ts';
import { buildPlan } from './plan.ts';

export type { LoopVersions } from './journal-row.ts';

/** The `thoughts.wake_reason` of the second call of a cycle. */
export const CORRECTIVE_RETRY = 'corrective_retry';

/** What the loop reads from the configuration and the build. */
export interface LoopOptions {
  /** The life the loop thinks for. */
  lifeId: string;
  /** The model tag, fixed for the life. */
  model: string;
  /** The pinned model configuration, recorded on every thought (at most 256 characters). */
  modelConfig: string;
  versions: LoopVersions;
  thought: JobSettings;
  /** `mind.plan.expires_after_ticks`. */
  expiresAfterTicks: number;
  /** How many recent thoughts the prompt gets. */
  workingWindow: number;
  /** How many episodic memories to retrieve. */
  episodicTopK: number;
}

/** The loop's options from the loaded configuration; `bodyVersion` is the Body build's version. */
export function loopOptionsFromConfig(config: AnimusConfig, versions: LoopVersions): LoopOptions {
  const model = config.models[config.runTier]?.[0];
  if (model === undefined) throw new Error(`no model for the run tier ${config.runTier}`);
  const pin = config.modelPins[model];
  if (pin === undefined) throw new Error(`no model pin for ${model}`);
  const modelConfig =
    `${model}@${pin.digest};num_ctx=${pin.numCtx};temperature=${config.thought.temperature}`.slice(
      0,
      256,
    );
  return {
    lifeId: config.agent.username,
    model,
    modelConfig,
    versions,
    thought: config.thought,
    expiresAfterTicks: config.plan.expiresAfterTicks,
    workingWindow: config.memory.workingWindow,
    episodicTopK: config.memory.episodicTopK,
  };
}

/** The ports and state the loop is built from. */
export interface LoopDeps {
  body: BodyLink;
  model: ModelClient;
  memory: MemoryStore;
  journal: Journal;
  embedder: Embedder;
  prompts: PromptLibrary;
  validator: OutputValidator;
  attention: AttentionController;
  events: EventPublisher;
  /** Shared with the reflection, which spends 2 credits per run. */
  admission: Admission;
  /** Absent means a fresh ledger; pass one to share it with whoever feeds the Body's events. */
  ledger?: IntentLedger;
  /** Wall clock in milliseconds; defaults to `Date.now`. */
  now?: () => number;
}

/** What one cycle did. */
export interface LoopResult {
  outcome: ThoughtOutcome;
  /** The id the cycle's plan or event carries; null when there was no snapshot. */
  thoughtId: string | null;
  plan: PlanMessage | null;
  /** The Body's answer to the plan, null when none was submitted. */
  ack: PlanAck | null;
  effort: EffortChoice | null;
  /** Model calls made (0 to 2). */
  modelCalls: number;
  /** Journal writes that failed; the cycle carries on. */
  journalErrors: number;
  /** Set when no snapshot could be had, so there was nothing to think about. */
  skipped?: 'snapshot_unavailable';
}

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
}

/** The thinking loop of one life. */
export class ThinkingLoop {
  private readonly deps: LoopDeps;
  private readonly options: LoopOptions;
  private readonly ledger: IntentLedger;
  private readonly now: () => number;
  private readonly abort = new AbortController();
  private previousReason: string | null = null;

  constructor(deps: LoopDeps, options: LoopOptions) {
    this.deps = deps;
    this.options = options;
    this.ledger = deps.ledger ?? new IntentLedger();
    this.now = deps.now ?? Date.now;
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
    } catch {
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

  private async run(decision: WakeDecision): Promise<LoopResult> {
    for (const event of [...decision.events, ...decision.digest]) this.ledger.observe(event);

    // 1. The snapshot, with the budget and the sleep counter set.
    let raw: Snapshot;
    try {
      raw = await this.deps.body.requestSnapshot(decision.reason.slice(0, 64));
    } catch (error) {
      if (!(error instanceof BodyLinkError)) throw error;
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
    const { lifeId } = this.options;
    const tick = raw.world_time.ticks;

    // 2. The profile and the memory.
    const memory = await this.deps.memory.loadDeterministic(lifeId, tick);
    const lastSleep = memory.agent.lastSleepDay ?? memory.agent.bornDay ?? 0;
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
      const messages = [...render.messages, this.deps.validator.correctiveMessage(first.errors, first.completion.text)];
      last = await this.attempt(cycle, retryId, CORRECTIVE_RETRY, messages);
      if (last.kind === 'ok') finalId = retryId;
    }
    if (first.kind === 'tired') await this.recordNoCall(cycle, firstId);

    // 8. A valid thought becomes the plan.
    if (last.kind === 'ok') {
      const plan = buildPlan({
        thought: last.thought,
        thoughtId: finalId,
        snapshot,
        expiresAfterTicks: this.options.expiresAfterTicks,
      });
      const sent = await this.submit(plan);
      const outcome: ThoughtOutcome = sent === null ? 'fallback_hold' : 'planned';
      return this.finish(cycle, outcome, finalId, sent === null ? null : plan, sent);
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
      const ack = await this.submit(plan);
      if (ack !== null) {
        if (ack.accepted) this.ledger.markResubmitted(next.resumedIntentId);
        return this.finish(cycle, 'fallback_continue', firstId, plan, ack);
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
    let completion: ModelCompletion;
    try {
      completion = await this.deps.model.complete(
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
    } catch (error) {
      reservation.release();
      await this.record(cycle, thoughtId, wakeReason, messages, null, null, THOUGHT_COST, 0);
      return { kind: 'error', code: error instanceof ModelError ? error.code : 'internal' };
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

  /** Sends the plan; a Body that cannot be reached gives null. */
  private async submit(plan: PlanMessage): Promise<PlanAck | null> {
    if (!validatePlanMessage(plan).ok) return null;
    try {
      return await this.deps.body.submitPlan(plan);
    } catch (error) {
      if (error instanceof BodyLinkError) return null;
      throw error;
    }
  }

  private async recordNoCall(cycle: Cycle, thoughtId: string): Promise<void> {
    await this.record(cycle, thoughtId, cycle.decision.reason, null, null, null, 0, 0);
  }

  /** Writes one `thoughts` row; a failed write is counted, never thrown. */
  private async record(
    cycle: Cycle,
    thoughtId: string,
    wakeReason: string,
    messages: ModelMessage[] | null,
    completion: ModelCompletion | null,
    parsed: Thought | null,
    reserved: number,
    settled: number,
  ): Promise<void> {
    const row = buildThoughtRow({
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
      at: new Date(this.now()).toISOString(),
    });
    try {
      await this.deps.journal.recordThought(row);
    } catch {
      cycle.journalErrors++;
    }
  }

  /** 9 and 10: publish the `thought` event and build the result. */
  private async finish(
    cycle: Cycle,
    outcome: ThoughtOutcome,
    thoughtId: string,
    plan: PlanMessage | null,
    ack: PlanAck | null,
  ): Promise<LoopResult> {
    const { snapshot } = cycle;
    const event: WorldEvent = {
      // The event id is the thought's ULID, so a redelivered event dedups.
      source_event_id: `ev_${thoughtId.slice(3)}`,
      at: new Date(this.now()).toISOString(),
      shard: snapshot.shard,
      world_day: snapshot.world_time.day,
      world_tick: snapshot.world_time.ticks,
      type: 'thought',
      agent_id: snapshot.agent_id,
      payload: {
        thought_id: thoughtId,
        wake_reason: cycle.decision.reason,
        outcome,
        latency_ms: Math.round(cycle.latencyMs),
        model_config: this.options.modelConfig,
        effort: cycle.effort.level satisfies Effort,
        intent_id: plan?.intent_id ?? null,
      },
    };
    if (cycle.thinkerId !== undefined) event.thinker_id = cycle.thinkerId;
    try {
      await this.deps.events.publish(event);
    } catch {
      // The thought is in the journal; a lost event must not stop the Mind.
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
