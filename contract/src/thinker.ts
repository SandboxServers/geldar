import type { ValidateFunction } from 'ajv';
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
import { MAX_RESPONSE_FORMAT_BYTES } from './mind-channel.ts';
import { formatError, type ValidationResult } from './validation.ts';

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
