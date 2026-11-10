/**
 * The snapshot request of a thinking cycle (spec 5.3.4 step 1), with its retry: the Body may not be
 * up yet, so the loop asks again with a backoff until the wait budget is spent.
 */
import type { Snapshot } from '@geldar/contract';
import { type BodyLink, BodyLinkError } from '../ports/index.ts';

/** First wait between snapshot requests while the Body is not up; it doubles up to the cap. */
const SNAPSHOT_RETRY_START_MS = 250;
const SNAPSHOT_RETRY_CAP_MS = 5_000;

/** A timer that ends early, without rejecting, when `signal` aborts. */
export function sleepFor(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = (): void => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
  });
}

/** What the snapshot retry reads from the loop. */
export interface SnapshotRetry {
  body: BodyLink;
  lifeId: string;
  /** How long to keep asking, in milliseconds; 0 means one request. */
  budgetMs: number;
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  signal: AbortSignal;
  log: (line: Record<string, unknown>) => void;
}

/**
 * The snapshot, asked again with a backoff (250 ms doubling to 5 s) while the Body does not
 * answer, for up to `budgetMs` of waiting; null when it never did.
 */
export async function requestSnapshotWithRetry(
  reason: string,
  retry: SnapshotRetry,
): Promise<Snapshot | null> {
  let slept = 0;
  let delay = SNAPSHOT_RETRY_START_MS;
  for (let attempt = 1; ; attempt++) {
    try {
      return await retry.body.requestSnapshot(reason);
    } catch (error) {
      if (!(error instanceof BodyLinkError)) throw error;
      const wait = Math.min(delay, SNAPSHOT_RETRY_CAP_MS);
      const giveUp = slept + wait > retry.budgetMs || retry.signal.aborted;
      retry.log({
        event: giveUp ? 'snapshot_unavailable' : 'snapshot_retry',
        life_id: retry.lifeId,
        wake_reason: reason,
        attempt,
        error_code: error.code,
      });
      if (giveUp) return null;
      await retry.sleep(wait, retry.signal);
      slept += wait;
      delay *= 2;
    }
  }
}
