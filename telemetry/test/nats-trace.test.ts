import { type Context, propagation, ROOT_CONTEXT, trace } from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { describe, expect, it } from 'vitest';
import { extractTrace, type HeaderLike, injectTrace } from '../src/nats-trace.ts';

// A minimal stand-in for nats.js MsgHdrs: the same get/set/has shape.
class FakeHeaders implements HeaderLike {
  private readonly map = new Map<string, string>();
  get(name: string): string | undefined {
    return this.map.get(name);
  }
  set(name: string, value: string): void {
    this.map.set(name, value);
  }
  has(name: string): boolean {
    return this.map.has(name);
  }
  names(): string[] {
    return [...this.map.keys()];
  }
}

const TRACE_ID = '0af7651916cd43dd8448eb211c80319c';
const SPAN_ID = 'b7ad6b7169203331';

function spanContext(): Context {
  return trace.setSpanContext(ROOT_CONTEXT, { traceId: TRACE_ID, spanId: SPAN_ID, traceFlags: 1 });
}

describe('NATS trace propagation', () => {
  it('round-trips the trace id and span id through traceparent', () => {
    const headers = new FakeHeaders();
    injectTrace(headers, spanContext());
    expect(headers.get('traceparent')).toBe(`00-${TRACE_ID}-${SPAN_ID}-01`);
    const extracted = extractTrace(headers);
    expect(trace.getSpanContext(extracted)).toMatchObject({ traceId: TRACE_ID, spanId: SPAN_ID });
  });

  it('never injects baggage, even when the context carries baggage', () => {
    const baggage = propagation.createBaggage({ user: { value: 'owner-secret' } });
    const ctx = propagation.setBaggage(spanContext(), baggage);
    const headers = new FakeHeaders();
    injectTrace(headers, ctx);
    expect(headers.names()).toEqual(['traceparent']);
    expect(headers.has('baggage')).toBe(false);
  });

  it('injects traceparent only when the context carries trace state and baggage', () => {
    // Build the trace state through the W3C propagator: the API does not export a TraceState constructor.
    const withState = new W3CTraceContextPropagator().extract(
      ROOT_CONTEXT,
      { traceparent: `00-${TRACE_ID}-${SPAN_ID}-01`, tracestate: 'vendor=x' },
      { get: (c, k) => c[k], keys: (c) => Object.keys(c) },
    );
    expect(trace.getSpanContext(withState)?.traceState?.get('vendor')).toBe('x');
    const baggage = propagation.createBaggage({ user: { value: 'owner-secret' } });
    const headers = new FakeHeaders();
    injectTrace(headers, propagation.setBaggage(withState, baggage));
    // Exact equality: a copy-every-key injector would also write tracestate here.
    expect(headers.names()).toEqual(['traceparent']);
    expect(headers.has('tracestate')).toBe(false);
    expect(headers.has('baggage')).toBe(false);
  });

  it('ignores baggage and tracestate headers on the way in', () => {
    const headers = new FakeHeaders();
    headers.set('traceparent', `00-${TRACE_ID}-${SPAN_ID}-01`);
    headers.set('tracestate', 'vendor=x');
    headers.set('baggage', 'user=owner-secret');
    const extracted = extractTrace(headers);
    expect(trace.getSpanContext(extracted)?.traceId).toBe(TRACE_ID);
    expect(propagation.getBaggage(extracted)).toBeUndefined();
  });

  it('returns the base context when traceparent is absent or malformed', () => {
    expect(trace.getSpan(extractTrace(new FakeHeaders()))).toBeUndefined();
    const bad = new FakeHeaders();
    bad.set('traceparent', 'not-a-trace');
    expect(() => extractTrace(bad)).not.toThrow();
    expect(trace.getSpan(extractTrace(bad))).toBeUndefined();
  });

  it('does not throw into a publish when the header set fails', () => {
    const broken: HeaderLike = {
      get: () => undefined,
      has: () => false,
      set: () => {
        throw new Error('header set failed');
      },
    };
    expect(() => injectTrace(broken, spanContext())).not.toThrow();
  });
});
