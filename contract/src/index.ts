/**
 * Public surface of @geldar/contract: the generated types and one typed validator
 * per schema. Each packet fills only its own marked block below.
 */
import type { ErrorObject } from 'ajv';
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

// --- P0-04 thinker ---
