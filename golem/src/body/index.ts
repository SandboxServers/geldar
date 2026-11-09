// The Body runtime's public interface: what the reflex, executor, program and record packets
// build on. Import from here, not from the individual files.
//
// Ticks: `TickSource` and `ConnectionManager.onWorldTick` keep their shape (a listener that gets a
// world tick), but fire at the client's 20 Hz physics tick, not at the ~1 Hz time packet. The value is
// still in world ticks (`watchWorldTicks` in `world-clock.ts`), so cooldowns stay in world ticks.
export type { ActionRun } from '../actions/registry.ts';
export {
  type BodyKv,
  CHECKPOINT_BUCKET,
  type CheckpointEntry,
  CheckpointStore,
  natsBodyKv,
} from './checkpoint.ts';
export { type Body, type CreateBodyOptions, createBody, enabledReflexes } from './create-body.ts';
export {
  type ActionReport,
  DEFAULT_REMEMBERED_ACTIONS,
  type ExecutorOptions,
  type IntentDisposition,
  IntentExecutor,
  type IntentObserver,
  MAX_ACTIONS,
  type PlanEnvelope,
  type StepSnapshot,
  type SubmitResult,
} from './executor.ts';
export { GENERATION_BUCKET, nextGeneration } from './generation.ts';
export { blockOperationsOf, type IntentLimits, type LimitKind, LimitTracker } from './limits.ts';
export {
  builtinPreconditions,
  type Precondition,
  PreconditionRegistry,
  type PreconditionVerdict,
} from './preconditions.ts';
export {
  type IntentProgram,
  type ProgramCheckpoint,
  type ProgramContext,
  type ProgramFactory,
  ProgramRegistry,
  type StepResult,
} from './program.ts';
export {
  CraftProgram,
  createProgramRegistry,
  FleeProgram,
  GatherProgram,
  ProgramError,
  type ProgramErrorReason,
  RestProgram,
  TravelProgram,
  UNSUPPORTED_PROGRAMS,
} from './programs/index.ts';
export {
  type IntentChange,
  type IntentState,
  MemorySink,
  type RecordSink,
  type ReflexFiredRecord,
} from './records.ts';
export {
  type EventPublisher,
  eventIdFor,
  jetStreamPublisher,
  NatsRecordSink,
  type NatsSinkOptions,
} from './records-nats.ts';
export {
  type Reflex,
  type ReflexContext,
  type ReflexOutcome,
  ReflexRunner,
  type ReflexRunnerOptions,
  type Trigger,
} from './reflex.ts';
export {
  allReflexesOn,
  isReflexEnabled,
  loadReflexConfig,
  parseReflexConfig,
  REFLEX_NAMES,
  type ReflexConfig,
  type ReflexName,
} from './reflex-config.ts';
export { createBasicReflexes } from './reflexes/basic.ts';
export { type BlockedReport, hasBlockedReport, reportBlocked } from './reflexes/blocked-path.ts';
export { combatReflexes } from './reflexes/combat.ts';
export { shelterReflexes } from './reflexes/shelter.ts';
export {
  NO_PLAN_WAIT_MS,
  openRestartKv,
  type RestartBodyOptions,
  type RestartedBody,
  type RestartOutcome,
  restartBody,
} from './restart.ts';
export { BodyRuntime, type BodyRuntimeOptions, type TickSource } from './runtime.ts';
export {
  type BodyIdentity,
  checkValidity,
  DEFAULT_SNAPSHOT_WINDOW,
  type PlanIdentity,
  type Rejection,
  type RejectReason,
} from './validity.ts';
export {
  type BodyView,
  createBodyView,
  type HostileView,
  type TrackedBodyView,
} from './view.ts';
export type { WakeReason, WakeRequest } from './wake.ts';
export { WakeConditions, type WakeSample, WakeTap } from './wake-conditions.ts';
