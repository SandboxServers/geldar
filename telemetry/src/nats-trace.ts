// W3C trace context over NATS headers. Only `traceparent` crosses the wire: never Baggage,
// never tracestate. Not carrying tracestate is a deliberate narrowing of decision 0350 point 7,
// because vendor state could carry unreviewed data (survey 3.4 and 9.9). The HeaderLike type is
// structural, so this module needs no NATS import (nats MsgHdrs satisfies it).

import { type Context, context, ROOT_CONTEXT } from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';

export interface HeaderLike {
  get(name: string): string | undefined;
  set(name: string, value: string): void;
  has(name: string): boolean;
}

const TRACEPARENT = 'traceparent';
const propagator = new W3CTraceContextPropagator();

const setter = {
  set(carrier: Record<string, string>, key: string, value: string): void {
    carrier[key] = value;
  },
};
const getter = {
  get(carrier: Record<string, string>, key: string): string | undefined {
    return carrier[key];
  },
  keys(carrier: Record<string, string>): string[] {
    return Object.keys(carrier);
  },
};

/** Writes `traceparent` for `ctx` (default: the active context). Never throws. */
export function injectTrace(headers: HeaderLike, ctx: Context = context.active()): void {
  try {
    const carrier: Record<string, string> = {};
    propagator.inject(ctx, carrier, setter);
    const traceparent = carrier[TRACEPARENT];
    if (traceparent !== undefined) headers.set(TRACEPARENT, traceparent);
  } catch {
    // Tracing must never break a publish.
  }
}

/** Reads `traceparent` only; any other header is ignored. Returns `base` when absent or invalid. */
export function extractTrace(headers: HeaderLike, base: Context = ROOT_CONTEXT): Context {
  try {
    const traceparent = headers.has(TRACEPARENT) ? headers.get(TRACEPARENT) : undefined;
    if (traceparent === undefined || traceparent === '') return base;
    return propagator.extract(base, { [TRACEPARENT]: traceparent }, getter);
  } catch {
    return base;
  }
}
