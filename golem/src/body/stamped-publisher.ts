/**
 * The Body's publisher seam (decision D-HC-01): one wrapper stamps every WorldEvent the Body
 * publishes with the run's `harness` and `model`, so no event builder has to know the stamp. A
 * run with no stamp gets the inner publisher itself: off is the old path, byte for byte.
 */
import type { EventPublisher } from './records-nats.ts';

/** The harness and model a run declares; either may be absent. */
export interface RunStamp {
  harness?: string;
  model?: string;
}

type StampKey = keyof RunStamp;

/** The stamp fields that are set, or null when there are none (the old path). */
function fieldsOf(stamp: RunStamp | undefined): RunStamp | null {
  const fields: RunStamp = {};
  if (stamp?.harness) fields.harness = stamp.harness;
  if (stamp?.model) fields.model = stamp.model;
  return fields.harness === undefined && fields.model === undefined ? null : fields;
}

/** The body with the missing stamp fields set; the same string when nothing is to add. */
function stampBody(body: string, fields: RunStamp): string {
  let event: unknown;
  try {
    event = JSON.parse(body);
  } catch {
    return body;
  }
  if (typeof event !== 'object' || event === null || Array.isArray(event)) return body;
  const record = event as Record<string, unknown>;
  if (typeof record.agent_id !== 'string') return body;
  let changed = false;
  for (const key of ['harness', 'model'] as StampKey[]) {
    const value = fields[key];
    if (value !== undefined && record[key] === undefined) {
      record[key] = value;
      changed = true;
    }
  }
  return changed ? JSON.stringify(record) : body;
}

/**
 * Wraps `inner` so each event with an `agent_id` leaves with the stamp's harness and model, where
 * the event has neither yet. The subject, the msgId and the source event id are never changed.
 */
export function stampedPublisher(
  inner: EventPublisher,
  stamp: RunStamp | undefined,
): EventPublisher {
  const fields = fieldsOf(stamp);
  if (fields === null) return inner;
  return {
    publish: (subject, body, msgId) => inner.publish(subject, stampBody(body, fields), msgId),
  };
}
