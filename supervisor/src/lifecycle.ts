// The supervisor's process lifecycle decisions (C7-03b5 review fixes 3 and 4). They live here, not in main.ts, because
// main.ts runs on import and cannot be tested. Lines name counters and states only, never a value.
import type { CtlStats } from './nats.ts';

/**
 * The stderr line for a control subscription that ended while the process was not stopping, or null when the end
 * is the expected drain of a stop. An unexpected end leaves the process up but answering nothing, so the caller exits.
 */
export function unexpectedEndLine(stopping: boolean, stats: CtlStats): string | null {
  if (stopping) return null;
  return [
    'supervisor: control subscription ended unexpectedly',
    `dropped=${stats.dropped}`,
    `invalid=${stats.invalid}`,
    `busy=${stats.busy}`,
    `handlerFailed=${stats.handlerFailed}`,
    `replyFailed=${stats.replyFailed}`,
    `subscribeFailed=${stats.subscribeFailed}`,
  ].join(' ');
}
