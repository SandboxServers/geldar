/**
 * The journal and event side of a thinking cycle: the `thoughts` row, the `suppressed_wakeups` row
 * of a lost wake, and the `thought` event. A failure here is logged with its code and reported to
 * `onError`, then the cycle carries on: the Mind must not stop for a lost write or event.
 */
import type { Snapshot, WorldEvent } from '@geldar/contract';
import type { EventPublisher, Journal, ThoughtOutcome } from '../ports/index.ts';
import type { Effort } from './effort.ts';

/** Where a swallowed failure is reported: one structured log line and the optional hook. */
export interface FailureReport {
  lifeId: string;
  log: (line: Record<string, unknown>) => void;
  onError?: (error: unknown) => void;
}

/** The argument of `Journal.recordThought`. */
export type ThoughtRowInput = Parameters<Journal['recordThought']>[0];

/** Logs a swallowed failure with the life, the error code and the ids, then reports the error. */
export function reportFailure(
  report: FailureReport,
  error: unknown,
  code: string,
  ids: Record<string, string> = {},
): void {
  report.log({
    event: 'loop_error',
    life_id: report.lifeId,
    error_code: code,
    error_name: error instanceof Error ? error.name : typeof error,
    ...ids,
  });
  report.onError?.(error);
}

/** Writes one `thoughts` row; returns false (after reporting) when the write failed. */
export async function writeThoughtRow(
  journal: Journal,
  row: ThoughtRowInput,
  thoughtId: string,
  report: FailureReport,
): Promise<boolean> {
  try {
    await journal.recordThought(row);
    return true;
  } catch (error) {
    reportFailure(report, error, 'journal_write_failed', { thought_id: thoughtId });
    return false;
  }
}

/** A wake that never got a snapshot is still on record: a `suppressed_wakeups` row says why. */
export async function recordLostWake(
  journal: Journal,
  wakeReason: string,
  at: string,
  report: FailureReport,
): Promise<void> {
  try {
    await journal.recordSuppressed({
      lifeId: report.lifeId,
      at,
      eventTypes: [wakeReason],
      reason: 'snapshot_unavailable',
      intentId: null,
    });
  } catch (error) {
    reportFailure(report, error, 'suppressed_write_failed');
  }
}

/** What the `thought` event says about a finished cycle. */
export interface ThoughtEventInput {
  thoughtId: string;
  snapshot: Snapshot;
  wakeReason: string;
  outcome: ThoughtOutcome;
  latencyMs: number;
  modelConfig: string;
  effort: Effort;
  thinkerId: string | undefined;
  /** The intent the Body accepted, or null. */
  intentId: string | null;
  at: string;
}

/** The `thought` event; its id is the thought's ULID, so a redelivered event dedups. */
export function buildThoughtEvent(input: ThoughtEventInput): WorldEvent {
  const { snapshot, thoughtId } = input;
  const event: WorldEvent = {
    source_event_id: `ev_${thoughtId.slice(3)}`,
    at: input.at,
    shard: snapshot.shard,
    world_day: snapshot.world_time.day,
    world_tick: snapshot.world_time.ticks,
    type: 'thought',
    agent_id: snapshot.agent_id,
    payload: {
      thought_id: thoughtId,
      wake_reason: input.wakeReason,
      outcome: input.outcome,
      latency_ms: Math.round(input.latencyMs),
      model_config: input.modelConfig,
      effort: input.effort,
      intent_id: input.intentId,
    },
  };
  if (input.thinkerId !== undefined) event.thinker_id = input.thinkerId;
  return event;
}

/** Publishes the `thought` event; a failed publish is reported, never thrown. */
export async function publishThoughtEvent(
  events: EventPublisher,
  event: WorldEvent,
  thoughtId: string,
  report: FailureReport,
): Promise<void> {
  try {
    await events.publish(event);
  } catch (error) {
    reportFailure(report, error, 'event_publish_failed', { thought_id: thoughtId });
  }
}
