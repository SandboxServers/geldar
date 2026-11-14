import {
  type ActionOutcomePayload,
  intentWhy,
  isOutcomeReason,
  outcomeDetailText,
  outcomeMessage,
} from '@geldar/contract';
import { DEFAULT_DIAG_SINK } from '../actions/stall-diag.ts';
import type { ActionReport } from './executor-types.ts';
import type { RecordSink } from './records.ts';

/**
 * The Body reasons the contract does not list, each with the closest contract code. Only the ones
 * that reach an action outcome are here; stall diagnostics and wake reasons never reach the agent.
 */
const REASON_MAP: Readonly<Record<string, string>> = {
  // A run stopped before it finished (an abort, or a walk its caller cancelled): the agent reads it as interrupted.
  cancelled: 'interrupted',
};

/** The detail text of a run that was stopped before it finished. */
const STOPPED_TEXT = 'the action was stopped before it finished';

/** The contract code for a Body reason: a listed code as it is, a mapped one as its closest code, else undefined. */
function contractReason(raw: unknown): string | undefined {
  if (isOutcomeReason(raw)) return raw;
  return typeof raw === 'string' && Object.hasOwn(REASON_MAP, raw) ? REASON_MAP[raw] : undefined;
}

/** The payload for one finished plan action (C5-02): fixed text built from the verb and reason code only. */
export function actionOutcomeOf(
  verb: string,
  index: number,
  report: ActionReport,
): ActionOutcomePayload {
  const ok = report.record.state === 'completed';
  const stopped = report.record.state === 'cancelled';
  const raw = stopped ? 'cancelled' : (report.record.result as { reason?: unknown } | null)?.reason;
  const reason = ok ? undefined : (contractReason(raw) ?? 'internal');
  const text = ok
    ? undefined
    : stopped
      ? STOPPED_TEXT
      : outcomeDetailText(
          verb,
          reason,
          (report.record.result as { message?: unknown } | null)?.message,
        );
  return {
    verb,
    index,
    ok,
    ...(reason === undefined ? {} : { reason }),
    message: outcomeMessage(verb, ok, reason),
    ...(text === undefined ? {} : { detail_text: text }),
  } as ActionOutcomePayload;
}

/** Sends the outcome of one finished plan action, when the sink takes outcomes. */
export function emitActionOutcome(
  sink: RecordSink,
  tick: number,
  verb: string,
  index: number,
  report: ActionReport,
): void {
  if (report.duplicate) return;
  sink.actionOutcome?.(actionOutcomeOf(verb, index, report), tick);
}

/**
 * Sends the outcome of an intent whose program failed. `message` is the program's failure text,
 * `<reason>: ...`; only its leading reason code is read, none of its words are sent on. A prefix
 * outside the contract reads as `not_possible` and logs `intent_reason_unknown`, so a new one shows
 * up in the log. Every failure logs one `intent_failed` line (the message cut to 300 characters).
 */
export function emitIntentFailure(
  sink: RecordSink,
  tick: number,
  program: string,
  message: string,
): void {
  const prefix = message.split(':', 1)[0] ?? '';
  const known = contractReason(prefix);
  if (known === undefined) {
    DEFAULT_DIAG_SINK.log(
      JSON.stringify({ event: 'intent_reason_unknown', program, prefix: prefix.slice(0, 80) }),
    );
  }
  const reason = known ?? 'not_possible';
  DEFAULT_DIAG_SINK.log(
    JSON.stringify({
      event: 'intent_failed',
      program,
      reason,
      message: message.slice(0, 300),
    }),
  );
  sink.actionOutcome?.(
    {
      verb: program,
      index: 0,
      ok: false,
      reason,
      message: outcomeMessage(program, false, reason),
      intent: true,
      why: intentWhy(program, reason),
    } as ActionOutcomePayload,
    tick,
  );
}
