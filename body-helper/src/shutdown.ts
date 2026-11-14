// The helper's shutdown order (C7-03c1 fix 2). New requests stop first: the subscriptions end, so nothing new is
// taken. The in-flight answers are then awaited, capped at SHUTDOWN_WAIT_MS. Only after that does the NATS
// connection close (its drain flushes the replies already published) and the database pool end. A reply
// published after the connection closes is lost, so the connection is the last thing to close.

/** How long a shutdown waits for in-flight answers before it closes anyway. */
export const SHUTDOWN_WAIT_MS = 10_000;

export interface ShutdownSteps {
  stopSweep(): void;
  /** Ends every helper subscription, so no new request reaches the handler. */
  stopIntake(): void;
  /** Settles once every in-flight answer has settled. Never rejects. */
  serving: Promise<void>;
  closeConnection(): Promise<void>;
  closePool(): Promise<void>;
}

export async function shutdownHelper(
  steps: ShutdownSteps,
  waitMs: number = SHUTDOWN_WAIT_MS,
): Promise<void> {
  steps.stopSweep();
  steps.stopIntake();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cut = new Promise<void>((done) => {
    timer = setTimeout(done, waitMs);
  });
  await Promise.race([steps.serving, cut]);
  clearTimeout(timer);
  await steps.closeConnection().catch(() => undefined);
  await steps.closePool().catch(() => undefined);
}
