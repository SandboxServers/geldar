import { type ActionOutcome, cancelled, failed, type JsonValue } from './outcome.ts';
import type { MoveResult } from './pathing.ts';

/**
 * The outcome of a walk that did not arrive. A walk the caller cancelled is `cancelled`; any other
 * reason is a failure with the walk's reason and message. `detail` keeps what the action had
 * already done (for example the blocks mined so far).
 */
export function outcomeOfMove(
  move: Extract<MoveResult, { ok: false }>,
  detail: Record<string, JsonValue> = {},
): ActionOutcome {
  if (move.reason === 'cancelled') return cancelled(detail);
  return failed(move.reason, move.message, detail);
}
