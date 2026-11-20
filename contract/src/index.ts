/**
 * Public surface of @geldar/contract: the generated types and one typed validator
 * per schema. Each packet fills only its own marked block below.
 */
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

export * from './perception-events.ts';
/** Checks a value against event.schema.json. Never throws; unknown properties are rejected. */
export function validateWorldEvent(value: unknown): ValidationResult<WorldEvent> {
  if (validateWorldEventSchema(value)) return { ok: true, value: value as WorldEvent };
  return { ok: false, errors: (validateWorldEventSchema.errors ?? []).map(formatError) };
}

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

export * from './world-tool-inputs.ts';
// --- SC-30a mcp ---
export * from './mcp.ts';

export * from './thinker.ts';
export * from './mind-channel.ts';
export * from './sovereign.ts';
export * from './character.ts';
export * from './proficiency.ts';
export * from './turn-record.ts';
