/**
 * The Mind's `ModelClient` over the local Thinker hub (spec 5.3, Appendix H). It picks a live
 * connection with a free slot, sends the job, and fails with a `ModelError` when no Thinker is
 * there, the deadline plus a grace passes, or the caller aborts. It never logs prompt or
 * completion text.
 */
import {
  type ModelClient,
  type ModelCompletion,
  ModelError,
  type ModelJob,
} from '../ports/model.ts';
import type { ThinkerHub } from './hub.ts';

/** Options of the client. */
export interface LocalClientOptions {
  /** How long past the job's deadline the client waits for the Thinker before it gives up. */
  graceMs?: number;
  now?: () => number;
}

/** A `ModelClient` that dispatches every job to the Thinker connected to a {@link ThinkerHub}. */
export class LocalThinkerClient implements ModelClient {
  private readonly hub: ThinkerHub;
  private readonly graceMs: number;
  private readonly now: () => number;

  constructor(hub: ThinkerHub, options: LocalClientOptions = {}) {
    this.hub = hub;
    this.graceMs = options.graceMs ?? 2000;
    this.now = options.now ?? Date.now;
  }

  async complete(job: ModelJob, signal: AbortSignal): Promise<ModelCompletion> {
    if (signal.aborted) throw new ModelError('cancelled', 'the call was cancelled');
    const started = this.now();
    const remaining = job.deadline.getTime() - started;
    if (remaining <= 0) throw new ModelError('timeout', 'the deadline had already passed');
    const session = this.hub.pick(job.model);
    if (session === undefined) {
      throw new ModelError('no_thinker', `no live Thinker offers ${job.model}`);
    }
    const { jobId, result } = session.submit(job);
    const timer = setTimeout(
      () => session.cancel(jobId, new ModelError('timeout', 'no completion before the deadline')),
      remaining + this.graceMs,
    );
    const onAbort = (): void =>
      session.cancel(jobId, new ModelError('cancelled', 'the call was cancelled'));
    signal.addEventListener('abort', onAbort, { once: true });
    try {
      const done = await result;
      return {
        text: done.text,
        ...(done.usageReported === undefined ? {} : { usageReported: done.usageReported }),
        thinkerId: this.hub.thinkerName,
        latencyMs: this.now() - started,
      };
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
    }
  }

  /** Drains the Thinkers and closes the hub. */
  async stop(): Promise<void> {
    await this.hub.stop();
  }
}
