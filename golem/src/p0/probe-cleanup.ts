/**
 * The probe's cleanup: disconnect the Body, delete its life registry key, remove its whitelist
 * entry. It runs on every exit (success, failure, signal), so each step is tried even when an
 * earlier one failed, and a failed step is reported rather than thrown.
 */
import { reasonOf } from './probe-steps.ts';

/** The three cleanup steps, injected so the order and the failures can be tested without a server. */
export interface CleanupSteps {
  disconnect(): Promise<void>;
  unregister(): Promise<void>;
  unwhitelist(): Promise<void>;
}

/** What the cleanup achieved: `removed` or `failed` for the registry and the whitelist, and the disconnect outcome. */
export interface CleanupResult {
  registry: 'removed' | 'failed';
  whitelist: 'removed' | 'failed';
  disconnect: 'ok' | 'failed';
}

/**
 * Runs the three steps in order and prints one status line plus a reason line per failed step.
 * The reason is the step's own error text; the steps never put a credential into an error.
 */
export async function cleanupProbe(
  steps: CleanupSteps,
  out: (line: string) => void,
  err: (line: string) => void,
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
    await steps.unregister();
  } catch (error) {
    registry = 'failed';
    err(`p0 registry delete failed: ${reasonOf(error)}`);
  }
  let whitelist: CleanupResult['whitelist'] = 'removed';
  try {
    await steps.unwhitelist();
  } catch (error) {
    whitelist = 'failed';
    err(`p0 whitelist remove failed: ${reasonOf(error)}`);
  }
  out(`p0 cleanup registry=${registry} whitelist=${whitelist}`);
  return { registry, whitelist, disconnect };
}
