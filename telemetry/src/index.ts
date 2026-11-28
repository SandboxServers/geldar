export {
  type AttrValue,
  attributeDropCount,
  type DroppedAttribute,
  type DropReason,
  type FilteredAttributes,
  filterAttributes,
  hasForbiddenSegment,
  type TelemetryScope,
} from './attributes.ts';
export {
  addContentEvent,
  type CappedText,
  CONTENT_CAP_BYTES,
  capText,
  contentAttributes,
  type EventSpan,
} from './content.ts';
export { emitLogRecord, isShippedRecord } from './log-records.ts';
export { createLogger, type LogFields, type Logger, type LogLevel } from './logger.ts';
export { extractTrace, type HeaderLike, injectTrace } from './nats-trace.ts';
export {
  type ErrorFields,
  errorFields,
  MAX_ERROR_TEXT_CHARS,
  REDACTED,
  redactContent,
  scrubText,
} from './redact.ts';
export {
  EXPORT_TIMEOUT_MS,
  type QueueLimits,
  startTelemetry,
  type TelemetryExporters,
  type TelemetryHandle,
  type TelemetryOptions,
} from './sdk.ts';
