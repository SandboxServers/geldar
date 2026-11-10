import {
  type ModelClient,
  type ModelCompletion,
  ModelError,
  type ModelJob,
} from '../ports/model.ts';

/** One scripted answer: the text to return, a partial completion, or an error to reject with. */
export type ModelStep = string | Partial<ModelCompletion> | ModelError;

/**
 * A `ModelClient` that answers from a script, one step per call, in order. It records every job
 * it was given. Calling it with an aborted signal rejects with `cancelled` and uses no step; an
 * empty script rejects with `internal`, so a test that calls the model too often fails loudly.
 */
export class FakeModelClient implements ModelClient {
  /** Every job received, in order. */
  readonly jobs: ModelJob[] = [];
  private readonly steps: ModelStep[];

  constructor(steps: ModelStep[] = []) {
    this.steps = [...steps];
  }

  /** Adds steps to the end of the script. */
  script(...steps: ModelStep[]): void {
    this.steps.push(...steps);
  }

  async complete(job: ModelJob, signal: AbortSignal): Promise<ModelCompletion> {
    if (signal.aborted) throw new ModelError('cancelled', 'the call was cancelled');
    this.jobs.push(job);
    const step = this.steps.shift();
    if (step === undefined) throw new ModelError('internal', 'FakeModelClient script is empty');
    if (step instanceof ModelError) throw step;
    if (typeof step === 'string') return { text: step, thinkerId: 'fake', latencyMs: 1 };
    return { text: '', thinkerId: 'fake', latencyMs: 1, ...step };
  }
}
