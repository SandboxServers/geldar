/**
 * The values one thinking cycle passes between its steps: the outcome of one model call, and the
 * mutable state of the cycle itself.
 */
import type { Snapshot, Thought } from '@geldar/contract';
import type { ModelCompletion, OutputError, PromptRender, WakeDecision } from '../ports/index.ts';
import type { EffortChoice } from './effort.ts';

export type Attempt =
  | { kind: 'ok'; thought: Thought; completion: ModelCompletion }
  | { kind: 'invalid'; errors: OutputError[]; completion: ModelCompletion }
  | { kind: 'error'; code: string }
  | { kind: 'tired' };

/** Mutable state of one cycle. */
export interface Cycle {
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
