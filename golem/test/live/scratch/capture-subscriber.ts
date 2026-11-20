// CAP-2 (fix 1): the nats-capture child for one case. Split out of provenance-capture.ts so the READY wait and the stop
// can be unit-tested with a fake child. A child that exits early is reported, never waited on forever.
import type { ChildProcess, SpawnOptions } from 'node:child_process';

export type SpawnFn = (command: string, args: string[], options: SpawnOptions) => ChildProcess;

export const READY_TIMEOUT_MS = 30_000;

/** True when the child has already exited (or was killed by a signal): waiting for an `exit` event would hang. */
export function hasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

/**
 * Starts the script and resolves when its stdout shows READY. Rejects when it exits first; on a READY timeout it
 * kills the child before rejecting, so the child never outlives a failed case.
 */
export function startSubscriber(
  spawnFn: SpawnFn,
  script: string,
  args: { url: string; subjects: string; out: string },
  timeoutMs = READY_TIMEOUT_MS,
): Promise<ChildProcess> {
  return new Promise((ok, fail) => {
    const child = spawnFn(
      process.execPath,
      [script, '--url', args.url, '--subjects', args.subjects, '--out', args.out],
      { stdio: ['ignore', 'pipe', 'inherit'] },
    );
    let settled = false;
    let seen = '';
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      fail(new Error(`subscriber did not print READY within ${timeoutMs} ms`));
    }, timeoutMs);
    child.stdout?.on('data', (chunk: Buffer) => {
      if (settled) return;
      seen += chunk.toString();
      if (seen.includes('READY')) {
        settled = true;
        clearTimeout(timer);
        ok(child);
      }
    });
    child.once('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fail(new Error(`subscriber exited (${String(code)}) before READY`));
    });
  });
}

/** Stops the subscriber and waits for it to exit. A child that has already exited resolves at once. */
export function stopSubscriber(child: ChildProcess): Promise<void> {
  return new Promise((ok) => {
    if (hasExited(child)) {
      ok();
      return;
    }
    child.once('exit', () => ok());
    child.kill();
  });
}
