// JSON stdout logger. Each line keeps every caller field except forbidden names (credentials, emails),
// and is stamped with trace_id and span_id when a span is active. The same record is also emitted as an
// OTLP log record, where only allow-listed attributes pass (plus `extraKeys`). A no-op until the SDK
// registers a provider. Logging never throws into the caller.

import { isSpanContextValid, logs, SeverityNumber, trace } from '@opentelemetry/api';
import { allowLogKeys, filterAttributes } from './attributes.ts';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogFields = Record<string, string | number | boolean | undefined | null>;

export interface Logger {
  log(level: LogLevel, event: string, fields?: LogFields): void;
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
}

export interface LoggerOptions {
  name: string;
  write?: (line: string) => void;
  /** Extra field names this service may send to OTLP, on top of the allow-list. Process-wide. */
  extraKeys?: readonly string[];
}

const SEVERITY: Record<LogLevel, SeverityNumber> = {
  debug: SeverityNumber.DEBUG,
  info: SeverityNumber.INFO,
  warn: SeverityNumber.WARN,
  error: SeverityNumber.ERROR,
};

export function createLogger(options: LoggerOptions): Logger {
  const write = options.write ?? ((line: string) => void process.stdout.write(line));
  if (options.extraKeys !== undefined) allowLogKeys(options.extraKeys);

  const log = (level: LogLevel, event: string, fields: LogFields = {}): void => {
    try {
      const { attributes: stdoutFields } = filterAttributes(fields, 'stdout');
      const sc = trace.getActiveSpan()?.spanContext();
      const ids = sc && isSpanContextValid(sc) ? { trace_id: sc.traceId, span_id: sc.spanId } : {};
      const row = { ...stdoutFields, at: new Date().toISOString(), level, event, ...ids };
      write(`${JSON.stringify(row)}\n`);
      const { attributes } = filterAttributes(fields, 'log');
      logs.getLogger(options.name).emit({
        severityNumber: SEVERITY[level],
        severityText: level.toUpperCase(),
        body: event,
        attributes: { ...attributes, event, ...ids },
      });
    } catch {
      // A failing sink must not break the caller.
    }
  };

  return {
    log,
    debug: (event, fields) => log('debug', event, fields),
    info: (event, fields) => log('info', event, fields),
    warn: (event, fields) => log('warn', event, fields),
    error: (event, fields) => log('error', event, fields),
  };
}
