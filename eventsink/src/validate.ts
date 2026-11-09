/** Decides whether a NATS message is a valid world event. */
import { validateWorldEvent, type WorldEvent } from '@geldar/contract';

/** Subject prefix and the dead-letter type segment (`geldar.<shard>.dlq`). */
export const DLQ_TYPE = 'dlq';

/** Outcome of checking one message. */
export type Verdict = { ok: true; event: WorldEvent } | { ok: false; reason: string };

/** The shard segment of `geldar.<shard>.<type>`, or `unknown` when the subject has another shape. */
export function shardOfSubject(subject: string): string {
  const parts = subject.split('.');
  return parts.length === 3 && parts[0] === 'geldar' && /^[A-Za-z0-9_-]+$/.test(parts[1] ?? '')
    ? (parts[1] as string)
    : 'unknown';
}

/**
 * Parses and validates a message body against the generated WorldEvent validator, then checks
 * that the subject agrees with the event (`geldar.<shard>.<type>`). Never throws.
 */
export function validateMessage(subject: string, data: Uint8Array): Verdict {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data));
  } catch {
    return { ok: false, reason: 'body is not valid UTF-8 JSON' };
  }
  const result = validateWorldEvent(value);
  if (!result.ok) return { ok: false, reason: result.errors.join('; ') };
  const expected = `geldar.${result.value.shard}.${result.value.type}`;
  if (subject !== expected) {
    return { ok: false, reason: `subject ${subject} does not match the event (${expected})` };
  }
  return { ok: true, event: result.value };
}
