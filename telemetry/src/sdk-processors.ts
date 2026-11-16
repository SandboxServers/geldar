// SDK-level enforcement: every span and log record passes the allow-list before it reaches a batch
// processor, so raw OpenTelemetry API calls are filtered the same as the helpers' output.
// Processors never throw into the caller. A filter that fails clears the record (fail closed), and a
// record that cannot be cleared either is dropped.

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

/** Filters span, span-event and span-link attributes (scope `trace`) in place. Throws if a filter fails. */
function filterSpan(span: ReadableSpan): void {
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
}

/** Empties span, event and link attributes. Returns false when even that fails, so the span is dropped. */
function clearSpan(span: ReadableSpan): boolean {
  try {
    replaceKeys(span.attributes, {});
    for (const event of span.events) event.attributes = {};
    for (const link of span.links) link.attributes = {};
    return true;
  } catch {
    return false;
  }
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
      filterSpan(span);
    } catch {
      // Fail closed: a span whose filter failed keeps no attributes; if even clearing fails, it is dropped.
      if (!clearSpan(span)) return;
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
      // Fail closed: keep no attributes; a record that cannot even be cleared is dropped.
      try {
        replaceKeys(record.attributes, {});
      } catch {
        return;
      }
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
