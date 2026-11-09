// The executor's public interface. The orchestrator merges these exports into `index.ts`.
export {
  type ActionReport,
  DEFAULT_REMEMBERED_ACTIONS,
  type ExecutorOptions,
  type IntentDisposition,
  IntentExecutor,
  MAX_ACTIONS,
  type PlanEnvelope,
  type SubmitResult,
} from './executor.ts';
export { blockOperationsOf, type IntentLimits, type LimitKind, LimitTracker } from './limits.ts';
export {
  builtinPreconditions,
  type Precondition,
  PreconditionRegistry,
  type PreconditionVerdict,
} from './preconditions.ts';
export {
  type BodyIdentity,
  checkValidity,
  DEFAULT_SNAPSHOT_WINDOW,
  type PlanIdentity,
  type Rejection,
  type RejectReason,
} from './validity.ts';
export { WakeConditions, type WakeSample, WakeTap } from './wake-conditions.ts';
