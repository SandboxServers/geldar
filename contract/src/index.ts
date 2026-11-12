/**
 * Public surface of @geldar/contract: the generated types and one typed validator
 * per schema. Each packet fills only its own marked block below.
 */
import type { ValidateFunction } from 'ajv';
import type { Snapshot } from './generated/types.ts';
import { validateSnapshot as validateSnapshotSchema } from './generated/validators.js';
import { formatError, type ValidationResult } from './validation.ts';

export { MARKER_WORD, markedWords } from './agent-text.ts';
export type { Snapshot } from './generated/types.ts';
export type { ValidationResult } from './validation.ts';

// --- P0-01 snapshot ---
/** Checks a value against snapshot.schema.json. Never throws; unknown properties are rejected. */
export function validateSnapshot(value: unknown): ValidationResult<Snapshot> {
  if (validateSnapshotSchema(value)) return { ok: true, value: value as Snapshot };
  return { ok: false, errors: (validateSnapshotSchema.errors ?? []).map(formatError) };
}

// --- P0-02 thought ---
import type { Thought } from './generated/types.ts';
import { validateThought as validateThoughtSchema } from './generated/validators.js';

export type { Action, Intent, Thought } from './generated/types.ts';

/** Checks a value against thought.schema.json. Never throws; unknown properties are rejected. */
export function validateThought(value: unknown): ValidationResult<Thought> {
  if (validateThoughtSchema(value)) return { ok: true, value: value as Thought };
  return { ok: false, errors: (validateThoughtSchema.errors ?? []).map(formatError) };
}

// --- P0-03 records ---
import type { ActionRecord, Receipt, WorldEvent } from './generated/types.ts';
import {
  validateActionRecord as validateActionRecordSchema,
  validateReceipt as validateReceiptSchema,
  validateWorldEvent as validateWorldEventSchema,
} from './generated/validators.js';

export type { ActionRecord, Receipt, WorldEvent } from './generated/types.ts';

/** Checks a value against action-record.schema.json. Never throws; unknown properties are rejected. */
export function validateActionRecord(value: unknown): ValidationResult<ActionRecord> {
  if (validateActionRecordSchema(value)) return { ok: true, value: value as ActionRecord };
  return { ok: false, errors: (validateActionRecordSchema.errors ?? []).map(formatError) };
}

/** Checks a value against receipt.schema.json. Never throws; unknown properties are rejected. */
export function validateReceipt(value: unknown): ValidationResult<Receipt> {
  if (validateReceiptSchema(value)) return { ok: true, value: value as Receipt };
  return { ok: false, errors: (validateReceiptSchema.errors ?? []).map(formatError) };
}

/** Checks a value against event.schema.json. Never throws; unknown properties are rejected. */
export function validateWorldEvent(value: unknown): ValidationResult<WorldEvent> {
  if (validateWorldEventSchema(value)) return { ok: true, value: value as WorldEvent };
  return { ok: false, errors: (validateWorldEventSchema.errors ?? []).map(formatError) };
}

/** Checks a heard_sound payload against heard-sound-event.schema.json (PX-4). Coordinates are rejected. */
export { validateHeardSoundEvent } from './generated/validators.js';

// --- P0-17 record events ---
import type { IntentEventPayload, ReflexFiredPayload, WakePayload } from './generated/types.ts';
import {
  validateIntentEventPayload as validateIntentEventPayloadSchema,
  validateReflexFiredPayload as validateReflexFiredPayloadSchema,
  validateWakePayload as validateWakePayloadSchema,
} from './generated/validators.js';

export type { IntentEventPayload, ReflexFiredPayload, WakePayload } from './generated/types.ts';

/** Checks a value against intent-event.schema.json (the payload of an `intent` event). Never throws. */
export function validateIntentEventPayload(value: unknown): ValidationResult<IntentEventPayload> {
  if (validateIntentEventPayloadSchema(value)) {
    return { ok: true, value: value as IntentEventPayload };
  }
  return { ok: false, errors: (validateIntentEventPayloadSchema.errors ?? []).map(formatError) };
}

/** Checks a value against reflex-fired-event.schema.json (the payload of a `reflex_fired` event). Never throws. */
export function validateReflexFiredPayload(value: unknown): ValidationResult<ReflexFiredPayload> {
  if (validateReflexFiredPayloadSchema(value)) {
    return { ok: true, value: value as ReflexFiredPayload };
  }
  return { ok: false, errors: (validateReflexFiredPayloadSchema.errors ?? []).map(formatError) };
}

/** Checks a value against wake-event.schema.json (the payload of a `wake` event). Never throws. */
export function validateWakePayload(value: unknown): ValidationResult<WakePayload> {
  if (validateWakePayloadSchema(value)) return { ok: true, value: value as WakePayload };
  return { ok: false, errors: (validateWakePayloadSchema.errors ?? []).map(formatError) };
}

// --- PX-8b reach ---
import { validateReachInput as validateReachInputSchema } from './generated/validators.js';

/** The position a `reach` call names: three integers, each checked against mcp-reach.schema.json. */
export interface ReachPosition {
  x: number;
  y: number;
  z: number;
}

/** Checks a `reach` input against mcp-reach.schema.json. Never throws; a missing axis or an extra key is rejected. */
export function validateReachInput(value: unknown): ValidationResult<ReachPosition> {
  if (validateReachInputSchema(value)) return { ok: true, value: value as ReachPosition };
  return { ok: false, errors: (validateReachInputSchema.errors ?? []).map(formatError) };
}

// --- view-tool ---
import {
  validateViewInput as validateViewInputSchema,
  validateViewResult as validateViewResultSchema,
} from './generated/validators.js';

/** The optional grid size a `view` call names: each axis optional, checked against mcp-view.schema.json. */
export interface ViewInput {
  cols?: number;
  rows?: number;
}

/** The viewport as text, checked against mcp-view.schema.json. */
export interface ViewResult {
  text: string;
}

/** Checks a `view` input against mcp-view.schema.json. Never throws; an extra key or an out-of-range size is rejected. */
export function validateViewInput(value: unknown): ValidationResult<ViewInput> {
  if (validateViewInputSchema(value)) return { ok: true, value: value as ViewInput };
  return { ok: false, errors: (validateViewInputSchema.errors ?? []).map(formatError) };
}

/** Checks a `view` result against mcp-view.schema.json. Never throws; a text over 4000 characters is rejected. */
export function validateViewResult(value: unknown): ValidationResult<ViewResult> {
  if (validateViewResultSchema(value)) return { ok: true, value: value as ViewResult };
  return { ok: false, errors: (validateViewResultSchema.errors ?? []).map(formatError) };
}

// --- SC-30a mcp ---
export * from './mcp.ts';

// --- P0-04 thinker ---
import type { ThinkerFrame } from './generated/types.ts';
import {
  validateCancelFrame,
  validateCompletionFrame,
  validateDrainFrame,
  validateErrorFrame,
  validateGoodbyeFrame,
  validateHeartbeatFrame,
  validateHelloFrame,
  validateJobFrame,
  validateThinkerFrame as validateThinkerFrameSchema,
  validateWelcomeFrame,
} from './generated/validators.js';

export type {
  CancelFrame,
  CompletionFrame,
  DrainFrame,
  ErrorFrame,
  GoodbyeFrame,
  HeartbeatFrame,
  HelloFrame,
  JobFrame,
  ThinkerFrame,
  WelcomeFrame,
} from './generated/types.ts';

/** Largest frame the Gateway accepts, in bytes (Appendix H). */
export const MAX_FRAME_BYTES = 1_048_576;

/** Largest completion text, in characters (Appendix H: 32 KiB). */
export const MAX_COMPLETION_TEXT = 32_768;

/** The per-frame validator for each of the nine `type` values, in the order the schema lists them. */
const FRAME_VALIDATORS = new Map<string, ValidateFunction>([
  ['hello', validateHelloFrame],
  ['heartbeat', validateHeartbeatFrame],
  ['completion', validateCompletionFrame],
  ['error', validateErrorFrame],
  ['goodbye', validateGoodbyeFrame],
  ['welcome', validateWelcomeFrame],
  ['job', validateJobFrame],
  ['cancel', validateCancelFrame],
  ['drain', validateDrainFrame],
]);

/**
 * Checks a value against thinker-frame.schema.json. Never throws; unknown properties are rejected.
 * The errors are those of the frame named by `type`, so a bad hello reports only hello errors.
 * A value whose type is missing or not one of the nine reports the single error naming them.
 */
export function validateThinkerFrame(value: unknown): ValidationResult<ThinkerFrame> {
  if (validateThinkerFrameSchema(value)) {
    const format = (value as { response_format?: unknown }).response_format;
    if (
      format !== undefined &&
      new TextEncoder().encode(JSON.stringify(format)).length > MAX_RESPONSE_FORMAT_BYTES
    ) {
      return {
        ok: false,
        errors: [`/response_format must serialize to at most ${MAX_RESPONSE_FORMAT_BYTES} bytes`],
      };
    }
    return { ok: true, value: value as ThinkerFrame };
  }
  const type =
    typeof value === 'object' && value !== null ? (value as { type?: unknown }).type : undefined;
  const frameValidator = typeof type === 'string' ? FRAME_VALIDATORS.get(type) : undefined;
  if (frameValidator === undefined) {
    const names = [...FRAME_VALIDATORS.keys()].join(', ');
    return { ok: false, errors: [`/type must be one of ${names}`] };
  }
  if (frameValidator(value)) return { ok: true, value: value as ThinkerFrame };
  return { ok: false, errors: (frameValidator.errors ?? []).map(formatError) };
}

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
  heardSoundSentence,
  hurtSentence,
  intentWhy,
  isOutcomeReason,
  OUTCOME_REASONS,
  outcomeMessage,
  playerOutcomeText,
} from './outcome-words.ts';
export { planSubject, snapshotSubject } from './subjects.ts';

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

// --- WM-01 sovereign ---
import type {
  BookReply,
  BookRequest,
  DayNightPayload,
  PresenceRecord,
  SovereignCallPayload,
} from './generated/types.ts';
import {
  validateBookReply as validateBookReplySchema,
  validateBookRequest as validateBookRequestSchema,
  validateDayNightPayload as validateDayNightPayloadSchema,
  validatePresenceRecord as validatePresenceRecordSchema,
  validateSovereignCallPayload as validateSovereignCallPayloadSchema,
} from './generated/validators.js';

export type {
  BookReply,
  BookRequest,
  DayNightPayload,
  PresenceRecord,
  SovereignCallPayload,
} from './generated/types.ts';
export { bookSubject, kinoFeedSubject, PRESENCE_BUCKET, viewSubject } from './subjects.ts';

/** Checks a value against sovereign-call-event.schema.json (the payload of a `sovereign_call` event). Never throws. */
export function validateSovereignCallPayload(
  value: unknown,
): ValidationResult<SovereignCallPayload> {
  if (validateSovereignCallPayloadSchema(value)) {
    return { ok: true, value: value as SovereignCallPayload };
  }
  return { ok: false, errors: (validateSovereignCallPayloadSchema.errors ?? []).map(formatError) };
}

/** Checks a value against book-request.schema.json. Never throws; unknown properties are rejected. */
export function validateBookRequest(value: unknown): ValidationResult<BookRequest> {
  if (validateBookRequestSchema(value)) return { ok: true, value: value as BookRequest };
  return { ok: false, errors: (validateBookRequestSchema.errors ?? []).map(formatError) };
}

/** Checks a value against book-reply.schema.json. Never throws; unknown properties are rejected. */
export function validateBookReply(value: unknown): ValidationResult<BookReply> {
  if (validateBookReplySchema(value)) return { ok: true, value: value as BookReply };
  return { ok: false, errors: (validateBookReplySchema.errors ?? []).map(formatError) };
}

/** Checks a value against presence-record.schema.json. Never throws; unknown properties are rejected. */
export function validatePresenceRecord(value: unknown): ValidationResult<PresenceRecord> {
  if (validatePresenceRecordSchema(value)) return { ok: true, value: value as PresenceRecord };
  return { ok: false, errors: (validatePresenceRecordSchema.errors ?? []).map(formatError) };
}

/** Checks a value against day-night-event.schema.json (the payload of a `day_night` event). Never throws. */
export function validateDayNightPayload(value: unknown): ValidationResult<DayNightPayload> {
  if (validateDayNightPayloadSchema(value)) return { ok: true, value: value as DayNightPayload };
  return { ok: false, errors: (validateDayNightPayloadSchema.errors ?? []).map(formatError) };
}

/** Checks a value against action-outcome-event.schema.json (the payload of an action_outcome event). Never throws. */
export function validateActionOutcomePayload(
  value: unknown,
): ValidationResult<ActionOutcomePayload> {
  if (validateActionOutcomePayloadSchema(value)) {
    return { ok: true, value: value as ActionOutcomePayload };
  }
  return { ok: false, errors: (validateActionOutcomePayloadSchema.errors ?? []).map(formatError) };
}
