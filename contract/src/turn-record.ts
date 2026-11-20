// --- GX-05a turn record ---
import type { TurnRecordPayload } from './generated/types.ts';
import { validateTurnRecordPayload as validateTurnRecordPayloadSchema } from './generated/validators.js';
import { formatError, type ValidationResult } from './validation.ts';

export type { TurnRecordPayload } from './generated/types.ts';

/**
 * Checks a value against turn-record-event.schema.json (the payload of a `turn_record` event). The
 * record is operator-only and sink-only (decision 0185). Never throws; unknown properties are rejected.
 */
export function validateTurnRecordPayload(value: unknown): ValidationResult<TurnRecordPayload> {
  if (validateTurnRecordPayloadSchema(value)) {
    return { ok: true, value: value as TurnRecordPayload };
  }
  return { ok: false, errors: (validateTurnRecordPayloadSchema.errors ?? []).map(formatError) };
}
