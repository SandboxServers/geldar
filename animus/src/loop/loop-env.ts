/**
 * What the steps of one thinking cycle need from the running loop: the ports, the options, the
 * failure report, the limit of one step, the cancel signal and the clock. The loop builds one of
 * these and passes it to the steps that live in their own modules, so every step runs on the same
 * clock, sink and cancel signal as the loop that calls it.
 */
import type { LoopOptions } from './loop-options.ts';
import type { LoopDeps } from './loop-types.ts';
import type { FailureReport } from './thought-journal.ts';

export interface LoopEnv {
  readonly deps: LoopDeps;
  readonly options: LoopOptions;
  readonly report: FailureReport;
  /** The limit of one step that waits on a dependency. */
  readonly stepMs: number;
  /** Aborted by `stop()`: cancels the model call in flight. */
  readonly signal: AbortSignal;
  now(): number;
  /** The current time as an ISO string. */
  at(): string;
  /** Milliseconds since the current cycle started. */
  elapsed(): number;
  log(line: Record<string, unknown>): void;
}
