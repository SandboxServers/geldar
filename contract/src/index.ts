/**
 * Public surface of @geldar/contract: the generated types and one typed validator
 * per schema. Each packet fills only its own marked block below.
 */
import type { ErrorObject, ValidateFunction } from 'ajv';
import type { Snapshot } from './generated/types.ts';
import { validateSnapshot as validateSnapshotSchema } from './generated/validators.js';

export type { Snapshot } from './generated/types.ts';

/**
 * Validation outcome. Errors are "<instancePath> <message>", e.g. "/self/health must be <= 20".
 */
export type ValidationResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };

/** Formats one Ajv error; the property name of additionalProperties/required is appended when the message omits it. */
function formatError(error: ErrorObject): string {
  const where = error.instancePath === '' ? '""' : error.instancePath;
  const params = error.params as Record<string, unknown>;
  const name = params.additionalProperty ?? params.missingProperty;
  const quoted = typeof name === 'string' ? `'${name}'` : '';
  const suffix = quoted !== '' && !(error.message ?? '').includes(quoted) ? ` ${quoted}` : '';
  return `${where} ${error.message ?? 'is invalid'}${suffix}`;
}

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
  if (validateThinkerFrameSchema(value)) return { ok: true, value: value as ThinkerFrame };
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
