/**
 * The 90-day audit retention purge. Glass owns this timer whether or not Kino is on, so rows never outlive
 * the retention because the feature was switched off. A failure is logged as a fixed line and counted.
 */
export interface PurgeOptions {
  intervalMs?: number;
  log?: (line: string) => void;
}

export interface PurgeHandle {
  stop(): void;
  failures(): number;
}

/** One day: the purge runs at start and then daily. */
export const PURGE_MS = 86_400_000;

export function startAuditPurge(
  audit: { purge(): Promise<unknown> },
  o: PurgeOptions = {},
): PurgeHandle {
  const log = o.log ?? ((line: string) => console.log(line));
  let failures = 0;
  const run = (): void => {
    let p: Promise<unknown>;
    try {
      p = audit.purge();
    } catch {
      p = Promise.reject(new Error('purge'));
    }
    p.catch(() => {
      failures += 1;
      log('{"kino":"audit purge failed"}');
    });
  };
  run();
  const timer = setInterval(run, o.intervalMs ?? PURGE_MS);
  timer.unref();
  return { stop: () => clearInterval(timer), failures: () => failures };
}
