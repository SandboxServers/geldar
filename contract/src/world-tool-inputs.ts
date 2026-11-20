import { formatError, type ValidationResult } from './validation.ts';

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
