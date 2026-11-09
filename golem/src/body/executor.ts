import type { Action, Thought } from '@geldar/contract';
import { validateThought } from '@geldar/contract';
import { errorText } from '../actions/outcome.ts';
import type { ActionRun } from '../actions/registry.ts';
import { runPlanAction, waitForReflexIdle } from './executor-action.ts';
import { ABANDONED_KEY, type IntentStartMode, startIntentRun } from './executor-intent.ts';
import {
  type ActionReport,
  type ActiveIntent,
  DEFAULT_REMEMBERED_ACTIONS,
  type ExecutorOptions,
  type Intent,
  type IntentDisposition,
  type IntentObserver,
  type PlanEnvelope,
  type StepSnapshot,
  type SubmitResult,
} from './executor-types.ts';
import { blockOperationsDone } from './limits.ts';
import { builtinPreconditions, type PreconditionRegistry } from './preconditions.ts';
import type { ProgramCheckpoint, StepResult } from './program.ts';
import type { IntentState } from './records.ts';
import { dropBlockedReport, isBlockedAbandoned } from './reflexes/blocked-path.ts';
import type { BodyRuntime, TickSource } from './runtime.ts';
import {
  checkValidity,
  DEFAULT_SNAPSHOT_WINDOW,
  type PlanIdentity,
  type Rejection,
} from './validity.ts';
import type { WakeReason } from './wake.ts';

export * from './executor-types.ts';

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
  private readonly observer: IntentObserver | null;
  private active: ActiveIntent | null = null;
  private stopping = false;
  private plans = 0;
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
    this.observer = options.observer ?? null;
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

  /** How many thoughts submit has received: a restarted Body waits for the first. */
  get plansReceived(): number {
    return this.plans;
  }

  /** The running intent's state, or null. */
  get intentState(): IntentState | null {
    return this.active?.state ?? null;
  }

  /** The running program's checkpoint, or null when none runs or it has nothing to save. */
  checkpoint(): ProgramCheckpoint | null {
    return this.active ? this.savedCheckpoint(this.active) : null;
  }

  /** True when the running intent's program ran the action (a plan action or a reflex's is not its own). */
  ranByProgram(action: Action): boolean {
    return this.active?.ownActions.has(action) === true;
  }

  /** The program's checkpoint plus the abandoned flag when the blocked-path reflex gave up on this intent. */
  private savedCheckpoint(a: ActiveIntent): ProgramCheckpoint | null {
    const own = a.program.checkpoint();
    if (!this.abandoned(a)) return own;
    return { ...own, [ABANDONED_KEY]: true };
  }

  private abandoned(a: ActiveIntent): boolean {
    return a.resumedAbandoned || isBlockedAbandoned(this.runtime.view, a.id);
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
    this.stopping = true;
    for (const remove of this.taps.splice(0)) remove();
    if (this.active) await this.end(this.active, 'interrupted', 'body stopped');
  }

  /** Counts block operations (mining, placing) done for the running intent against its limit. */
  noteBlockOperations(count: number): void {
    this.active?.limits.addBlockOperations(count);
  }

  /**
   * Tells the executor an action ended: an action the running intent's program ran counts its
   * block operations (mine, place, build) against the intent's limit, and a mine that failed or
   * was cancelled counts the blocks it had already broken. An action a reflex or an immediate
   * plan action ran is not the intent's, however it overlaps the step.
   */
  noteAction(action: Action, run: ActionRun): void {
    const a = this.active;
    if (!a?.ownActions.has(action)) return;
    a.limits.addBlockOperations(blockOperationsDone(action, run));
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
    this.plans += 1;
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
    // A reflex that is busy has the Body: the plan's actions wait for it to end.
    // One that outlasts the bound is given up on for the whole plan, not waited for again per action.
    let gaveUp = actions.length > 0 && (await waitForReflexIdle(this.runtime));
    const paused = actions.length > 0 ? await this.pauseForActions() : null;
    try {
      for (const [index, action] of actions.entries()) {
        const id = plan.actionIds[index] as string;
        if (!this.stored.has(id)) {
          rejection = this.validate(plan);
          if (rejection) break;
        }
        // A reflex may have started since the last action ended; it drives the bot, so wait again.
        if (!gaveUp) gaveUp = await waitForReflexIdle(this.runtime);
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
    // The actions took time: the plan may have gone stale since the check at the top.
    if (
      intent &&
      failedAt === null &&
      rejection === null &&
      !this.seenIntents.has(plan.intentId ?? '')
    ) {
      rejection = this.validate(plan);
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
    if (intent)
      disposition = stopped ? 'skipped' : await this.startIntent(intent, plan.intentId as string);
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
      ...(state === 'accepted' ? { intent: a.intent } : {}),
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
    // A detour for a walk this intent asked for is of no use to whoever plans next.
    dropBlockedReport(this.runtime.view, a.id);
    if (this.active === a) this.active = null;
    a.controller.abort();
    a.stepController?.abort();
    await this.runtime.cancelAction();
    // A step that ends its own intent is the step in flight: waiting for it would wait forever.
    if (!fromStep) await a.stepping;
    this.setState(a, state, detail);
    if (!this.stopping) this.tellObserver((o) => o.ended(a.id));
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
    if (this.abandoned(a)) {
      // The reflex gave up on a blocked walk of this intent: end it, do not walk the same way again.
      await this.end(a, 'failed', 'blocked: no way round the obstacle', 'action_failed', true);
      return;
    }
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
    if (result.status === 'running') {
      this.tellObserver((o) => o.stepped(this.snapshot(a)));
      return;
    }
    if (result.status === 'completed') {
      const wake = a.wake.wants('goal_completed') ? 'goal_completed' : undefined;
      await this.end(a, 'completed', 'goal completed', wake, true);
    } else if (result.status === 'failed') {
      await this.end(a, 'failed', result.message, 'action_failed', true);
    } else {
      await this.end(a, 'interrupted', result.message ?? result.reason, result.reason, true);
    }
  }

  private snapshot(a: ActiveIntent): StepSnapshot {
    return {
      intentId: a.id,
      intent: a.intent,
      checkpoint: this.savedCheckpoint(a),
      blockOperationsUsed: a.limits.blockOperationsUsed,
      expiresTick: a.expiresTick,
    };
  }

  /** Calls the observer; what it throws never reaches the step loop. */
  private tellObserver(call: (observer: IntentObserver) => void): void {
    if (!this.observer) return;
    try {
      call(this.observer);
    } catch (error) {
      console.warn(`intent observer failed: ${errorText(error)}`);
    }
  }

  /**
   * Starts `intent` again after a Body restart, from its saved `checkpoint` when it has one, with
   * `usedBlockOperations` already spent. It is not a new plan: no validity check, no actions.
   * Returns how the start went. Only this path reads the intent's `checkpoint`: `submit` never does.
   */
  resume(intent: Intent, intentId: string, usedBlockOperations = 0): Promise<IntentDisposition> {
    return this.startIntent(intent, intentId, { resumed: true, usedBlockOperations });
  }

  private startIntent(
    intent: Intent,
    id: string,
    mode: IntentStartMode = { resumed: false },
  ): Promise<IntentDisposition> {
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
          // A restart during the first step finds this entry; each step then refreshes it.
          this.tellObserver((o) => o.stepped(this.snapshot(a)));
        },
      },
      intent,
      id,
      mode,
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
