// JSON stdout logger. Each line is stamped with trace_id and span_id when a span is active,
// and is also emitted as an OTLP log record (a no-op until the SDK registers a provider).
// Logging never throws into the caller.

import { isSpanContextValid, logs, SeverityNumber, trace } from '@opentelemetry/api';
import { filterAttributes } from './attributes.ts';

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
}

const SEVERITY: Record<LogLevel, SeverityNumber> = {
  debug: SeverityNumber.DEBUG,
  info: SeverityNumber.INFO,
  warn: SeverityNumber.WARN,
  error: SeverityNumber.ERROR,
};

export function createLogger(options: LoggerOptions): Logger {
  const write = options.write ?? ((line: string) => void process.stdout.write(line));

  const log = (level: LogLevel, event: string, fields: LogFields = {}): void => {
    try {
      const { attributes } = filterAttributes(fields, 'log');
      const sc = trace.getActiveSpan()?.spanContext();
      const ids = sc && isSpanContextValid(sc) ? { trace_id: sc.traceId, span_id: sc.spanId } : {};
      const row = { ...attributes, at: new Date().toISOString(), level, event, ...ids };
      write(`${JSON.stringify(row)}\n`);
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
