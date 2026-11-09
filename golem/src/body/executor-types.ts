import type { ActionRecord, Thought } from '@geldar/contract';
import type { LimitTracker } from './limits.ts';
import type { PreconditionRegistry } from './preconditions.ts';
import type { IntentProgram, ProgramCheckpoint, ProgramContext } from './program.ts';
import type { IntentState } from './records.ts';
import type { BodyRuntime, TickSource } from './runtime.ts';
import type { PlanIdentity, Rejection } from './validity.ts';
import type { WakeConditions, WakeTap } from './wake-conditions.ts';

export type Intent = NonNullable<Thought['intent']>;

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

/** What the executor tells an observer after a program step: the running intent and its state. */
export interface StepSnapshot {
  intentId: string;
  /** The intent as accepted (or as resumed). */
  intent: Intent;
  /** The program's `checkpoint()`, null when it has nothing to save. */
  checkpoint: ProgramCheckpoint | null;
  /** Block operations counted so far against `max_block_operations`: a resumed run starts there. */
  blockOperationsUsed: number;
  /** World tick from which the intent is past `max_world_ticks`. */
  expiresTick: number;
}

/**
 * Watches the running intent so its state can outlive the process (the `CheckpointStore`). Calls
 * must return at once and not throw; the executor ignores a throw all the same.
 */
export interface IntentObserver {
  /** A step returned `running`. */
  stepped(step: StepSnapshot): void;
  /** The intent ended for good. Not called when `stop()` ends it: that is a restart, not an end. */
  ended(intentId: string): void;
}

/** What an ``IntentExecutor`` is built from. */
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
  /** Told about each step and each end of the intent. Default: none. */
  observer?: IntentObserver;
}

/** One running intent. `executor-intent.ts` builds it; the executor drives it. */
export interface ActiveIntent {
  id: string;
  /** The intent as accepted. */
  intent: Intent;
  /** World tick from which the intent is past max_world_ticks. */
  expiresTick: number;
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
  /** The actions the program ran (through `ProgramContext.runAction`): only these count as its work. */
  ownActions: WeakSet<object>;
  /** The saved checkpoint of a resumed intent said the blocked-path reflex had given up on it. */
  resumedAbandoned: boolean;
}
