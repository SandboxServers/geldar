// One OpenTelemetry span per MCP tool call (T-06). The span carries only the fields named in
// TOOL_SPAN_FIELDS below; the @geldar/telemetry span processor filters the attributes again.
// Off unless the telemetry endpoint is set: main.ts then passes no recorder, so no span is made.

import { type AttrValue, filterAttributes } from '@geldar/telemetry';

/** The span name: one per call, so a trace list reads by tool. */
export const TOOL_SPAN_NAME = 'mcp.tool_call';

/** What the tool-call wrapper knows about one finished call. Nothing else reaches the span. */
export interface ToolCallSpan {
  tool: string;
  /** The closed outcome code: `ok`, or the tool's own error code, or `internal`. */
  outcome: string;
  durationMs: number;
}

/** The part of an OpenTelemetry tracer the recorder uses. Structural, so a test can pass a fake. */
export interface SpanTracer {
  startSpan(
    name: string,
    options?: { startTime?: number },
  ): {
    setAttributes(attributes: Record<string, AttrValue>): unknown;
    end(endTime?: number): void;
  };
}

/**
 * The explicit allow-list: which call field becomes which span attribute. Anything else on the
 * input (an argument, a result, a credential) is never copied.
 */
const TOOL_SPAN_FIELDS = {
  tool: 'gen_ai.tool.name',
  outcome: 'outcome',
} as const;

/**
 * The span attributes for one call. A failed call also gets `error.type`, which is its outcome code
 * (a closed code, never the error message).
 */
export function toolSpanAttributes(call: ToolCallSpan): Record<string, AttrValue> {
  const picked: Record<string, unknown> = {};
  picked[TOOL_SPAN_FIELDS.tool] = call.tool;
  picked[TOOL_SPAN_FIELDS.outcome] = call.outcome;
  if (call.outcome !== 'ok') picked['error.type'] = call.outcome;
  return filterAttributes(picked, 'trace').attributes;
}

/**
 * Returns the recorder that makes one span per call. The span starts `durationMs` before now and ends
 * now, so its duration is the call's duration. The input is copied through the explicit allow-list.
 */
export function toolSpanRecorder(tracer: SpanTracer): (call: ToolCallSpan) => void {
  return (call) => {
    const end = Date.now();
    const span = tracer.startSpan(TOOL_SPAN_NAME, { startTime: end - call.durationMs });
    span.setAttributes(toolSpanAttributes(call));
    span.end(end);
  };
}
