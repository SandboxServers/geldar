import type { Action, ActionRecord, Thought } from '@geldar/contract';
import { validateThought } from '@geldar/contract';
import { errorText } from '../actions/outcome.ts';
import type { ActionRun } from '../actions/registry.ts';
import { runPlanAction } from './executor-action.ts';
import { startIntentRun } from './executor-intent.ts';
import { blockOperationsOf, type LimitTracker } from './limits.ts';
import { builtinPreconditions, type PreconditionRegistry } from './preconditions.ts';
import type { IntentProgram, ProgramCheckpoint, ProgramContext, StepResult } from './program.ts';
import type { IntentState } from './records.ts';
import type { BodyRuntime, TickSource } from './runtime.ts';
import {
  checkValidity,
  DEFAULT_SNAPSHOT_WINDOW,
  type PlanIdentity,
  type Rejection,
} from './validity.ts';
import type { WakeReason } from './wake.ts';
import type { WakeConditions, WakeTap } from './wake-conditions.ts';

type Intent = NonNullable<Thought['intent']>;

/** Most actions a thought may carry (the contract's `maxItems`). */
export const MAX_ACTIONS = 6;
/** Default number of settled action ids the executor remembers for duplicate delivery. */
export const DEFAULT_REMEMBERED_ACTIONS = 4096;

/**
 * The identity a delivered plan carries around its thought (spec section 7). The thought itself
 * has no ids; the Mind's dispatch adds them: one `intent_id`, one `action_id` per action in order.
 */
export interface PlanEnvelope extends PlanIdentity {
  sourceSnapshotId: string;
  /** Required when the thought has an `intent`. */
  intentId?: string;
  /** One id per entry of the thought's `actions`, in order. */
  actionIds: readonly string[];
}

/** An action as the executor reports it: its final record, and whether it was a duplicate delivery. */
export interface ActionReport {
  record: ActionRecord;
  /** True when the action id was already known: nothing ran, `record` is the stored one. */
  duplicate: boolean;
}

/** What became of the thought's intent. */
export type IntentDisposition =
  | 'none'
  | 'started'
  /** The intent id is already known: nothing changed. */
  | 'duplicate'
  /** An action failed or the plan was refused part way, so the intent never started. */
  | 'skipped'
  | 'unsupported_program'
  | 'precondition_failed'
  | 'invalid_arguments';

/** The result of `submit`. */
export interface SubmitResult {
  /** Set when the plan (or, part way through the list, its remaining part) was refused. */
  rejection: Rejection | null;
  actions: ActionReport[];
  /** Index of the first action that did not complete, or null. */
  failedAt: number | null;
  intent: IntentDisposition;
}

/** What an `IntentExecutor` is built from. */
export interface ExecutorOptions {
  runtime: BodyRuntime;
  /** Drives the intent: the same world ticks the runtime uses. */
  ticks: TickSource;
  /** The Body's current snapshot revision, read at validation time. */
  currentRevision: () => number;
  /** How far behind the current revision a plan may be. Default `DEFAULT_SNAPSHOT_WINDOW` (2). */
  snapshotWindow?: number;
  /** Default: `builtinPreconditions()`. */
  preconditions?: PreconditionRegistry;
  /** The tap the runtime's sink is, so a reflex wake stops the intent from resuming. */
  wakeTap?: WakeTap;
  /** Names of the other agents within `radius` blocks, for `new_agent_within_N`. Default: none seen. */
  nearbyAgents?: (radius: number) => string[];
  now?: () => Date;
  /** How many action ids to remember for duplicate delivery. Default 4096; the oldest is dropped. */
  maxRememberedActions?: number;
}

/** One running intent. `executor-intent.ts` builds it; the executor drives it. */
export interface ActiveIntent {
  id: string;
  program: IntentProgram;
  base: Omit<ProgramContext, 'signal'>;
  /** Aborted when the intent ends. */
  controller: AbortController;
  /** Aborted to pause or cancel the step in flight; replaced for each step. */
  stepController: AbortController | null;
  limits: LimitTracker;
  wake: WakeConditions;
  preconditions: readonly string[];
  state: IntentState;
  pause: 'reflex' | 'actions' | null;
  stepping: Promise<void> | null;
  ended: boolean;
  /** A reflex ran or paused the intent since the step started: a failed step result is not trusted. */
  interrupted: boolean;
  /** A reflex raised a wake: do not resume. */
  reflexWoke: boolean;
}

/**
 * The Body's executor (spec 5.3, section 7). `submit` takes a thought and its envelope: it checks
 * validity, runs the immediate actions in order (at most 6; the first failure stops the list and
 * wakes the Mind with `action_failed`), then replaces the current intent with the thought's one.
 * Every action and intent state change goes to the runtime's sink; an action id is never run twice.
 * Between ticks the intent steps its program, watches its limits and `wake_on`, and pauses while a
 * reflex runs.
 */
export class IntentExecutor {
  private readonly runtime: BodyRuntime;
  private readonly ticks: TickSource;
  private readonly currentRevision: () => number;
  private readonly window: number;
  private readonly preconditions: PreconditionRegistry;
  private readonly agents: (radius: number) => string[];
  private readonly now: () => Date;
  private readonly maxRemembered: number;
  private readonly stored = new Map<string, Promise<ActionReport>>();
  private readonly seenIntents = new Set<string>();
  private active: ActiveIntent | null = null;
  private unsubscribe: (() => void) | null = null;
  private readonly taps: Array<() => void> = [];

  constructor(options: ExecutorOptions) {
    this.runtime = options.runtime;
    this.ticks = options.ticks;
    this.currentRevision = options.currentRevision;
    this.window = options.snapshotWindow ?? DEFAULT_SNAPSHOT_WINDOW;
    this.preconditions = options.preconditions ?? builtinPreconditions();
    this.agents = options.nearbyAgents ?? (() => []);
    this.now = options.now ?? (() => new Date());
    this.maxRemembered = options.maxRememberedActions ?? DEFAULT_REMEMBERED_ACTIONS;
    if (options.wakeTap) {
      this.taps.push(
        options.wakeTap.onWake((request) => {
          if (request.reason === 'reflex_danger' && this.active) this.active.reflexWoke = true;
        }),
        options.wakeTap.onReflexFired(() => {
          if (this.active) this.active.interrupted = true;
        }),
      );
    }
  }

  /** The running intent's id, or null. */
  get intentId(): string | null {
    return this.active?.id ?? null;
  }

  /** The running intent's state, or null. */
  get intentState(): IntentState | null {
    return this.active?.state ?? null;
  }

  /** The running program's checkpoint, or null when none runs or it has nothing to save. */
  checkpoint(): ProgramCheckpoint | null {
    return this.active?.program.checkpoint() ?? null;
  }

  /** Subscribes to world ticks. A second call is a no-op. */
  start(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = this.ticks((tick) => {
      this.onTick(tick).catch((error: unknown) => {
        console.warn(`executor tick failed: ${errorText(error)}`);
      });
    });
  }

  /** Unsubscribes and ends the running intent as `interrupted`. */
  async stop(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = null;
    for (const remove of this.taps.splice(0)) remove();
    if (this.active) await this.end(this.active, 'interrupted', 'body stopped');
  }

  /** Counts block operations (mining, placing) done for the running intent against its limit. */
  noteBlockOperations(count: number): void {
    this.active?.limits.addBlockOperations(count);
  }

  /**
   * Tells the executor an action ended: a completed action a program ran for the running intent
   * counts its block operations (mine, place, uild) against the intent's limit. An action a
   * reflex or an immediate plan action ran, while the intent is paused, is not the intent's.
   */
  noteAction(action: Action, run: ActionRun): void {
    const a = this.active;
    if (run.state !== 'completed' || !a || a.pause !== null || a.stepping === null) return;
    a.limits.addBlockOperations(blockOperationsOf(action));
  }
  /** Someone spoke to the Body. Wakes the Mind when the intent lists `directly_addressed`. */
  async notifyAddressed(from: string): Promise<boolean> {
    const a = this.active;
    if (!a?.wake.wants('directly_addressed')) return false;
    await this.interruptForWake(a, 'directly_addressed', `addressed by ${from}`);
    return true;
  }

  /** Accepts one thought: its actions, then its intent. Never throws for a bad plan. */
  async submit(thought: unknown, plan: PlanEnvelope): Promise<SubmitResult> {
    const verdict = validateThought(thought);
    const refuse = (detail: string): SubmitResult => ({
      rejection: { reason: 'invalid_plan', detail },
      actions: [],
      failedAt: null,
      intent: 'none',
    });
    if (!verdict.ok) return refuse(verdict.errors[0] ?? 'thought is not valid');
    const { actions = [], intent } = verdict.value;
    if (plan.actionIds.length !== actions.length) {
      return refuse(`${actions.length} actions but ${plan.actionIds.length} action ids`);
    }
    if (intent && !plan.intentId) return refuse('an intent needs an intent id');

    const freshAction = plan.actionIds.some((id) => !this.stored.has(id));
    const freshIntent = intent !== undefined && !this.seenIntents.has(plan.intentId ?? '');
    if (freshAction || freshIntent) {
      const rejection = this.validate(plan);
      if (rejection) return { rejection, actions: [], failedAt: null, intent: 'none' };
    }

    const reports: ActionReport[] = [];
    let failedAt: number | null = null;
    let rejection: Rejection | null = null;
    const paused = actions.length > 0 ? await this.pauseForActions() : null;
    try {
      for (const [index, action] of actions.entries()) {
        const id = plan.actionIds[index] as string;
        if (!this.stored.has(id)) {
          rejection = this.validate(plan);
          if (rejection) break;
        }
        const report = await this.runOne(action, id, index, plan);
        reports.push(report);
        if (report.record.state !== 'completed') {
          failedAt = index;
          break;
        }
      }
    } finally {
      if (paused) await this.resumeFromActions(paused);
    }
    const stopped = failedAt !== null || rejection !== null;
    if (failedAt !== null) {
      this.runtime.sink.wake({
        reason: 'action_failed',
        tick: this.tick(),
        intentId: null,
        detail: `action ${failedAt} (${actions[failedAt]?.do}) did not complete`,
      });
    }
    let disposition: IntentDisposition = 'none';
    if (intent) disposition = stopped ? 'skipped' : await this.startIntent(intent, plan);
    return { rejection, actions: reports, failedAt, intent: disposition };
  }

  /**
   * One world tick: counts limits, pauses or resumes around a reflex, watches `wake_on`, and
   * starts the next program step. Resolves when this tick's step has ended.
   */
  async onTick(tick: number): Promise<void> {
    const a = this.active;
    if (!a || a.ended || a.pause === 'actions') return;
    a.limits.observeTick(tick);
    const limit = a.limits.exceeded();
    if (limit) {
      await this.end(a, 'failed', `${limit} reached`, 'limit_reached');
      return;
    }
    if (this.runtime.reflexRunner.busy) {
      await this.pauseForReflex(a);
      return;
    }
    if (a.pause === 'reflex') {
      if (a.reflexWoke) {
        await this.end(a, 'interrupted', 'a reflex woke the Mind');
        return;
      }
      a.pause = null;
      this.setState(a, 'running');
    } else if (a.reflexWoke) {
      await this.end(a, 'interrupted', 'a reflex woke the Mind');
      return;
    }
    const fired = this.watch(a);
    if (fired) {
      await this.interruptForWake(a, fired.reason, fired.detail);
      return;
    }
    if (!a.stepping) {
      const run = this.runStep(a).finally(() => {
        if (a.stepping === run) a.stepping = null;
      });
      a.stepping = run;
    }
    await a.stepping;
  }

  private tick(): number {
    return this.runtime.view.tick ?? 0;
  }

  private validate(plan: PlanIdentity): Rejection | null {
    return checkValidity(
      plan,
      {
        lifeId: this.runtime.lifeId,
        bodyGeneration: this.runtime.bodyGeneration,
        currentRevision: this.currentRevision(),
        tick: this.tick(),
      },
      this.window,
    );
  }

  private setState(a: ActiveIntent, state: IntentState, detail?: string): void {
    a.state = state;
    this.runtime.sink.intentChanged({
      intentId: a.id,
      lifeId: this.runtime.lifeId,
      bodyGeneration: this.runtime.bodyGeneration,
      state,
      tick: this.tick(),
      ...(detail === undefined ? {} : { detail }),
    });
  }

  /** Ends an intent once: aborts its step, records the state, and wakes the Mind if asked. */
  private async end(
    a: ActiveIntent,
    state: IntentState,
    detail: string,
    wake?: WakeReason,
    fromStep = false,
  ): Promise<void> {
    if (a.ended) return;
    a.ended = true;
    if (this.active === a) this.active = null;
    a.controller.abort();
    a.stepController?.abort();
    await this.runtime.cancelAction();
    // A step that ends its own intent is the step in flight: waiting for it would wait forever.
    if (!fromStep) await a.stepping;
    this.setState(a, state, detail);
    if (wake) {
      this.runtime.sink.wake({ reason: wake, tick: this.tick(), intentId: a.id, detail });
    }
  }

  private interruptForWake(a: ActiveIntent, reason: WakeReason, detail: string): Promise<void> {
    return this.end(a, 'interrupted', detail, reason);
  }

  private watch(a: ActiveIntent): { reason: WakeReason; detail: string } | null {
    const sample = { health: this.runtime.view.health, agentsWithin: this.agents };
    const seen = a.wake.watch(sample);
    if (seen) return seen;
    if (a.wake.wants('precondition_failed')) {
      const verdict = this.preconditions.evaluate(a.preconditions, this.runtime.view);
      if (!verdict.ok) return { reason: 'precondition_failed', detail: `${verdict.name} failed` };
    }
    return null;
  }

  private async pauseForReflex(a: ActiveIntent): Promise<void> {
    if (a.pause === null) {
      a.pause = 'reflex';
      a.interrupted = true;
      this.setState(a, 'paused', 'reflex running');
    }
    a.stepController?.abort();
    await a.stepping;
  }

  /** Pauses the running intent, if any, so the immediate actions have the Body to themselves. */
  private async pauseForActions(): Promise<ActiveIntent | null> {
    const a = this.active;
    if (!a || a.ended) return null;
    a.pause = 'actions';
    a.interrupted = true;
    this.setState(a, 'paused', 'immediate actions running');
    a.stepController?.abort();
    await a.stepping;
    await this.runtime.cancelAction();
    return a;
  }

  private async resumeFromActions(a: ActiveIntent): Promise<void> {
    if (a.ended || a.pause !== 'actions') return;
    a.pause = null;
    this.setState(a, 'running', 'immediate actions done');
  }

  private async runStep(a: ActiveIntent): Promise<void> {
    const controller = new AbortController();
    const forward = (): void => controller.abort();
    a.controller.signal.addEventListener('abort', forward, { once: true });
    a.stepController = controller;
    a.interrupted = false;
    let result: StepResult;
    try {
      result = await a.program.step({ ...a.base, signal: controller.signal });
    } catch (error) {
      result = { status: 'failed', message: errorText(error) };
    } finally {
      a.controller.signal.removeEventListener('abort', forward);
      if (a.stepController === controller) a.stepController = null;
    }
    if (a.ended) return;
    if (result.status === 'failed' && (a.interrupted || controller.signal.aborted)) return;
    if (result.status === 'running') return;
    if (result.status === 'completed') {
      const wake = a.wake.wants('goal_completed') ? 'goal_completed' : undefined;
      await this.end(a, 'completed', 'goal completed', wake, true);
    } else if (result.status === 'failed') {
      await this.end(a, 'failed', result.message, 'action_failed', true);
    } else {
      await this.end(a, 'interrupted', result.message ?? result.reason, result.reason, true);
    }
  }

  private startIntent(intent: Intent, plan: PlanEnvelope): Promise<IntentDisposition> {
    const id = plan.intentId as string;
    if (this.seenIntents.has(id)) return Promise.resolve('duplicate');
    this.seenIntents.add(id);
    return startIntentRun(
      {
        runtime: this.runtime,
        preconditions: this.preconditions,
        agents: this.agents,
        tick: () => this.tick(),
        setState: (a, state, detail) => this.setState(a, state, detail),
        end: (a, state, detail, wake) => this.end(a, state, detail, wake),
        current: () => this.active,
        install: (a) => {
          this.active = a;
        },
      },
      intent,
      id,
    );
  }

  private runOne(
    action: NonNullable<Thought['actions']>[number],
    actionId: string,
    sequence: number,
    plan: PlanEnvelope,
  ): Promise<ActionReport> {
    const known = this.stored.get(actionId);
    if (known) return known.then((report) => ({ ...report, duplicate: true }));
    const run = runPlanAction(this.runtime, this.now, action, actionId, sequence, plan);
    this.stored.set(actionId, run);
    while (this.stored.size > this.maxRemembered) {
      const oldest = this.stored.keys().next().value;
      if (oldest === undefined) break;
      this.stored.delete(oldest);
    }
    return run;
  }
}
