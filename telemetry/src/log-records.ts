// Ships one MCP log line as an OTLP log record. Only the fields below leave the process: the player id,
// the cause and every other key are dropped here, so no token, header, address, body or name reaches a
// record. Emitting never throws into the caller; the stderr line the caller also writes stands either way.

import { logs } from '@opentelemetry/api';

/** The log scope every MCP record is emitted under. */
export const LOG_SCOPE = 'geldar-mcp';

/** The only keys a record carries, in this order. Any other key of a line is dropped. */
const RECORD_FIELDS = [
  'event',
  'status',
  'reason',
  'tool',
  'outcome',
  'duration_ms',
  'error',
  'suppressed',
] as const;

/** OpenTelemetry severity numbers for INFO, WARN and ERROR, written out so no extra import is needed. */
const SEVERITY_NUMBER = { INFO: 9, WARN: 13, ERROR: 17 } as const;

type Severity = keyof typeof SEVERITY_NUMBER;

/** A 5xx or an `internal` outcome is an error; a 4xx or any other non-ok outcome is a warning. */
function severityOf(status: unknown, outcome: unknown): Severity {
  if ((typeof status === 'number' && status >= 500) || outcome === 'internal') return 'ERROR';
  if (
    (typeof status === 'number' && status >= 400) ||
    (outcome !== undefined && outcome !== 'ok')
  ) {
    return 'WARN';
  }
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
    const severity = severityOf(attributes.status, attributes.outcome);
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
