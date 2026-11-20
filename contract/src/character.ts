import { formatError, type ValidationResult } from './validation.ts';

// --- AN-02a character ---
import type {
  CharacterSheet,
  DecisionEventPayload,
  RollEventPayload,
  SheetAdoptedPayload,
} from './generated/types.ts';
import {
  validateCharacterSheet as validateCharacterSheetSchema,
  validateDecisionEventPayload as validateDecisionEventPayloadSchema,
  validateRollEventPayload as validateRollEventPayloadSchema,
  validateSheetAdoptedPayload as validateSheetAdoptedPayloadSchema,
} from './generated/validators.js';

export type {
  CharacterSheet,
  DecisionEventPayload,
  RollEventPayload,
  SheetAdoptedPayload,
} from './generated/types.ts';

/** Checks a value against character-sheet.schema.json. Never throws; a `proficiency` key is refused. */
export function validateCharacterSheet(value: unknown): ValidationResult<CharacterSheet> {
  if (validateCharacterSheetSchema(value)) return { ok: true, value: value as CharacterSheet };
  return { ok: false, errors: (validateCharacterSheetSchema.errors ?? []).map(formatError) };
}

/** Checks a value against roll-event.schema.json (the payload of a `roll` event). Never throws. */
export function validateRollEventPayload(value: unknown): ValidationResult<RollEventPayload> {
  if (validateRollEventPayloadSchema(value)) {
    return { ok: true, value: value as RollEventPayload };
  }
  return { ok: false, errors: (validateRollEventPayloadSchema.errors ?? []).map(formatError) };
}

/** Checks a value against decision-event.schema.json (the payload of a `decision` event). Never throws. */
export function validateDecisionEventPayload(
  value: unknown,
): ValidationResult<DecisionEventPayload> {
  if (validateDecisionEventPayloadSchema(value)) {
    return { ok: true, value: value as DecisionEventPayload };
  }
  return { ok: false, errors: (validateDecisionEventPayloadSchema.errors ?? []).map(formatError) };
}

/** Checks a value against sheet-adopted-event.schema.json (the payload of a `sheet_adopted` event). Never throws. */
export function validateSheetAdoptedPayload(value: unknown): ValidationResult<SheetAdoptedPayload> {
  if (validateSheetAdoptedPayloadSchema(value)) {
    return { ok: true, value: value as SheetAdoptedPayload };
  }
  return { ok: false, errors: (validateSheetAdoptedPayloadSchema.errors ?? []).map(formatError) };
}
