// --- WM-01 sovereign ---
import type {
  ActionOutcomePayload,
  BookReply,
  BookRequest,
  DayNightPayload,
  PresenceRecord,
  SovereignCallPayload,
} from './generated/types.ts';
import {
  validateActionOutcomePayload as validateActionOutcomePayloadSchema,
  validateBookReply as validateBookReplySchema,
  validateBookRequest as validateBookRequestSchema,
  validateDayNightPayload as validateDayNightPayloadSchema,
  validatePresenceRecord as validatePresenceRecordSchema,
  validateSovereignCallPayload as validateSovereignCallPayloadSchema,
} from './generated/validators.js';
import { formatError, type ValidationResult } from './validation.ts';

export type {
  BlockOwnerChanged,
  BlockOwnerQuery,
  BlockOwnerReply,
  BookReply,
  BookRequest,
  DayNightPayload,
  OwnedBlock,
  PresenceRecord,
  SovereignCallPayload,
} from './generated/types.ts';
export { validateBlockOwner, validateMaintenanceNotice } from './generated/validators.js';
export {
  blockownerChangedSubject,
  blockownerQuerySubject,
  bookSubject,
  CTL_BODY_OPS,
  ctlBodySubject,
  ctlBodyWildcard,
  hearingSubject,
  kinoFeedSubject,
  maintenanceSubject,
  PRESENCE_BUCKET,
  surveySubject,
  viewSubject,
} from './subjects.ts';

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
