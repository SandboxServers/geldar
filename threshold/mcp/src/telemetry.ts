// One OpenTelemetry span per MCP tool call (T-06). The span carries only the fields named in
// TOOL_SPAN_FIELDS below; the @geldar/telemetry span processor filters the attributes again.
// Tool arguments and results (T-06c) go in as span events, never as attributes or metric labels.
// Off unless the telemetry endpoint is set: main.ts then passes no recorder, so no span is made.

import { MCP_TOOL_NAMES } from '@geldar/contract';
import { ImageToolResult } from '@geldar/mcp-mock';
import {
  type AttrValue,
  addContentEvent,
  type ErrorFields,
  type EventSpan,
  filterAttributes,
  redactContent,
} from '@geldar/telemetry';

/** The span name: one per call, so a trace list reads by tool. */
export const TOOL_SPAN_NAME = 'mcp.tool_call';

/** The content event names: `geldar.content.tool_arguments` and `geldar.content.tool_result`. */
export const TOOL_ARGUMENTS_EVENT = 'tool_arguments';
export const TOOL_RESULT_EVENT = 'tool_result';
export const TOOL_ERROR_EVENT = 'tool_error';
export const TOOL_RESPONSE_EVENT = 'tool_response';

/** The span name for a refusal the front door reports (any status, with its closed reason code). */
export const AUTH_REFUSED_SPAN_NAME = 'mcp.auth_refused';
/** OpenTelemetry's SpanStatusCode.ERROR, written out so this file needs no new dependency. */
const SPAN_STATUS_ERROR = 2;

/**
 * What one call carries into its span, as events only: the raw arguments (the tool name as received is in the error and response text),
 * the handler's raw result, the full error, and the final text the agent was sent (set when it is not a success).
 */
export interface ToolCallContent {
  arguments: unknown;
  result?: unknown;
  error?: ErrorFields;
  response?: string;
}

/** What the tool-call wrapper knows about one finished call. Nothing else reaches the span. */
export interface ToolCallSpan {
  tool: string;
  /** The closed outcome code: `ok`, or the tool's own error code, or `internal`. */
  outcome: string;
  durationMs: number;
  /** Present only when the span recorder is on: the content is then captured as span events. */
  content?: ToolCallContent;
}

/** The part of an OpenTelemetry tracer the recorder uses. Structural, so a test can pass a fake. */
export interface SpanTracer {
  startSpan(
    name: string,
    options?: { startTime?: number },
  ): {
    setAttributes(attributes: Record<string, AttrValue>): unknown;
    addEvent(name: string, attributes?: Record<string, AttrValue>): unknown;
    setStatus?(status: { code: number }): unknown;
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
  // A tool name outside the contract's list is `other`, as in metrics (recordToolCall).
  picked[TOOL_SPAN_FIELDS.tool] = (MCP_TOOL_NAMES as readonly string[]).includes(call.tool)
    ? call.tool
    : 'other';
  picked[TOOL_SPAN_FIELDS.outcome] = call.outcome;
  if (call.outcome !== 'ok') picked['error.type'] = call.outcome;
  return filterAttributes(picked, 'trace').attributes;
}

/** The JSON text of a value, or undefined when it cannot be serialized (a capture never fails a call). */
function jsonText(value: unknown): string | undefined {
  try {
    const text: unknown = JSON.stringify(value);
    return typeof text === 'string' ? text : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The shape of a result as captured: a picture (`see`) keeps its caption and the length of its base64
 * text, never the base64 itself (up to ~350 KB). Every other result is captured as it is.
 */
export function capturedResult(value: unknown): unknown {
  if (value instanceof ImageToolResult)
    return { caption: value.caption, png_base64_chars: value.png.length };
  return value;
}

/**
 * Adds the call's content to its span as events, in a fixed order, each only when it has data: the
 * arguments, the handler's result, the error, the final response. Each text goes through
 * redactContent, then the content helper, so it is capped at 32 KiB on a UTF-8 boundary.
 */
export function addToolContentEvents(span: EventSpan, content: ToolCallContent): void {
  // Each event is guarded alone: one that throws (a hostile value) loses itself, not the events after it.
  const guarded = (add: () => void): void => {
    try {
      add();
    } catch {
      // This event is lost; the others stand.
    }
  };
  const emit = (name: string, value: unknown): void =>
    guarded(() => {
      const text = jsonText(redactContent(value));
      if (text !== undefined) addContentEvent(span, name, text);
    });
  // A call with no arguments is the empty object: callTool validates it as one.
  emit(TOOL_ARGUMENTS_EVENT, content.arguments === undefined ? {} : content.arguments);
  if (content.result !== undefined) emit(TOOL_RESULT_EVENT, capturedResult(content.result));
  if (content.error !== undefined) emit(TOOL_ERROR_EVENT, content.error);
  if (content.response !== undefined) {
    const response = content.response;
    guarded(() => {
      const text = redactContent(response);
      if (typeof text === 'string') addContentEvent(span, TOOL_RESPONSE_EVENT, text);
    });
  }
}

/**
 * Returns the recorder that makes one span per call. The span starts `durationMs` before now and ends
 * now, so its duration is the call's duration. The input is copied through the explicit allow-list.
 * A content failure loses only the content events; the span still ends.
 */
export function toolSpanRecorder(tracer: SpanTracer): (call: ToolCallSpan) => void {
  return (call) => {
    const end = Date.now();
    const span = tracer.startSpan(TOOL_SPAN_NAME, { startTime: end - call.durationMs });
    span.setAttributes(toolSpanAttributes(call));
    if (call.outcome !== 'ok') span.setStatus?.({ code: SPAN_STATUS_ERROR });
    if (call.content !== undefined) {
      try {
        addToolContentEvents(span, call.content);
      } catch {
        // The content events are lost; the span and the call's result stand.
      }
    }
    span.end(end);
  };
}

/**
 * Returns the recorder for every refusal the front door reports: one mcp.auth_refused span with the
 * closed reason code and the HTTP status as `http.response.status_code`, a key on the telemetry
 * allow-list. The span's status is ERROR. Never the token, a header, an address or a body.
 */
export function authRefusalRecorder(
  tracer: SpanTracer,
): (refusal: { reason: string; status: number }) => void {
  return (refusal) => {
    const span = tracer.startSpan(AUTH_REFUSED_SPAN_NAME);
    const picked = filterAttributes(
      { outcome: refusal.reason, 'http.response.status_code': refusal.status },
      'trace',
    ).attributes;
    span.setAttributes(picked);
    span.setStatus?.({ code: SPAN_STATUS_ERROR });
    span.end();
  };
}
