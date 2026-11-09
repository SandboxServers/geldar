/** Shared by every validator wrapper in index.ts and mcp.ts. */
import type { ErrorObject } from 'ajv';

/**
 * Validation outcome. Errors are "<instancePath> <message>", e.g. "/self/health must be <= 20".
 */
export type ValidationResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };

/** Formats one Ajv error; the property name of additionalProperties/required is appended when the message omits it. */
export function formatError(error: ErrorObject): string {
  const where = error.instancePath === '' ? '""' : error.instancePath;
  const params = error.params as Record<string, unknown>;
  const name = params.additionalProperty ?? params.missingProperty;
  const quoted = typeof name === 'string' ? `'${name}'` : '';
  const suffix = quoted !== '' && !(error.message ?? '').includes(quoted) ? ` ${quoted}` : '';
  return `${where} ${error.message ?? 'is invalid'}${suffix}`;
}
