// One OpenTelemetry span per MCP tool call (T-06). The span carries only the fields named in
// TOOL_SPAN_FIELDS below; the @geldar/telemetry span processor filters the attributes again.
// Tool arguments and results (T-06c) go in as span events, never as attributes or metric labels.
// Off unless the telemetry endpoint is set: main.ts then passes no recorder, so no span is made.

import { MCP_TOOL_NAMES } from '@geldar/contract';
import { ImageToolResult } from '@geldar/mcp-mock';
import {
  type AttrValue,
  addContentEvent,
  type EventSpan,
  filterAttributes,
} from '@geldar/telemetry';

/** The span name: one per call, so a trace list reads by tool. */
export const TOOL_SPAN_NAME = 'mcp.tool_call';

/** The content event names: `geldar.content.tool_arguments` and `geldar.content.tool_result`. */
export const TOOL_ARGUMENTS_EVENT = 'tool_arguments';
export const TOOL_RESULT_EVENT = 'tool_result';

/** The value that replaces any argument whose key names a secret. */
export const REDACTED = '[redacted]';

/** Keys that name a secret: their values are never captured. Matched anywhere in the key, any case. */
const SECRET_KEY = /token|secret|authorization|password|cookie/i;

/** The arguments and, on success, the result of one call. Captured as span events only. */
export interface ToolCallContent {
  arguments: unknown;
  result?: unknown;
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

/**
 * A copy of the arguments with every secret-named key's value replaced by REDACTED. Nested objects and
 * arrays are copied too; the input is never changed.
 */
export function redactArguments(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => redactArguments(item));
  if (value !== null && typeof value === 'object') {
    const copy: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) {
      copy[key] = SECRET_KEY.test(key) ? REDACTED : redactArguments(inner);
    }
    return copy;
  }
  return value;
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
 * The shape of a result as captured: a picture (`see`) keeps its caption and the PNG's length, never the
 * base64 bytes (up to ~350 KB). Every other result is captured as it is.
 */
export function capturedResult(value: unknown): unknown {
  if (value instanceof ImageToolResult)
    return { caption: value.caption, png_bytes: value.png.length };
  return value;
}

/**
 * Adds the call's content to its span as events: the redacted arguments, and the result when there is one.
 * Each text goes through the content helper, so it is capped at 32 KiB on a UTF-8 boundary.
 */
export function addToolContentEvents(span: EventSpan, content: ToolCallContent): void {
  const args = jsonText(redactArguments(content.arguments));
  if (args !== undefined) addContentEvent(span, TOOL_ARGUMENTS_EVENT, args);
  if (content.result === undefined) return;
  const result = jsonText(capturedResult(content.result));
  if (result !== undefined) addContentEvent(span, TOOL_RESULT_EVENT, result);
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
