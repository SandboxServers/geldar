/**
 * The probe's cleanup: disconnect the Body, wait for any registry put or whitelist add the run
 * started to settle, then delete its life registry key and remove its whitelist entry. It runs on
 * every exit (success, failure, signal), so each step is tried even when an earlier one failed,
 * and a failed step is reported rather than thrown. A write that is still in flight when the
 * delete or remove would run is never raced: the step reports `failed`, not `removed`.
 */
import { reasonOf } from './probe-steps.ts';

/** How long cleanup waits for an in-flight write to settle before it reports that step failed. */
export const CLEANUP_SETTLE_MS = 10_000;

/** The three cleanup steps, injected so the order and the failures can be tested without a server. */
export interface CleanupSteps {
  disconnect(): Promise<void>;
  /** The registry put the run started, if it started one. The delete waits for it to settle. */
  registryWrite?: Promise<unknown> | undefined;
  unregister(): Promise<void>;
  /** The whitelist add the run started, if it started one. The remove waits for it to settle. */
  admitWrite?: Promise<unknown> | undefined;
  unwhitelist(): Promise<void>;
}

/** What the cleanup achieved: `removed` or `failed` for the registry and the whitelist, and the disconnect outcome. */
export interface CleanupResult {
  registry: 'removed' | 'failed';
  whitelist: 'removed' | 'failed';
  disconnect: 'ok' | 'failed';
}

/**
 * Resolves once `write` settles (resolves or rejects). Throws when it is still in flight after
 * `ms`, because then a late write cannot be ruled out. A missing write has nothing to wait for.
 */
export async function settledWithin(
  write: Promise<unknown> | undefined,
  ms: number,
  what: string,
): Promise<void> {
  if (write === undefined) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), ms);
  });
  const settled = write.then(
    () => 'settled' as const,
    () => 'settled' as const,
  );
  const outcome = await Promise.race([settled, timeout]);
  clearTimeout(timer);
  if (outcome === 'timeout') throw new Error(`${what} still in flight after ${ms} ms`);
}

/**
 * Runs the three steps in order and prints one status line plus a reason line per failed step.
 * The reason is the step's own error text; the steps never put a credential into an error.
 */
export async function cleanupProbe(
  steps: CleanupSteps,
  out: (line: string) => void,
  err: (line: string) => void,
  settleMs: number = CLEANUP_SETTLE_MS,
): Promise<CleanupResult> {
  let disconnect: CleanupResult['disconnect'] = 'ok';
  try {
    await steps.disconnect();
  } catch (error) {
    disconnect = 'failed';
    err(`p0 disconnect failed: ${reasonOf(error)}`);
  }
  let registry: CleanupResult['registry'] = 'removed';
  try {
    await settledWithin(steps.registryWrite, settleMs, 'registry put');
    await steps.unregister();
  } catch (error) {
    registry = 'failed';
    err(`p0 registry delete failed: ${reasonOf(error)}`);
  }
  let whitelist: CleanupResult['whitelist'] = 'removed';
  try {
    await settledWithin(steps.admitWrite, settleMs, 'whitelist add');
    await steps.unwhitelist();
  } catch (error) {
    whitelist = 'failed';
    err(`p0 whitelist remove failed: ${reasonOf(error)}`);
  }
  out(`p0 cleanup registry=${registry} whitelist=${whitelist}`);
  return { registry, whitelist, disconnect };
}
