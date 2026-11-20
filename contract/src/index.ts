/**
 * Public surface of @geldar/contract: the generated types and one typed validator
 * per schema. Each packet fills only its own marked block below.
 */
import type { ValidateFunction } from 'ajv';
import type { Snapshot } from './generated/types.ts';
import { validateSnapshot as validateSnapshotSchema } from './generated/validators.js';
import { formatError, type ValidationResult } from './validation.ts';

export { MARKER_WORD, markedWords } from './agent-text.ts';
export type {
  ExploreArguments,
  ExploreCheckpoint,
  ExploreDetail,
  FarmArguments,
  FarmCell,
  FarmCheckpoint,
  FarmDetail,
  MaintenanceNotice,
  PatrolArguments,
  PatrolCheckpoint,
  PatrolDetail,
  ProgramBlock,
  ProgramChunk,
  Snapshot,
} from './generated/types.ts';
export {
  validateExploreArguments,
  validateExploreCheckpoint,
  validateExploreDetail,
  validateFarmArguments,
  validateFarmCheckpoint,
  validateFarmDetail,
  validatePatrolArguments,
  validatePatrolCheckpoint,
  validatePatrolDetail,
} from './programs.ts';
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

export type { CombatFactPayload } from './evidence.ts';
export { encounterKey, validateCombatFactPayload } from './evidence.ts';
/** Observed-actor contract (AN-24, decision 0343, Proposed; nothing publishes these yet). */
export type { ObservationPayload, ObservedActor, Provenance } from './generated/types.ts';
/** Checks a heard_sound payload against heard-sound-event.schema.json (PX-4). Coordinates are rejected. */
export {
  validateHeardSoundEvent,
  validateObservationPayload,
  validateProvenance,
} from './generated/validators.js';
export { observationSentence } from './observation.ts';
export {
  provenanceBreakSubject,
  provenanceCombatSubject,
  provenancePickupSubject,
  provenanceTakeSubject,
  provenanceWildcard,
} from './subjects.ts';

/** Checks a value against event.schema.json. Never throws; unknown properties are rejected. */
export function validateWorldEvent(value: unknown): ValidationResult<WorldEvent> {
  if (validateWorldEventSchema(value)) return { ok: true, value: value as WorldEvent };
  return { ok: false, errors: (validateWorldEventSchema.errors ?? []).map(formatError) };
}

/** Checks a heard_muffled payload against heard-muffled-event.schema.json (decision 0199, MH-1). Coordinates are rejected. */
export { validateHeardMuffledPayload } from './generated/validators.js';

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

// --- see-tool ---
import { validateSeeInput as validateSeeInputSchema } from './generated/validators.js';

/** The optional pixel size a `see` call names: each axis optional, checked against the see input schema. */
export interface SeeInput {
  width?: number;
  height?: number;
}

/** Checks a `see` input against the see input schema. Never throws; an extra key or a non-integer size is rejected. */
export function validateSeeInput(value: unknown): ValidationResult<SeeInput> {
  if (validateSeeInputSchema(value)) return { ok: true, value: value as SeeInput };
  return { ok: false, errors: (validateSeeInputSchema.errors ?? []).map(formatError) };
}

import { validateSeeResult as validateSeeResultSchema } from './generated/validators.js';

/** The picture reply the Body gives for `see`, checked against the see result schema. Never throws. */
export function validateSeeResult(value: unknown): ValidationResult<{ png: string }> {
  if (validateSeeResultSchema(value)) return { ok: true, value: value as { png: string } };
  return { ok: false, errors: (validateSeeResultSchema.errors ?? []).map(formatError) };
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

import { MAX_RESPONSE_FORMAT_BYTES } from './mind-channel.ts';
export * from './mind-channel.ts';
export * from './sovereign.ts';
export * from './character.ts';
export * from './proficiency.ts';
export * from './turn-record.ts';
