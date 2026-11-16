import { contentAttributes, redactContent } from '@geldar/telemetry';
import type { FailReason } from '../actions/outcome.ts';

/** The span event a failed action adds (T-06d3). */
export const ACTION_ERROR_EVENT = 'action_error';

/** Every `FailReason`; a reason outside it is labelled `other`, so the attribute stays a closed set. */
const FAIL_REASONS: readonly FailReason[] = [
  'invalid_args',
  'timeout',
  'blocked',
  'not_found',
  'out_of_reach',
  'missing_materials',
  'missing_station',
  'needs_rescue',
  'not_possible',
  'interrupted',
  'unsupported',
  'busy',
  'no_effect',
  'internal',
];

/**
 * The attributes of the `action_error` event for a failed result, or null for any other status.
 * The message is the failure text the Body already stored: scrubbed and capped by the telemetry
 * package, and written to the span only, never back to the agent.
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
  return {
    reason,
    ...contentAttributes('error', String(redactContent(message))),
  };
}
