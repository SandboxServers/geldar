import { formatError, type ValidationResult } from './validation.ts';

// --- P0-20 Mind channel ---
import type {
  ActionOutcomePayload,
  PlanAck,
  PlanMessage,
  PlanResultPayload,
  Reflection,
  SnapshotRequest,
  SpeechPayload,
  ThoughtEventPayload,
} from './generated/types.ts';
import {
  validateActionOutcomePayload as validateActionOutcomePayloadSchema,
  validatePlanAck as validatePlanAckSchema,
  validatePlanMessage as validatePlanMessageSchema,
  validatePlanResultPayload as validatePlanResultPayloadSchema,
  validateReflection as validateReflectionSchema,
  validateSnapshotRequest as validateSnapshotRequestSchema,
  validateSpeechPayload as validateSpeechPayloadSchema,
  validateThoughtEventPayload as validateThoughtEventPayloadSchema,
} from './generated/validators.js';

export type {
  ActionOutcomePayload,
  HeardMuffledPayload,
  HeardSoundPayload,
  PlanAck,
  PlanMessage,
  PlanResultPayload,
  Reflection,
  SnapshotRequest,
  SpeechPayload,
  ThoughtEventPayload,
} from './generated/types.ts';
export {
  heardMuffledSentence,
  heardSoundSentence,
  hurtSentence,
  intentWhy,
  isOutcomeReason,
  OUTCOME_REASONS,
  outcomeDetailText,
  outcomeMessage,
  PLAIN_FACT_VERBS,
  playerDetailText,
  playerOutcomeText,
} from './outcome-words.ts';
export { planSubject, snapshotSubject, viewImageSubject } from './subjects.ts';

/** Largest serialized `response_format.schema` of a job frame, in bytes (decision 0049: 64 KiB). */
export const MAX_RESPONSE_FORMAT_BYTES = 65_536;

/** Checks a value against reflection.schema.json (the sleep reflection output). Never throws. */
export function validateReflection(value: unknown): ValidationResult<Reflection> {
  if (validateReflectionSchema(value)) return { ok: true, value: value as Reflection };
  return { ok: false, errors: (validateReflectionSchema.errors ?? []).map(formatError) };
}

/** Checks a value against snapshot-request.schema.json. Never throws. */
export function validateSnapshotRequest(value: unknown): ValidationResult<SnapshotRequest> {
  if (validateSnapshotRequestSchema(value)) return { ok: true, value: value as SnapshotRequest };
  return { ok: false, errors: (validateSnapshotRequestSchema.errors ?? []).map(formatError) };
}

/** Checks a value against plan.schema.json (the Mind's plan message, thought included). Never throws. */
export function validatePlanMessage(value: unknown): ValidationResult<PlanMessage> {
  if (validatePlanMessageSchema(value)) return { ok: true, value: value as PlanMessage };
  return { ok: false, errors: (validatePlanMessageSchema.errors ?? []).map(formatError) };
}

/** Checks a value against plan-ack.schema.json (the Body's quick reply to a plan). Never throws. */
export function validatePlanAck(value: unknown): ValidationResult<PlanAck> {
  if (validatePlanAckSchema(value)) return { ok: true, value: value as PlanAck };
  return { ok: false, errors: (validatePlanAckSchema.errors ?? []).map(formatError) };
}

/** Checks a value against plan-result-event.schema.json (the payload of a `plan_result` event). Never throws. */
export function validatePlanResultPayload(value: unknown): ValidationResult<PlanResultPayload> {
  if (validatePlanResultPayloadSchema(value)) {
    return { ok: true, value: value as PlanResultPayload };
  }
  return { ok: false, errors: (validatePlanResultPayloadSchema.errors ?? []).map(formatError) };
}

/** Checks a value against speech-event.schema.json (the payload of a `speech` event). Never throws. */
export function validateSpeechPayload(value: unknown): ValidationResult<SpeechPayload> {
  if (validateSpeechPayloadSchema(value)) return { ok: true, value: value as SpeechPayload };
  return { ok: false, errors: (validateSpeechPayloadSchema.errors ?? []).map(formatError) };
}

/** Checks a value against thought-event.schema.json (the payload of a `thought` event). Never throws. */
export function validateThoughtEventPayload(value: unknown): ValidationResult<ThoughtEventPayload> {
  if (validateThoughtEventPayloadSchema(value)) {
    return { ok: true, value: value as ThoughtEventPayload };
  }
  return { ok: false, errors: (validateThoughtEventPayloadSchema.errors ?? []).map(formatError) };
}
