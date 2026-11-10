/**
 * The per-connection job ledger (Appendix H rules, threat model section 4 rule 2): a `completion`
 * or `error` is accepted only for a `job_id` this connection was issued, not yet answered, and
 * before its deadline. Everything else is dropped and counted against the connection.
 */

/** What became of a claim on a job id. Only `accepted` lets the frame through. */
export type ClaimResult =
  /** Issued here, open and on time: the frame is taken and the job is now answered. */
  | 'accepted'
  /** Never issued to this connection (a foreign id). */
  | 'unknown'
  /** Already answered: a duplicate. */
  | 'answered'
  /** Issued here but the deadline has passed. */
  | 'late'
  /** The Mind cancelled the job; an answer that crossed the cancel on the wire. */
  | 'cancelled';

type JobState = 'open' | 'answered' | 'cancelled';

interface Entry {
  model: string;
  deadlineMs: number;
  state: JobState;
}

/** How long an entry outlives its deadline, so a duplicate is told apart from an unknown id. */
const RETAIN_MS = 10 * 60_000;

/** The jobs issued to one connection. */
export class JobLedger {
  /**
   * Claims that were dropped as anomalies: foreign, duplicate and late answers. An answer that
   * crossed our own `cancel` is counted in {@link crossedCancel} instead; an honest Thinker races.
   */
  anomalies = 0;
  /** Answers dropped because the Mind had already cancelled the job. */
  crossedCancel = 0;
  private readonly entries = new Map<string, Entry>();
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  /** Records a job sent on this connection. */
  issue(jobId: string, model: string, deadlineMs: number): void {
    this.prune();
    this.entries.set(jobId, { model, deadlineMs, state: 'open' });
  }

  /** Jobs sent on this connection for `model` that are neither answered nor cancelled. */
  openCount(model: string): number {
    let count = 0;
    for (const entry of this.entries.values()) {
      if (entry.model === model && entry.state === 'open') count += 1;
    }
    return count;
  }

  /** The Mind gave up on the job; a later answer is dropped (not an anomaly). */
  cancel(jobId: string): void {
    const entry = this.entries.get(jobId);
    if (entry !== undefined && entry.state === 'open') entry.state = 'cancelled';
  }

  /** Decides one incoming `completion` or `error`. The ledger counts every refusal. */
  claim(jobId: string): ClaimResult {
    const entry = this.entries.get(jobId);
    if (entry === undefined) return this.refuse('unknown');
    if (entry.state === 'cancelled') {
      this.crossedCancel += 1;
      return 'cancelled';
    }
    if (entry.state === 'answered') return this.refuse('answered');
    if (this.now() > entry.deadlineMs) return this.refuse('late');
    entry.state = 'answered';
    return 'accepted';
  }

  private refuse(result: 'unknown' | 'answered' | 'late'): ClaimResult {
    this.anomalies += 1;
    return result;
  }

  private prune(): void {
    const horizon = this.now() - RETAIN_MS;
    for (const [id, entry] of this.entries) {
      if (entry.state !== 'open' && entry.deadlineMs < horizon) this.entries.delete(id);
    }
  }
}
