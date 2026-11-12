import {
  type ActionOutcomePayload,
  intentWhy,
  isOutcomeReason,
  outcomeDetailText,
  outcomeMessage,
} from '@geldar/contract';
import type { ActionReport } from './executor-types.ts';
import type { RecordSink } from './records.ts';

/** The payload for one finished plan action (C5-02): fixed text built from the verb and reason code only. */
export function actionOutcomeOf(
  verb: string,
  index: number,
  report: ActionReport,
): ActionOutcomePayload {
  const ok = report.record.state === 'completed';
  const raw = (report.record.result as { reason?: unknown } | null)?.reason;
  const reason = !ok && isOutcomeReason(raw) ? raw : !ok ? 'internal' : undefined;
  const text = ok
    ? undefined
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
 * `<reason>: ...`; only its leading reason code is read, none of its words are sent on.
 */
export function emitIntentFailure(
  sink: RecordSink,
  tick: number,
  program: string,
  message: string,
): void {
  const code = message.split(':', 1)[0] ?? '';
  const reason = isOutcomeReason(code) ? code : 'internal';
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
