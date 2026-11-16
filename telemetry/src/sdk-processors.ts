// SDK-level enforcement: every span and log record passes the allow-list before it reaches a batch
// processor, so raw OpenTelemetry API calls are filtered the same as the helpers' output.
// Processors never throw into the caller.

import type { Attributes, Context } from '@opentelemetry/api';
import type { LogRecordProcessor } from '@opentelemetry/sdk-logs';
import type { ReadableSpan, Span, SpanProcessor } from '@opentelemetry/sdk-trace';
import { type AttrValue, filterAttributes, type TelemetryScope } from './attributes.ts';

type LogRecordLike = Parameters<LogRecordProcessor['onEmit']>[0];

/** Metric View processor: every data point keeps only the metric label allow-list. */
export const metricLabelProcessor = {
  process(incoming: Attributes): Attributes {
    return filterAttributes(incoming, 'metric').attributes;
  },
};

function allowed(input: Record<string, unknown>, scope: TelemetryScope): Record<string, AttrValue> {
  return filterAttributes(input, scope).attributes;
}

/** Replaces every key of `target` in place with the keys of `next`. */
function replaceKeys(target: Record<string, unknown>, next: Record<string, unknown>): void {
  for (const key of Object.keys(target)) delete target[key];
  Object.assign(target, next);
}

/** Filters span and span-event attributes (scope `trace`) before the wrapped processor sees the span. */
export class AllowListSpanProcessor implements SpanProcessor {
  private readonly inner: SpanProcessor;

  constructor(inner: SpanProcessor) {
    this.inner = inner;
  }

  onStart(span: Span, parentContext: Context): void {
    this.inner.onStart(span, parentContext);
  }

  onEnd(span: ReadableSpan): void {
    try {
      replaceKeys(span.attributes, allowed(span.attributes, 'trace'));
      for (const event of span.events) {
        event.attributes = allowed(event.attributes ?? {}, 'trace') as NonNullable<
          typeof event.attributes
        >;
      }
      for (const link of span.links) {
        link.attributes = allowed(link.attributes ?? {}, 'trace') as NonNullable<
          typeof link.attributes
        >;
      }
    } catch {
      // A failing filter must not break the caller; the span is still exported.
    }
    this.inner.onEnd(span);
  }

  forceFlush(): Promise<void> {
    return this.inner.forceFlush();
  }

  shutdown(): Promise<void> {
    return this.inner.shutdown();
  }
}

/** Filters log record attributes (scope `log`) before the wrapped processor sees the record. */
export class AllowListLogProcessor implements LogRecordProcessor {
  private readonly inner: LogRecordProcessor;

  constructor(inner: LogRecordProcessor) {
    this.inner = inner;
  }

  onEmit(record: LogRecordLike, context?: Context): void {
    try {
      replaceKeys(record.attributes, allowed(record.attributes, 'log'));
    } catch {
      // A failing filter must not break the caller; the record is still emitted.
    }
    this.inner.onEmit(record, context);
  }

  forceFlush(): Promise<void> {
    return this.inner.forceFlush();
  }

  shutdown(): Promise<void> {
    return this.inner.shutdown();
  }
}
