/** The effects the shutdown handler needs; all injectable so tests can fake them. */
export interface ShutdownDeps {
  /** Closes the app; a rejection means the close failed. */
  close: () => Promise<void>;
  /** Writes one log line (request lines only: never tokens or bodies). */
  log: (line: Record<string, unknown>) => void;
  /** Ends the process. */
  exit: (code: number) => void;
  /** Starts a timer and returns a handle that can be unref'd. */
  setTimer: (fn: () => void, ms: number) => { unref: () => unknown };
  /** How long a hung close may block the exit; defaults to 5000 ms. */
  forceExitMs?: number;
}

/**
 * Builds the signal handler for a graceful stop.
 * Only the first signal acts: a second one while close() runs is ignored, not allowed to kill
 * the process mid-shutdown. A hung close() is cut short by an unref'd timer that exits 1, so
 * the timer never keeps the event loop alive on its own.
 */
export function createShutdown(deps: ShutdownDeps): (signal: string) => void {
  const { close, log, exit, setTimer, forceExitMs = 5000 } = deps;
  let stopping = false;
  return (signal) => {
    if (stopping) return;
    stopping = true;
    log({ event: 'stopping', signal });
    setTimer(() => {
      log({ event: 'stop_failed', error: 'close timed out' });
      exit(1);
    }, forceExitMs).unref();
    close().then(
      () => exit(0),
      (error: unknown) => {
        const message = error instanceof Error ? error.message : 'close failed';
        log({ event: 'stop_failed', error: message.slice(0, 200) });
        exit(1);
      },
    );
  };
}
