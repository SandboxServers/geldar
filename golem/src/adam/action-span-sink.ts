import type { ActionRecord } from '@geldar/contract';
import type { RecordSink } from '../body/records.ts';
import { OUTCOME_STATUS_LABELS } from '../metrics.ts';
import { ACTION_ERROR_EVENT, actionErrorAttributes } from './action-error-event.ts';

/** The two span calls the Body makes. A tracer from the telemetry SDK satisfies this structurally. */
export interface ActionSpan {
  setAttribute(key: string, value: string): unknown;
  /** A failed action adds one `action_error` event; absent on a span that cannot take events. */
  addEvent?(name: string, attributes?: Record<string, string | number | boolean>): unknown;
  end(): void;
}
export interface ActionTracer {
  startSpan(name: string): ActionSpan;
}

/** The span name for one body action (T-07). */
export const ACTION_SPAN_NAME = 'geldar.body.action';
/** Spans open at once; an action that starts past this is not traced. */
const MAX_OPEN_ACTION_SPANS = 256;

/**
 * Wraps a record sink so each action gets one span, from its first record to its terminal result.
 * The span carries only `action_id` and `outcome` (a closed status label): never thought, chat,
 * speech or prompt text. Every record still reaches `inner`, and a tracer failure is swallowed here.
 */
export function actionSpanSink(
  inner: RecordSink,
  tracer: ActionTracer,
  log: (line: string) => void = () => undefined,
): RecordSink {
  const open = new Map<string, ActionSpan>();
  let capLogged = false;
  /** Sets the outcome and ends the span; the entry is removed by the caller before this runs. */
  const finish = (span: ActionSpan, outcome: string, result?: ActionRecord['result']): void => {
    try {
      span.setAttribute('outcome', outcome);
      // The failure text goes to the span only, scrubbed; an event failure never skips `end()`.
      const attributes = result ? actionErrorAttributes(result) : null;
      if (attributes) span.addEvent?.(ACTION_ERROR_EVENT, attributes);
    } finally {
      span.end();
    }
  };
  const observe = (record: ActionRecord): void => {
    const id = record.action_id;
    const result = record.result ?? null;
    let span = open.get(id);
    if (span === undefined) {
      // A running action holds a slot, so at the cap the oldest open span is ended to make room. A
      // terminal-only record is started and ended at once, so it needs no slot and never evicts.
      if (result === null && open.size >= MAX_OPEN_ACTION_SPANS) {
        const oldest = open.entries().next();
        if (!oldest.done) {
          const [oldestId, oldestSpan] = oldest.value;
          open.delete(oldestId);
          if (!capLogged) {
            capLogged = true;
            log(`action spans: ${MAX_OPEN_ACTION_SPANS} open; the oldest is ended as other`);
          }
          finish(oldestSpan, 'other');
        }
      }
      span = tracer.startSpan(ACTION_SPAN_NAME);
      try {
        span.setAttribute('action_id', id);
      } catch (error) {
        span.end();
        throw error;
      }
      if (result === null) open.set(id, span);
    }
    if (result !== null) {
      // The entry goes before the span ends, so a failure below never leaves it open.
      open.delete(id);
      const status = String(result.status);
      const outcome = (OUTCOME_STATUS_LABELS as readonly string[]).includes(status)
        ? status
        : 'other';
      finish(span, outcome, result);
    }
  };
  return {
    intentChanged: (change) => inner.intentChanged(change),
    actionChanged: (record) => {
      try {
        observe(record);
      } catch {
        // A span failure never reaches the Body.
      }
      inner.actionChanged(record);
    },
    receipt: (receipt) => inner.receipt(receipt),
    reflexFired: (record) => inner.reflexFired(record),
    wake: (request) => inner.wake(request),
    actionOutcome: (payload, tick) => inner.actionOutcome?.(payload, tick),
  };
}
