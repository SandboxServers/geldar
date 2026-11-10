/** How often a presence or settle failure is logged, per kind, per process. */
export const PRESENCE_LOG_WINDOW_MS = 60_000;

/** The two failure lines that are rate-limited. Other lines pass through unchanged. */
const LIMITED_EVENTS: ReadonlySet<unknown> = new Set(['presence_error', 'settle_error']);

/** The cause of a failed write: `Name: message` for an Error, otherwise its text. */
export function causeOf(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

/**
 * Wraps a log sink so each `presence_error` and `settle_error` kind passes at most once per window.
 * The line that passes carries `suppressed`, how many of its kind were dropped since the last one;
 * the field is left out when none were. The clock is injected, so a test steps it.
 */
export function rateLimitedPresenceLog(
  sink: ((line: Record<string, unknown>) => void) | undefined,
  nowMs: () => number,
  windowMs = PRESENCE_LOG_WINDOW_MS,
): (line: Record<string, unknown>) => void {
  const last = new Map<unknown, { at: number; suppressed: number }>();
  return (line) => {
    if (!LIMITED_EVENTS.has(line.event)) {
      sink?.(line);
      return;
    }
    const now = nowMs();
    const prior = last.get(line.event);
    if (prior !== undefined && now - prior.at < windowMs) {
      prior.suppressed += 1;
      return;
    }
    const suppressed = prior?.suppressed ?? 0;
    sink?.(suppressed > 0 ? { ...line, suppressed } : line);
    last.set(line.event, { at: now, suppressed: 0 });
  };
}

/**
 * Runs one presence write as best effort. Presence keeps a life awake and asks its Body up; when
 * the store fails the call it serves still goes on, and the failure is logged with its cause.
 * The caller decides what the call answers, so the error it was already raising is not replaced.
 */
export async function bestEffortPresence(
  log: ((line: Record<string, unknown>) => void) | undefined,
  write: () => Promise<unknown>,
): Promise<void> {
  try {
    await write();
  } catch (error) {
    log?.({ event: 'presence_error', cause: causeOf(error) });
  }
}
