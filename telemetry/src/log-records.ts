// Ships one MCP log line as an OTLP log record. Only the fields below leave the process: the player id,
// the cause and every other key are dropped here, so no token, header, address, body or name reaches a
// record. Emitting never throws into the caller; the stderr line the caller also writes stands either way.

import { logs } from '@opentelemetry/api';

/** The log scope every MCP record is emitted under. */
export const LOG_SCOPE = 'geldar-mcp';

/**
 * The keys a record carries, in this order. Any other key of a line is dropped. `error` leaves as
 * `error.type` (the class or template name), the one error key the SDK allow-list keeps.
 */
const RECORD_FIELDS = ['event', 'status', 'reason', 'tool', 'outcome', 'duration_ms'] as const;

/** Pre-auth noise the MCP mock answers (a probe, a bad path or body): its lines are never shipped. */
const NOISE_EVENTS: ReadonlySet<string> = new Set([
  'not_found',
  'host_rejected',
  'method_not_allowed',
  'body_too_large',
  'body_timeout',
  'parse_error',
]);

/** Failures, always ERROR whatever their status: a closed list. */
const FAILURE_EVENTS: ReadonlySet<string> = new Set([
  'auth_unavailable',
  'postgres_pool_error',
  'stop_failed',
  'close_failed',
]);

/** OpenTelemetry severity numbers for INFO, WARN and ERROR, written out so no extra import is needed. */
const SEVERITY_NUMBER = { INFO: 9, WARN: 13, ERROR: 17 } as const;

type Severity = keyof typeof SEVERITY_NUMBER;

/**
 * True for the lines that ship as records: a tool_call (it has an outcome), a 4xx or 5xx refusal and a
 * line that carries an error. The pre-auth noise is never shipped, even with an error or a 4xx.
 * Routine request lines (session_request, initialize, stream opens) stay on stderr only.
 */
export function isShippedRecord(line: Record<string, unknown>): boolean {
  const { event, status, outcome, error } = line;
  if (typeof event === 'string' && NOISE_EVENTS.has(event)) return false;
  if (outcome !== undefined) return true;
  if (typeof status === 'number' && status >= 400) return true;
  return error !== undefined;
}

/**
 * ERROR for a failure event, a 5xx or an `internal` outcome; WARN for a 4xx, another non-ok outcome,
 * or an error with no status; INFO otherwise.
 */
function severityOf(attributes: Record<string, string | number>): Severity {
  const { event, status, outcome } = attributes;
  if (typeof status === 'number' && status >= 500) return 'ERROR';
  if (outcome === 'internal') return 'ERROR';
  if (typeof event === 'string' && FAILURE_EVENTS.has(event)) return 'ERROR';
  if (typeof status === 'number' && status >= 400) return 'WARN';
  if (outcome !== undefined && outcome !== 'ok') return 'WARN';
  if (status === undefined && attributes['error.type'] !== undefined) return 'WARN';
  return 'INFO';
}

/** Emits one OTLP log record for a log line; the line is never changed and no error escapes. */
export function emitLogRecord(line: Record<string, unknown>): void {
  try {
    const attributes: Record<string, string | number> = {};
    for (const key of RECORD_FIELDS) {
      const value = line[key];
      if (typeof value === 'string' || typeof value === 'number') attributes[key] = value;
    }
    const error = line.error;
    if (typeof error === 'string' || typeof error === 'number') {
      attributes['error.type'] = error;
    }
    const severity = severityOf(attributes);
    logs.getLogger(LOG_SCOPE).emit({
      severityNumber: SEVERITY_NUMBER[severity],
      severityText: severity,
      body: typeof attributes.event === 'string' ? attributes.event : 'log',
      attributes,
    });
  } catch {
    // The record is lost; the request and its stderr line stand.
  }
}
