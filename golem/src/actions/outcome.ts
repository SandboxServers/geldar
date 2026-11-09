/** A JSON value: what an action may put in its outcome detail. */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };

/** Why an action failed. `blocked` is a reason, not a status: an abandoned path is a failed action. */
export type FailReason =
  | 'invalid_args'
  | 'timeout'
  | 'blocked'
  | 'not_found'
  | 'out_of_reach'
  | 'missing_materials'
  | 'missing_station'
  | 'not_possible'
  | 'interrupted'
  | 'unsupported'
  | 'internal';

/** What a handler returns. `runAction` turns it into the stored `ActionRecord.result` and state. */
export type ActionOutcome =
  | { status: 'completed'; detail: Record<string, JsonValue> }
  | { status: 'failed'; reason: FailReason; message: string; detail: Record<string, JsonValue> }
  | { status: 'cancelled'; detail: Record<string, JsonValue> };

/** The object stored in `ActionRecord.result` (snake_case, plain JSON, no `undefined` values). */
export interface ActionResult {
  status: 'completed' | 'failed' | 'cancelled';
  reason?: FailReason;
  message?: string;
  latency_ms: number;
  /** World-age ticks the action took, or null when unknown. Wall time and world ticks are separate clocks. */
  world_ticks: number | null;
  detail: Record<string, JsonValue>;
}

/** An action that finished its work. */
export function completed(detail: Record<string, JsonValue> = {}): ActionOutcome {
  return { status: 'completed', detail };
}

/** An action that could not finish, with the reason the Mind sees. */
export function failed(
  reason: FailReason,
  message: string,
  detail: Record<string, JsonValue> = {},
): ActionOutcome {
  return { status: 'failed', reason, message, detail };
}

/** An action stopped from outside (the caller aborted it). */
export function cancelled(detail: Record<string, JsonValue> = {}): ActionOutcome {
  return { status: 'cancelled', detail };
}

/** Builds the stored result. `reason` and `message` appear only for a failure. */
export function toResult(
  outcome: ActionOutcome,
  latencyMs: number,
  worldTicks: number | null,
): ActionResult {
  const result: ActionResult = {
    status: outcome.status,
    latency_ms: latencyMs,
    world_ticks: worldTicks,
    detail: outcome.detail,
  };
  if (outcome.status === 'failed') {
    result.reason = outcome.reason;
    result.message = outcome.message;
  }
  return result;
}

/** The `ActionRecord.state` that matches an outcome. */
export function recordState(outcome: ActionOutcome): 'completed' | 'failed' | 'cancelled' {
  return outcome.status;
}
