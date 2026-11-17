/** Longest the telemetry flush may hold the process at exit; a black-holed collector cannot hold it longer. */
export const TELEMETRY_FLUSH_MS = 2000;

/**
 * The shutdown flush: runs `stop` and returns when it settles or after `timeoutMs`, whichever is
 * first. Never throws. A rejection or a throw is logged once, as a bounded message with no detail
 * of the error object (it may carry a URL or a header).
 */
export async function flushTelemetry(
  stop: () => Promise<void>,
  timeoutMs: number = TELEMETRY_FLUSH_MS,
  log: (message: string) => void = (message) => console.error(message),
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
    timer.unref();
  });
  const done = Promise.resolve()
    .then(() => stop())
    .catch((error: unknown) => {
      const name = error instanceof Error ? error.name : typeof error;
      try {
        log(`eventsink: telemetry flush failed (${name.slice(0, 40)})`);
      } catch {
        // a failing logger must not keep the process from exiting
      }
    });
  try {
    await Promise.race([done, limit]);
  } finally {
    clearTimeout(timer);
  }
}
