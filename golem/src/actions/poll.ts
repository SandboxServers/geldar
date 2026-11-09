import type { Bot } from 'mineflayer';

/** The limits of a poll: at most `polls` waits, and at most `wallMs` of wall-clock time. */
export interface PollLimit {
  polls?: number;
  wallMs?: number;
}

/**
 * Checks `done`, then waits one world tick, and repeats until `done` holds, the signal aborts or a
 * limit runs out. Returns whether `done` held. The first check runs before any wait, so a condition
 * that already holds costs no tick.
 */
export async function pollUntil(
  bot: Bot,
  signal: AbortSignal,
  done: () => boolean,
  limit: PollLimit,
): Promise<boolean> {
  const polls = limit.polls ?? Number.POSITIVE_INFINITY;
  const deadline =
    limit.wallMs === undefined ? Number.POSITIVE_INFINITY : Date.now() + limit.wallMs;
  for (let waits = 0; ; waits++) {
    if (done()) return true;
    if (signal.aborted || waits >= polls || Date.now() >= deadline) return false;
    await bot.waitForTicks(1);
  }
}
