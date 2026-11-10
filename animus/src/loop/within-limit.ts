import { CycleAborted } from './cycle-await.ts';

/**
 * Waits for `work`, and ends the wait with `CycleAborted('memory')` after `ms` when a limit is set;
 * `onTimeout` runs first. A late result is dropped, never left as an unhandled rejection; the timer
 * is cleared as soon as `work` settles. The abandoned query is not cancelled here, but the pool's
 * statement_timeout (30 s) bounds it, so it cannot hold a connection for long.
 */
export function withinLimit<T>(
  work: Promise<T>,
  ms: number | undefined,
  onTimeout: () => void,
): Promise<T> {
  if (ms === undefined) return work;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      onTimeout();
      reject(new CycleAborted('memory', ms));
    }, ms);
  });
  work.catch(() => undefined);
  return Promise.race([work, limit]).finally(() => clearTimeout(timer));
}
