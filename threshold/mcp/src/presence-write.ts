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
    const cause = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    log?.({ event: 'presence_error', cause });
  }
}
