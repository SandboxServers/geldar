import type { ServerResponse } from 'node:http';
import { SECURITY_HEADERS } from './pages.ts';

/** Every code an owner API error may carry. The OpenAPI problem schema lists the same set (a register test checks it). */
export const PROBLEM_CODES = [
  'not_found',
  'method_not_allowed',
  'unauthenticated',
  'csrf_required',
  'scope_missing',
  'invalid',
  'conflict',
  'rate_limited',
  'quota',
  'unavailable',
  'body_unavailable',
  'internal',
] as const;

export type ProblemCode = (typeof PROBLEM_CODES)[number];

const STATUS: Record<ProblemCode, number> = {
  not_found: 404,
  method_not_allowed: 405,
  unauthenticated: 401,
  csrf_required: 403,
  scope_missing: 403,
  invalid: 422,
  conflict: 409,
  rate_limited: 429,
  quota: 429,
  unavailable: 503,
  body_unavailable: 503,
  internal: 500,
};

const TITLE: Record<ProblemCode, string> = {
  not_found: 'Not found',
  method_not_allowed: 'Method not allowed',
  unauthenticated: 'Authentication required',
  csrf_required: 'CSRF token required',
  scope_missing: 'Key scope missing',
  invalid: 'Invalid request',
  conflict: 'Conflict',
  rate_limited: 'Too many requests',
  quota: 'Body quota reached',
  unavailable: 'Service unavailable',
  body_unavailable: 'Body unavailable',
  internal: 'Internal error',
};

/**
 * The one place a problem body is built (application/problem+json, RFC 9457 shape). The body carries a detail
 * only when the caller passes one, and that text is always a fixed string of the register, never a supervisor
 * or model string. Without a detail one kind of refusal has one body: a foreign agent and a missing one are byte-equal.
 */
export function sendProblem(
  res: ServerResponse,
  code: ProblemCode,
  extra: Record<string, string> = {},
  detail?: string,
): void {
  const status = STATUS[code];
  res.writeHead(status, {
    'content-type': 'application/problem+json',
    ...SECURITY_HEADERS,
    ...extra,
  });
  const body = { type: 'about:blank', title: TITLE[code], status, code };
  res.end(JSON.stringify(detail === undefined ? body : { ...body, detail }));
}
