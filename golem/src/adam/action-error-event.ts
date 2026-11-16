import { contentAttributes, MAX_ERROR_TEXT_CHARS, redactContent } from '@geldar/telemetry';
import { FAIL_REASONS } from '../actions/outcome.ts';

/** The span event a failed action adds (T-06d3). */
export const ACTION_ERROR_EVENT = 'action_error';

/**
 * The attributes of the `action_error` event for a failed result, or null for any other status.
 * The message is the failure text the Body already stored: cut to MAX_ERROR_TEXT_CHARS before it
 * is scrubbed (the cut ends with a `…[truncated N chars]` mark), scrubbed and capped by the
 * telemetry package, and written to the span only, never back to the agent. A reason outside
 * `FAIL_REASONS` is labelled `other`, so the attribute stays a closed set.
 */
export function actionErrorAttributes(result: {
  status?: unknown;
  reason?: unknown;
  message?: unknown;
}): Record<string, string | number | boolean> | null {
  if (result.status !== 'failed') return null;
  const reason = (FAIL_REASONS as readonly unknown[]).includes(result.reason)
    ? String(result.reason)
    : 'other';
  const message = typeof result.message === 'string' ? result.message : '';
  const cut = message.length - MAX_ERROR_TEXT_CHARS;
  const text =
    cut > 0
      ? `${String(redactContent(message.slice(0, MAX_ERROR_TEXT_CHARS)))}…[truncated ${cut} chars]`
      : String(redactContent(message));
  return { reason, ...contentAttributes('error', text) };
}
