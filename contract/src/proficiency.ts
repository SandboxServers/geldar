import { formatError, type ValidationResult } from './validation.ts';

// --- AN-02b proficiency ---
import type {
  ChunkVisitedPayload,
  ProficiencyLevelPayload,
  ProficiencyRequest,
  ProficiencyState,
} from './generated/types.ts';
import {
  validateChunkVisitedPayload as validateChunkVisitedPayloadSchema,
  validateProficiencyLevelPayload as validateProficiencyLevelPayloadSchema,
  validateProficiencyRequest as validateProficiencyRequestSchema,
  validateProficiencyState as validateProficiencyStateSchema,
} from './generated/validators.js';

export type {
  ChunkVisitedPayload,
  ProficiencyLevelPayload,
  ProficiencyRequest,
  ProficiencyState,
} from './generated/types.ts';

/** Checks a value against proficiency-request.schema.json (the body of a proficiency request). Never throws. */
export function validateProficiencyRequest(value: unknown): ValidationResult<ProficiencyRequest> {
  if (validateProficiencyRequestSchema(value)) {
    return { ok: true, value: value as ProficiencyRequest };
  }
  return { ok: false, errors: (validateProficiencyRequestSchema.errors ?? []).map(formatError) };
}

/** Checks a value against proficiency-state.schema.json (the reply to a proficiency request). Never throws. */
export function validateProficiencyState(value: unknown): ValidationResult<ProficiencyState> {
  if (validateProficiencyStateSchema(value)) {
    return { ok: true, value: value as ProficiencyState };
  }
  return { ok: false, errors: (validateProficiencyStateSchema.errors ?? []).map(formatError) };
}

/** Checks a value against proficiency-level.schema.json (the core push when a domain reaches a level). Never throws. */
export function validateProficiencyLevelPayload(
  value: unknown,
): ValidationResult<ProficiencyLevelPayload> {
  if (validateProficiencyLevelPayloadSchema(value)) {
    return { ok: true, value: value as ProficiencyLevelPayload };
  }
  return {
    ok: false,
    errors: (validateProficiencyLevelPayloadSchema.errors ?? []).map(formatError),
  };
}

/** Checks a value against chunk-visited-event.schema.json (the payload of a `chunk_visited` event). Never throws. */
export function validateChunkVisitedPayload(value: unknown): ValidationResult<ChunkVisitedPayload> {
  if (validateChunkVisitedPayloadSchema(value)) {
    return { ok: true, value: value as ChunkVisitedPayload };
  }
  return { ok: false, errors: (validateChunkVisitedPayloadSchema.errors ?? []).map(formatError) };
}
